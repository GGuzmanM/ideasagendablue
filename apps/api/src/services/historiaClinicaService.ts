/**
 * Historia Clínica — servicio de dominio (Fase 1).
 *
 * Módulo APARTE que LEE la agenda (Cita) y nunca la escribe. Reglas:
 *  · 1 atención por cita ATENDIDA (llegó / en atención / completada), sobre la cita PRINCIPAL
 *    del bloque combinado. `citaId @unique` es el guard real contra duplicados.
 *  · La HC se crea perezosamente FUERA de la transacción principal (create + reintento en P2002)
 *    para no abortar una tx interactiva con un choque de unicidad.
 *  · Notas y diagnósticos son EDITABLES en la vista clínica (decisión médica, sin tachones): cada
 *    edición conserva la versión previa en NotaEvolucionVersion y queda en AuditLog (NTS 139).
 *    Nada se borra físicamente: solo `deletedAt`.
 *  · Cada LECTURA de la HC se audita (`ver_hc`), no solo las escrituras (Ley 29733).
 *  · Autores = uuid plano + etiqueta (snapshot del nombre), sin FK a Usuario.
 */
import { Prisma, PrismaClient, TipoNota, TipoDiagnostico, TipoAntecedente, SeveridadAlergia } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload, puedeTodasLasSedes } from '../middleware/auth';
import { auditEnTx, registrarAudit } from './audit';
import { validarControles, crearControlesEnTx, type ControlEntrada } from './controlService';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Contexto de auditoría que viaja en cada escritura. */
export interface Ctx {
  usuarioId?: string;
  ip?: string;
  userAgent?: string;
}

// Estados de cita en los que existe un "encuentro" clínico real.
const ESTADOS_ATENDIDA = ['llego', 'en_atencion', 'completada'];

export const ctxAudit = (c: Ctx) => ({ usuarioId: c.usuarioId, ip: c.ip, userAgent: c.userAgent });

export async function etiquetaUsuario(tx: Tx, usuarioId?: string | null): Promise<string> {
  if (!usuarioId) return 'Sistema';
  const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true } });
  return u?.nombre ?? 'Sistema';
}

// ─── Acceso por sede a la HC de un paciente ───────────────────────────────────
// admin/coordinadora → siempre. Resto: solo si el paciente tiene ≥1 cita viva en alguna de SUS
// sedes (nunca más amplio que la visibilidad actual de la agenda). Las API keys no llegan aquí
// (las rutas clínicas usan requirePermiso, que exige usuario).
export async function assertAccesoPaciente(user: AuthPayload, pacienteId: string): Promise<void> {
  if (puedeTodasLasSedes(user)) return;
  if (user.sedes.length > 0) {
    // Una cita cancelada, reprogramada o "no vino" no convierte al paciente en paciente de la sede.
    const ok = await prisma.cita.findFirst({
      where: { pacienteId, deletedAt: null, sedeId: { in: user.sedes }, estado: { notIn: ['cancelada', 'reprogramada', 'no_show'] } },
      select: { id: true },
    });
    if (ok) return;
  }
  throw new AppError('No tienes acceso a la historia clínica de este paciente', 403, 'SEDE_NO_AUTORIZADA');
}

// ─── Atención cerrada = solo lectura ──────────────────────────────────────────
// Una atención CERRADA no cambia: no se agregan ni editan diagnósticos, notas, procedimientos, escalas,
// podograma, fotos, recetas ni consentimientos. Excepciones (por su naturaleza): una nota de tipo
// «observación» tardía, anular una receta y revocar un consentimiento. Para corregir algo, se REABRE:
// quien la cerró (o cualquiera con hc.registrar) dentro de las 24 h siguientes; después, solo
// administración o coordinación (hc.anular). Misma regla en la pantalla (`puedeEditar`).
export const HORAS_REABRIR_SIN_ANULAR = 24;
export function exigirAbierta(at: { estado: string }): void {
  if (at.estado === 'cerrada') {
    throw new AppError('La atención está cerrada (solo lectura). Reábrela para corregirla.', 409, 'ATENCION_CERRADA');
  }
}

// ─── HC perezosa ──────────────────────────────────────────────────────────────
export async function asegurarHistoria(
  pacienteId: string,
  opts: { sedeId?: string | null; usuarioId?: string } = {},
) {
  const existente = await prisma.historiaClinica.findUnique({ where: { pacienteId } });
  if (existente) return existente;
  const pac = await prisma.paciente.findFirst({ where: { id: pacienteId, deletedAt: null }, select: { id: true } });
  if (!pac) throw new AppError('Paciente no encontrado', 404);
  try {
    const hc = await prisma.historiaClinica.create({
      data: { pacienteId, sedeAperturaId: opts.sedeId ?? null, creadoPorUsuarioId: opts.usuarioId ?? null },
    });
    void registrarAudit({
      usuarioId: opts.usuarioId, accion: 'abrir_historia', entidad: 'historia_clinica', entidadId: pacienteId,
      sedeId: opts.sedeId ?? undefined, despues: { historiaClinicaId: hc.id, numero: hc.numero },
    });
    return hc;
  } catch (e) {
    // Carrera: otro request la creó entre el find y el create (P2002 sobre pacienteId).
    if ((e as { code?: string }).code === 'P2002') {
      const hc = await prisma.historiaClinica.findUnique({ where: { pacienteId } });
      if (hc) return hc;
    }
    throw e;
  }
}

// ─── Cita → atención ──────────────────────────────────────────────────────────
const profesionalMini = { select: { id: true, nombres: true, apellidos: true, tipo: true, esEquipo: true, activo: true } } as const;
const citaBaseSelect = {
  id: true, pacienteId: true, profesionalId: true, solicitadoProfesionalId: true, sedeId: true, servicioId: true,
  subcategoriaId: true, fecha: true, horaInicio: true, estado: true, slotGrupoId: true, slotRol: true,
  profesional: profesionalMini, solicitadoProfesional: profesionalMini,
} as const;
type CitaBase = Prisma.CitaGetPayload<{ select: typeof citaBaseSelect }>;

/** La cita PRINCIPAL del bloque combinado (o la misma cita si es individual). 404 si no existe. */
export async function resolverCitaPrincipal(citaId: string): Promise<CitaBase> {
  const cita = await prisma.cita.findFirst({
    where: { id: citaId, deletedAt: null }, select: { id: true, slotGrupoId: true, slotRol: true },
  });
  if (!cita) throw new AppError('Cita no encontrada', 404);
  let id = cita.id;
  if (cita.slotGrupoId && cita.slotRol !== 'PRINCIPAL') {
    const principal = await prisma.cita.findFirst({
      where: { slotGrupoId: cita.slotGrupoId, slotRol: 'PRINCIPAL', deletedAt: null }, select: { id: true },
    });
    if (principal) id = principal.id;
  }
  return prisma.cita.findUniqueOrThrow({ where: { id }, select: citaBaseSelect });
}

/** Ids de todas las citas del bloque al que pertenece `citaId` (incluida ella). */
export async function idsDelBloque(citaId: string): Promise<string[]> {
  const c = await prisma.cita.findUnique({ where: { id: citaId }, select: { id: true, slotGrupoId: true } });
  if (!c) return [citaId];
  if (!c.slotGrupoId) return [c.id];
  const todas = await prisma.cita.findMany({ where: { slotGrupoId: c.slotGrupoId, deletedAt: null }, select: { id: true } });
  return todas.map((x) => x.id);
}

async function validarProfesionalPersona(profesionalId: string): Promise<void> {
  const p = await prisma.profesional.findFirst({ where: { id: profesionalId, deletedAt: null }, select: { esEquipo: true } });
  if (!p) throw new AppError('Profesional no encontrado', 404, 'PROFESIONAL_INVALIDO');
  if (p.esEquipo) throw new AppError('Un equipo no puede figurar como profesional de la atención', 400, 'PROFESIONAL_ES_EQUIPO');
}

/**
 * Quién atendió: el explícito (validado) o `solicitado ?? profesional` de la cita, nunca un equipo.
 * Regla de baropodometría: las Baro son EQUIPOS que solo operan los médicos y en cada cita hay un
 * médico supervisando → si la columna de la cita es un equipo, quien atendió DEBE ser un médico
 * (el solicitado en la cita, o el que se indique). Ese médico es quien luego receta.
 */
export async function resolverProfesionalAtencion(cita: CitaBase, profesionalIdExplicito?: string | null): Promise<string> {
  const columnaEsEquipo = !!cita.profesional?.esEquipo;
  if (profesionalIdExplicito) {
    await validarProfesionalPersona(profesionalIdExplicito);
    if (columnaEsEquipo) {
      const p = await prisma.profesional.findUnique({ where: { id: profesionalIdExplicito }, select: { tipo: true } });
      if (p?.tipo !== 'medico') {
        throw new AppError('En baropodometría la atención debe registrarse a nombre del médico que supervisó', 400, 'ATENCION_BARO_REQUIERE_MEDICO');
      }
    }
    return profesionalIdExplicito;
  }
  const candidato = cita.solicitadoProfesional ?? cita.profesional;
  if (!candidato) {
    throw new AppError('La cita no tiene profesional asignado: indica quién atendió', 400, 'PROFESIONAL_ATENCION_REQUERIDO');
  }
  if (candidato.esEquipo) {
    throw new AppError('La cita es de baropodometría (equipo): indica el médico que supervisó la atención', 400, 'PROFESIONAL_ATENCION_REQUERIDO');
  }
  if (columnaEsEquipo && candidato.tipo !== 'medico') {
    throw new AppError('En baropodometría la atención debe registrarse a nombre del médico que supervisó', 400, 'ATENCION_BARO_REQUIERE_MEDICO');
  }
  return candidato.id;
}

// ─── Lectores ─────────────────────────────────────────────────────────────────
const notasInclude = {
  where: { deletedAt: null },
  orderBy: { creadoEn: 'asc' },
  include: { profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } } },
} as const;
// Sin `as const` en el objeto: Prisma exige un arreglo MUTABLE en `orderBy` (readonly no encaja).
const diagnosticosInclude = {
  where: { deletedAt: null },
  orderBy: [{ principal: 'desc' as const }, { creadoEn: 'asc' as const }],
  include: { cie10: { select: { codigo: true, descripcion: true, categoria: true } } },
};
const recetasResumenInclude = {
  where: {},
  orderBy: { fechaEmision: 'desc' },
  select: {
    id: true, numero: true, tipoDocumento: true, estado: true, fechaEmision: true, emisorNombre: true, emisorUsuarioId: true,
    codigoVerificacion: true, _count: { select: { items: true } },
  },
} as const;
// Colecciones del Bloque 3 (procedimientos, escalas, podograma). orderBy simple → `as const` ok.
const procedimientosInclude = { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } } as const;
const escalasInclude = { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } } as const;
const marcasInclude = { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } } as const;
const atencionInclude = {
  cita: { select: { id: true, horaInicio: true, estado: true, duracionMinutos: true } },
  profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
  sede: { select: { id: true, nombre: true, color: true } },
  servicio: { select: { id: true, nombre: true, color: true } },
  notas: notasInclude,
  diagnosticos: diagnosticosInclude,
  recetas: recetasResumenInclude,
  _count: { select: { procedimientos: { where: { deletedAt: null } }, escalas: { where: { deletedAt: null } }, marcasPodograma: { where: { deletedAt: null } } } },
} as const;

export async function getAtencionCompleta(id: string) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id },
    include: {
      ...atencionInclude,
      procedimientos: procedimientosInclude,
      escalas: escalasInclude,
      marcasPodograma: marcasInclude,
      // Dibujos a mano alzada sobre la silueta (modo "Pintar"): una capa por vista y pie.
      dibujosSilueta: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { id: true, vista: true, pie: true, anotaciones: true, registradoEtiqueta: true, actualizadoEn: true } },
      // Imágenes del podograma: sin `ruta` (el archivo solo se entrega por endpoint autenticado).
      imagenesPodograma: {
        where: { deletedAt: null }, orderBy: { creadoEn: 'asc' },
        select: { id: true, vista: true, nombreArchivo: true, mime: true, tamano: true, descripcion: true, anotaciones: true, subidoEtiqueta: true, creadoEn: true },
      },
      // Fotos clínicas (1.8): sin `ruta` (archivo solo por endpoint autenticado).
      fotos: {
        where: { deletedAt: null }, orderBy: { tomadaEn: 'asc' },
        select: { id: true, atencionId: true, pie: true, zona: true, categoria: true, descripcion: true, mime: true, tamano: true, tomadaEn: true, subidoEtiqueta: true, creadoEn: true },
      },
      // Consentimientos informados (5.1): sin la firma (pesa; va solo en su PDF).
      consentimientos: {
        orderBy: { firmadoEn: 'asc' },
        select: { id: true, numero: true, procedimiento: true, firmanteNombre: true, firmanteDocumento: true, firmanteRelacion: true, estado: true, firmadoEn: true, revocadoEn: true, motivoRevocacion: true, registradoEtiqueta: true },
      },
      // Controles sugeridos al cerrar (4.1).
      controles: { orderBy: { fechaSugerida: 'asc' }, select: { id: true, fechaSugerida: true, motivo: true, origen: true, estado: true } },
      // Constancias y descansos médicos (5.4): resumen (el texto va en su PDF).
      constancias: {
        orderBy: { fechaEmision: 'asc' },
        select: { id: true, numero: true, tipo: true, estado: true, fechaEmision: true, desde: true, hasta: true, dias: true, diagnosticoCie10Codigo: true, emisorNombre: true, emisorUsuarioId: true, codigoVerificacion: true, anuladaEn: true, motivoAnulacion: true },
      },
      historiaClinica: {
        select: {
          id: true, numero: true, pacienteId: true,
          alergias: { where: { deletedAt: null, activa: true }, orderBy: { creadoEn: 'asc' } },
        },
      },
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true, tipoDocumento: true, fechaNacimiento: true, sexo: true } },
    },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  return at;
}

export async function getHistoriaCompleta(pacienteId: string) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, deletedAt: null },
    select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true, tipoDocumento: true, fechaNacimiento: true, sexo: true, telefono: true, email: true },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);
  const historia = await prisma.historiaClinica.findUnique({
    where: { pacienteId },
    include: {
      alergias: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } },
      antecedentes: { where: { deletedAt: null }, orderBy: [{ tipo: 'asc' }, { creadoEn: 'asc' }] },
      atenciones: { orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }], take: 100, include: atencionInclude },
    },
  });
  return { paciente, historia };
}

/**
 * Todo lo de la historia para el PDF completo (7.6): atenciones en orden CRONOLÓGICO y sin límite,
 * con notas, diagnósticos, procedimientos, escalas, recetas con sus ítems, consentimientos y fotos
 * (la `ruta` de las fotos solo se usa en el servidor para incrustarlas; nunca sale en una respuesta).
 */
export async function historiaParaPdf(pacienteId: string) {
  const paciente = await prisma.paciente.findFirst({
    where: { id: pacienteId, deletedAt: null },
    select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true, tipoDocumento: true, fechaNacimiento: true, sexo: true, telefono: true },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);
  const historia = await prisma.historiaClinica.findUnique({
    where: { pacienteId },
    include: {
      alergias: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' } },
      antecedentes: { where: { deletedAt: null }, orderBy: [{ tipo: 'asc' }, { creadoEn: 'asc' }] },
      atenciones: {
        orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
        include: {
          profesional: { select: { nombres: true, apellidos: true, tipo: true } },
          sede: { select: { nombre: true, direccion: true } },
          servicio: { select: { nombre: true } },
          notas: notasInclude,
          diagnosticos: diagnosticosInclude,
          procedimientos: procedimientosInclude,
          escalas: escalasInclude,
          recetas: {
            orderBy: { fechaEmision: 'asc' },
            select: {
              numero: true, tipoDocumento: true, estado: true, fechaEmision: true, emisorNombre: true,
              items: { orderBy: { orden: 'asc' }, select: { tipo: true, nombre: true, concentracionSnapshot: true, formaSnapshot: true, marcaImpresa: true, dosis: true, via: true, frecuencia: true, duracion: true, cantidad: true } },
            },
          },
          consentimientos: { orderBy: { firmadoEn: 'asc' }, select: { numero: true, procedimiento: true, firmanteNombre: true, firmanteRelacion: true, estado: true, firmadoEn: true } },
          constancias: { orderBy: { fechaEmision: 'asc' }, select: { numero: true, tipo: true, estado: true, fechaEmision: true, desde: true, hasta: true, dias: true, emisorNombre: true, diagnosticoCie10Codigo: true } },
          fotos: { where: { deletedAt: null }, orderBy: { tomadaEn: 'asc' }, select: { id: true, ruta: true, mime: true, tamano: true, zona: true, pie: true, categoria: true, tomadaEn: true } },
        },
      },
    },
  });
  if (!historia) throw new AppError('El paciente aún no tiene historia clínica', 404, 'SIN_HISTORIA');
  return { paciente, historia };
}
export type HistoriaParaPdf = Awaited<ReturnType<typeof historiaParaPdf>>;

/** Resumen liviano para el modal de cita (NO audita: no expone contenido clínico). */
export async function resumenAtencionPorCita(citaId: string) {
  const cita = await resolverCitaPrincipal(citaId);
  const at = await prisma.atencionClinica.findUnique({
    where: { citaId: cita.id },
    select: {
      id: true, estado: true, pacienteId: true,
      _count: { select: { notas: { where: { deletedAt: null } }, diagnosticos: { where: { deletedAt: null } }, recetas: true } },
    },
  });
  if (!at) return { atencionId: null, citaPrincipalId: cita.id, puedeAbrir: ESTADOS_ATENDIDA.includes(cita.estado), pacienteId: cita.pacienteId };
  return {
    atencionId: at.id, citaPrincipalId: cita.id, estado: at.estado, pacienteId: at.pacienteId,
    totalNotas: at._count.notas, totalDiagnosticos: at._count.diagnosticos, totalRecetas: at._count.recetas,
  };
}

/** Auditoría de LECTURA (awaited, nunca lanza): quién abrió qué historia y desde dónde. */
export async function auditarLecturaHC(p: Ctx & { pacienteId: string; origen: 'ficha' | 'ficha_previa' | 'historial_podograma' | 'atencion' | 'receta' | 'pdf' | 'hc_pdf' | 'consentimiento' | 'constancia' | 'anteriores' | 'versiones' | 'escalas' | 'fotos'; atencionId?: string; recetaId?: string; sedeId?: string }) {
  // 'pdf' = PDF de una receta; 'hc_pdf' = copia completa de la historia (se audita aparte: sale entera).
  await registrarAudit({
    ...ctxAudit(p), accion: p.origen === 'hc_pdf' ? 'exportar_hc' : p.origen === 'receta' || p.origen === 'pdf' ? 'ver_receta' : 'ver_hc',
    entidad: 'historia_clinica', entidadId: p.pacienteId, sedeId: p.sedeId,
    despues: { origen: p.origen, atencionId: p.atencionId, recetaId: p.recetaId },
  });
}

export async function atencionOr404(id: string) {
  const at = await prisma.atencionClinica.findUnique({ where: { id }, select: { id: true, citaId: true, sedeId: true, estado: true, cerradaEn: true, pacienteId: true, historiaClinicaId: true } });
  if (!at) throw new AppError('Atención no encontrada', 404);
  return at;
}

// ─── Atención ─────────────────────────────────────────────────────────────────
export async function abrirAtencion(p: Ctx & { citaId: string; motivoConsulta: string; profesionalId?: string | null }) {
  const cita = await resolverCitaPrincipal(p.citaId);
  if (!ESTADOS_ATENDIDA.includes(cita.estado)) {
    throw new AppError('Solo se registra atención de una cita que llegó, está en atención o se completó', 409, 'CITA_NO_ATENDIDA');
  }
  const ya = await prisma.atencionClinica.findUnique({ where: { citaId: cita.id }, select: { id: true } });
  if (ya) throw new AppError('Esta cita ya tiene una atención clínica registrada', 409, 'ATENCION_YA_EXISTE');
  const motivo = p.motivoConsulta.trim();
  if (!motivo) throw new AppError('El motivo de consulta es obligatorio', 400, 'MOTIVO_REQUERIDO');
  const profesionalId = await resolverProfesionalAtencion(cita, p.profesionalId);
  const hc = await asegurarHistoria(cita.pacienteId, { sedeId: cita.sedeId, usuarioId: p.usuarioId });
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const creada = await prisma.$transaction(async (tx) => {
    const a = await tx.atencionClinica.create({
      data: {
        historiaClinicaId: hc.id, citaId: cita.id, pacienteId: cita.pacienteId, profesionalId, sedeId: cita.sedeId,
        servicioId: cita.servicioId, subcategoriaId: cita.subcategoriaId, fecha: cita.fecha, motivoConsulta: motivo,
        abiertaPorUsuarioId: p.usuarioId ?? null, abiertaEtiqueta: etiqueta,
      },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: cita.id, accion: 'abrir_atencion', entidad: 'atencion_clinica', entidadId: a.id, sedeId: cita.sedeId,
      despues: { pacienteId: cita.pacienteId, profesionalId, motivoConsulta: motivo },
    });
    // Una HC pasiva (archivo) vuelve sola a activa cuando el paciente regresa.
    if (hc.estado === 'pasiva') {
      await tx.historiaClinica.update({ where: { id: hc.id }, data: { estado: 'activa' } });
      await auditEnTx(tx, {
        ...ctxAudit(p), accion: 'cambiar_estado_hc', entidad: 'historia_clinica', entidadId: cita.pacienteId, sedeId: cita.sedeId,
        antes: { estado: 'pasiva' }, despues: { estado: 'activa', motivo: 'Nueva atención' },
      });
    }
    return a;
  });
  return getAtencionCompleta(creada.id);
}

/** A3 · Pasa la HC a pasiva (archivo) o la reactiva. Paso manual, auditado; devuelve la HC completa. */
export async function cambiarEstadoHistoria(p: Ctx & { pacienteId: string; estado: 'activa' | 'pasiva'; motivo?: string | null }) {
  const hcRow = await prisma.historiaClinica.findUnique({ where: { pacienteId: p.pacienteId }, select: { id: true, estado: true } });
  if (!hcRow) throw new AppError('El paciente aún no tiene historia clínica', 404, 'HC_NO_EXISTE');
  if (hcRow.estado !== p.estado) {
    await prisma.$transaction(async (tx) => {
      await tx.historiaClinica.update({ where: { id: hcRow.id }, data: { estado: p.estado } });
      await auditEnTx(tx, {
        ...ctxAudit(p), accion: 'cambiar_estado_hc', entidad: 'historia_clinica', entidadId: p.pacienteId,
        antes: { estado: hcRow.estado }, despues: { estado: p.estado, motivo: p.motivo ?? null },
      });
    });
  }
  return getHistoriaCompleta(p.pacienteId);
}

export async function editarAtencion(p: Ctx & { atencionId: string; motivoConsulta?: string; profesionalId?: string | null }) {
  const at = await atencionOr404(p.atencionId);
  exigirAbierta(at);
  const data: Prisma.AtencionClinicaUpdateInput = {};
  if (p.motivoConsulta !== undefined) {
    const m = p.motivoConsulta.trim();
    if (!m) throw new AppError('El motivo de consulta es obligatorio', 400, 'MOTIVO_REQUERIDO');
    data.motivoConsulta = m;
  }
  if (p.profesionalId) {
    // Misma regla que al abrir (en la Baro debe ser un médico): se valida contra la cita de la atención.
    const cita = await prisma.cita.findUniqueOrThrow({ where: { id: at.citaId }, select: citaBaseSelect });
    data.profesional = { connect: { id: await resolverProfesionalAtencion(cita, p.profesionalId) } };
  }
  await prisma.$transaction(async (tx) => {
    const antes = await tx.atencionClinica.findUnique({ where: { id: at.id }, select: { motivoConsulta: true, profesionalId: true } });
    await tx.atencionClinica.update({ where: { id: at.id }, data });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'editar_atencion', entidad: 'atencion_clinica', entidadId: at.id, sedeId: at.sedeId, antes, despues: { motivoConsulta: p.motivoConsulta, profesionalId: p.profesionalId } });
  });
  return getAtencionCompleta(at.id);
}

export async function cerrarAtencion(p: Ctx & { atencionId: string; controles?: ControlEntrada[] }) {
  const at = await atencionOr404(p.atencionId);
  if (at.estado === 'cerrada') throw new AppError('La atención ya está cerrada', 409, 'ATENCION_CERRADA');
  // Controles sugeridos (4.1) elegidos en el diálogo de cierre: se guardan en la MISMA transacción.
  const controles = p.controles?.length ? await validarControles(p.controles) : [];
  const etiqueta = controles.length ? await etiquetaUsuario(prisma, p.usuarioId) : null;
  await prisma.$transaction(async (tx) => {
    // Escritura con guarda: si dos personas cierran a la vez, la segunda recibe 409 y no duplica controles.
    const r = await tx.atencionClinica.updateMany({ where: { id: at.id, estado: 'abierta' }, data: { estado: 'cerrada', cerradaEn: new Date(), cerradaPorUsuarioId: p.usuarioId ?? null } });
    if (r.count === 0) throw new AppError('La atención ya está cerrada', 409, 'ATENCION_CERRADA');
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'cerrar_atencion', entidad: 'atencion_clinica', entidadId: at.id, sedeId: at.sedeId, ...(controles.length ? { despues: { controles: controles.length } } : {}) });
    if (controles.length) await crearControlesEnTx(tx, { ctx: p, atencion: at, controles, etiqueta });
  });
  return getAtencionCompleta(at.id);
}

/**
 * Reabrir: con hc.anular siempre; con solo hc.registrar, únicamente dentro de las 24 h siguientes al
 * cierre (para corregir lo de hoy sin pasar por coordinación). Queda auditado quién reabrió.
 */
export async function reabrirAtencion(p: Ctx & { atencionId: string; user: AuthPayload }) {
  const at = await atencionOr404(p.atencionId);
  if (at.estado !== 'cerrada') throw new AppError('La atención no está cerrada', 409, 'ATENCION_ABIERTA');
  if (!p.user.permisos.includes('hc.anular')) {
    const cerradaEn = at.cerradaEn?.getTime() ?? 0;
    if (Date.now() - cerradaEn > HORAS_REABRIR_SIN_ANULAR * 3_600_000) {
      throw new AppError(`Pasaron más de ${HORAS_REABRIR_SIN_ANULAR} horas desde el cierre: solo administración o coordinación pueden reabrirla`, 403, 'REABRIR_REQUIERE_ANULAR');
    }
  }
  await prisma.$transaction(async (tx) => {
    const r = await tx.atencionClinica.updateMany({ where: { id: at.id, estado: 'cerrada' }, data: { estado: 'abierta', cerradaEn: null, cerradaPorUsuarioId: null } });
    if (r.count === 0) throw new AppError('La atención no está cerrada', 409, 'ATENCION_ABIERTA');
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'reabrir_atencion', entidad: 'atencion_clinica', entidadId: at.id, sedeId: at.sedeId, antes: { cerradaEn: at.cerradaEn } });
  });
  return getAtencionCompleta(at.id);
}

// ─── Notas de evolución (editables con historial de versiones) ───────────────
export interface CamposNota {
  tipo?: TipoNota;
  subjetivo?: string | null;
  objetivo?: string | null;
  apreciacion?: string | null;
  plan?: string | null;
  texto?: string | null;
  profesionalId?: string | null;
}
const limpiar = (s?: string | null) => { const t = (s ?? '').trim(); return t ? t : null; };
const hayContenido = (c: CamposNota) => !!(limpiar(c.subjetivo) || limpiar(c.objetivo) || limpiar(c.apreciacion) || limpiar(c.plan) || limpiar(c.texto));
const snapshotNota = (n: { tipo: TipoNota; subjetivo: string | null; objetivo: string | null; apreciacion: string | null; plan: string | null; texto: string | null; profesionalId: string | null }) =>
  ({ tipo: n.tipo, subjetivo: n.subjetivo, objetivo: n.objetivo, apreciacion: n.apreciacion, plan: n.plan, texto: n.texto, profesionalId: n.profesionalId });

export async function agregarNota(p: Ctx & CamposNota & { atencionId: string }) {
  const at = await atencionOr404(p.atencionId);
  const tipo = p.tipo ?? 'evolucion';
  if (at.estado === 'cerrada' && tipo !== 'observacion') {
    throw new AppError('La atención está cerrada: solo se admiten observaciones', 409, 'ATENCION_CERRADA');
  }
  if (!hayContenido(p)) throw new AppError('La nota está vacía', 400, 'NOTA_VACIA');
  if (p.profesionalId) await validarProfesionalPersona(p.profesionalId);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    const n = await tx.notaEvolucion.create({
      data: {
        atencionId: at.id, tipo, subjetivo: limpiar(p.subjetivo), objetivo: limpiar(p.objetivo), apreciacion: limpiar(p.apreciacion),
        plan: limpiar(p.plan), texto: limpiar(p.texto), profesionalId: p.profesionalId ?? null,
        autorUsuarioId: p.usuarioId ?? null, autorEtiqueta: etiqueta,
      },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'agregar_nota', entidad: 'nota_evolucion', entidadId: n.id, sedeId: at.sedeId, despues: snapshotNota(n) });
  });
  return getAtencionCompleta(at.id);
}

export async function editarNota(p: Ctx & CamposNota & { notaId: string }) {
  const nota = await prisma.notaEvolucion.findFirst({
    where: { id: p.notaId, deletedAt: null },
    include: { atencion: { select: { id: true, citaId: true, sedeId: true, estado: true } } },
  });
  if (!nota) throw new AppError('Nota no encontrada', 404);
  exigirAbierta(nota.atencion);
  const nuevo = {
    tipo: p.tipo ?? nota.tipo,
    subjetivo: p.subjetivo !== undefined ? limpiar(p.subjetivo) : nota.subjetivo,
    objetivo: p.objetivo !== undefined ? limpiar(p.objetivo) : nota.objetivo,
    apreciacion: p.apreciacion !== undefined ? limpiar(p.apreciacion) : nota.apreciacion,
    plan: p.plan !== undefined ? limpiar(p.plan) : nota.plan,
    texto: p.texto !== undefined ? limpiar(p.texto) : nota.texto,
    profesionalId: p.profesionalId !== undefined ? p.profesionalId : nota.profesionalId,
  };
  if (!hayContenido(nuevo)) throw new AppError('La nota quedaría vacía', 400, 'NOTA_VACIA');
  // Sin cambios reales → no se crea una versión idéntica.
  if (JSON.stringify(snapshotNota({ ...nota, ...nuevo })) === JSON.stringify(snapshotNota(nota))) return getAtencionCompleta(nota.atencion.id);
  if (nuevo.profesionalId) await validarProfesionalPersona(nuevo.profesionalId);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    // Versión previa (historial interno, invisible en la vista clínica).
    await tx.notaEvolucionVersion.create({
      data: { notaId: nota.id, version: nota.version, contenido: snapshotNota(nota) as Prisma.InputJsonValue, guardadoPorUsuarioId: p.usuarioId ?? null, guardadoEtiqueta: etiqueta },
    });
    const n = await tx.notaEvolucion.update({
      where: { id: nota.id },
      data: { ...nuevo, version: nota.version + 1, editadaEn: new Date(), editadaPorUsuarioId: p.usuarioId ?? null },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: nota.atencion.citaId, accion: 'editar_nota', entidad: 'nota_evolucion', entidadId: n.id, sedeId: nota.atencion.sedeId, antes: snapshotNota(nota), despues: snapshotNota(n) });
  });
  return getAtencionCompleta(nota.atencion.id);
}

export async function eliminarNota(p: Ctx & { notaId: string; motivo?: string | null }) {
  const nota = await prisma.notaEvolucion.findFirst({ where: { id: p.notaId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true, estado: true } } } });
  if (!nota) throw new AppError('Nota no encontrada', 404);
  exigirAbierta(nota.atencion);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    await tx.notaEvolucionVersion.create({
      data: { notaId: nota.id, version: nota.version, contenido: snapshotNota(nota) as Prisma.InputJsonValue, guardadoPorUsuarioId: p.usuarioId ?? null, guardadoEtiqueta: etiqueta },
    });
    await tx.notaEvolucion.update({ where: { id: nota.id }, data: { deletedAt: new Date(), deletedPorUsuarioId: p.usuarioId ?? null } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: nota.atencion.citaId, accion: 'eliminar_nota', entidad: 'nota_evolucion', entidadId: nota.id, sedeId: nota.atencion.sedeId, antes: snapshotNota(nota), despues: { motivo: limpiar(p.motivo) } });
  });
  return getAtencionCompleta(nota.atencion.id);
}

/** Historial de versiones de una nota (solo hc.anular). */
export async function versionesDeNota(notaId: string) {
  const nota = await prisma.notaEvolucion.findUnique({ where: { id: notaId }, select: { id: true, version: true, deletedAt: true } });
  if (!nota) throw new AppError('Nota no encontrada', 404);
  const versiones = await prisma.notaEvolucionVersion.findMany({ where: { notaId }, orderBy: { version: 'asc' } });
  return { nota, versiones };
}

// ─── Diagnósticos (editables, soft delete, máx 1 principal vigente) ──────────
export interface CamposDx { cie10Codigo?: string; tipo?: TipoDiagnostico; principal?: boolean; observacion?: string | null }

async function cie10Or400(codigo: string) {
  const c = await prisma.cie10.findFirst({ where: { codigo, activo: true } });
  if (!c) throw new AppError(`Código CIE-10 no válido: ${codigo}`, 400, 'CIE10_INVALIDO');
  return c;
}

export async function agregarDiagnostico(p: Ctx & CamposDx & { atencionId: string; cie10Codigo: string }) {
  const at = await atencionOr404(p.atencionId);
  exigirAbierta(at);
  await cie10Or400(p.cie10Codigo);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    // Un nuevo principal desplaza al anterior (sin 409: más simple para el médico).
    if (p.principal) await tx.diagnosticoAtencion.updateMany({ where: { atencionId: at.id, principal: true, deletedAt: null }, data: { principal: false } });
    const d = await tx.diagnosticoAtencion.create({
      data: { atencionId: at.id, cie10Codigo: p.cie10Codigo, tipo: p.tipo ?? 'presuntivo', principal: !!p.principal, observacion: limpiar(p.observacion), registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'agregar_diagnostico', entidad: 'diagnostico_atencion', entidadId: d.id, sedeId: at.sedeId, despues: { cie10Codigo: d.cie10Codigo, tipo: d.tipo, principal: d.principal, observacion: d.observacion } });
  });
  return getAtencionCompleta(at.id);
}

export async function editarDiagnostico(p: Ctx & CamposDx & { diagnosticoId: string }) {
  const dx = await prisma.diagnosticoAtencion.findFirst({ where: { id: p.diagnosticoId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true, estado: true } } } });
  if (!dx) throw new AppError('Diagnóstico no encontrado', 404);
  exigirAbierta(dx.atencion);
  if (p.cie10Codigo) await cie10Or400(p.cie10Codigo);
  await prisma.$transaction(async (tx) => {
    if (p.principal === true) await tx.diagnosticoAtencion.updateMany({ where: { atencionId: dx.atencionId, principal: true, deletedAt: null, id: { not: dx.id } }, data: { principal: false } });
    const d = await tx.diagnosticoAtencion.update({
      where: { id: dx.id },
      data: {
        ...(p.cie10Codigo ? { cie10Codigo: p.cie10Codigo } : {}),
        ...(p.tipo ? { tipo: p.tipo } : {}),
        ...(p.principal !== undefined ? { principal: p.principal } : {}),
        ...(p.observacion !== undefined ? { observacion: limpiar(p.observacion) } : {}),
      },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: dx.atencion.citaId, accion: 'editar_diagnostico', entidad: 'diagnostico_atencion', entidadId: d.id, sedeId: dx.atencion.sedeId, antes: { cie10Codigo: dx.cie10Codigo, tipo: dx.tipo, principal: dx.principal, observacion: dx.observacion }, despues: { cie10Codigo: d.cie10Codigo, tipo: d.tipo, principal: d.principal, observacion: d.observacion } });
  });
  return getAtencionCompleta(dx.atencion.id);
}

export async function eliminarDiagnostico(p: Ctx & { diagnosticoId: string; motivo?: string | null }) {
  const dx = await prisma.diagnosticoAtencion.findFirst({ where: { id: p.diagnosticoId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true, estado: true } } } });
  if (!dx) throw new AppError('Diagnóstico no encontrado', 404);
  exigirAbierta(dx.atencion);
  await prisma.$transaction(async (tx) => {
    await tx.diagnosticoAtencion.update({ where: { id: dx.id }, data: { deletedAt: new Date(), principal: false } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: dx.atencion.citaId, accion: 'eliminar_diagnostico', entidad: 'diagnostico_atencion', entidadId: dx.id, sedeId: dx.atencion.sedeId, antes: { cie10Codigo: dx.cie10Codigo, tipo: dx.tipo, principal: dx.principal }, despues: { motivo: limpiar(p.motivo) } });
  });
  return getAtencionCompleta(dx.atencion.id);
}

/** "Copiar anterior": diagnósticos vigentes de la última atención previa del mismo paciente. */
export async function diagnosticosAnteriores(atencionId: string) {
  const at = await atencionOr404(atencionId);
  const previa = await prisma.atencionClinica.findFirst({
    where: { pacienteId: at.pacienteId, id: { not: at.id }, diagnosticos: { some: { deletedAt: null } } },
    orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
    select: { id: true, fecha: true, diagnosticos: diagnosticosInclude },
  });
  return previa;
}

/** Última nota de evolución previa del paciente (para "traer última nota"). */
export async function notaAnterior(atencionId: string) {
  const at = await atencionOr404(atencionId);
  const nota = await prisma.notaEvolucion.findFirst({
    where: { deletedAt: null, tipo: 'evolucion', atencion: { pacienteId: at.pacienteId, id: { not: at.id } } },
    orderBy: { creadoEn: 'desc' },
    include: { atencion: { select: { id: true, fecha: true, servicio: { select: { nombre: true } } } } },
  });
  return nota;
}

// ─── Antecedentes y alergias (por paciente, con o sin cita) ──────────────────
export async function registrarAntecedente(p: Ctx & { pacienteId: string; tipo: TipoAntecedente; descripcion: string; sedeId?: string | null }) {
  const desc = p.descripcion.trim();
  if (!desc) throw new AppError('La descripción es obligatoria', 400, 'DESCRIPCION_REQUERIDA');
  const hc = await asegurarHistoria(p.pacienteId, { sedeId: p.sedeId, usuarioId: p.usuarioId });
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    const a = await tx.antecedentePaciente.create({ data: { historiaClinicaId: hc.id, tipo: p.tipo, descripcion: desc, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'registrar_antecedente', entidad: 'historia_clinica', entidadId: p.pacienteId, sedeId: p.sedeId ?? undefined, despues: { antecedenteId: a.id, tipo: a.tipo, descripcion: a.descripcion } });
  });
  return getHistoriaCompleta(p.pacienteId);
}

export async function editarAntecedente(p: Ctx & { antecedenteId: string; tipo?: TipoAntecedente; descripcion?: string; activo?: boolean }) {
  const a = await prisma.antecedentePaciente.findFirst({ where: { id: p.antecedenteId, deletedAt: null }, include: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Antecedente no encontrado', 404);
  await prisma.$transaction(async (tx) => {
    const n = await tx.antecedentePaciente.update({ where: { id: a.id }, data: { ...(p.tipo ? { tipo: p.tipo } : {}), ...(p.descripcion !== undefined ? { descripcion: p.descripcion.trim() } : {}), ...(p.activo !== undefined ? { activo: p.activo } : {}) } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'editar_antecedente', entidad: 'historia_clinica', entidadId: a.historiaClinica.pacienteId, antes: { tipo: a.tipo, descripcion: a.descripcion, activo: a.activo }, despues: { tipo: n.tipo, descripcion: n.descripcion, activo: n.activo } });
  });
  return getHistoriaCompleta(a.historiaClinica.pacienteId);
}

export async function eliminarAntecedente(p: Ctx & { antecedenteId: string }) {
  const a = await prisma.antecedentePaciente.findFirst({ where: { id: p.antecedenteId, deletedAt: null }, include: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Antecedente no encontrado', 404);
  await prisma.$transaction(async (tx) => {
    await tx.antecedentePaciente.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'eliminar_antecedente', entidad: 'historia_clinica', entidadId: a.historiaClinica.pacienteId, antes: { tipo: a.tipo, descripcion: a.descripcion } });
  });
  return getHistoriaCompleta(a.historiaClinica.pacienteId);
}

export async function registrarAlergia(p: Ctx & { pacienteId: string; sustancia: string; reaccion?: string | null; severidad?: SeveridadAlergia; sedeId?: string | null }) {
  const sust = p.sustancia.trim();
  if (!sust) throw new AppError('La sustancia es obligatoria', 400, 'SUSTANCIA_REQUERIDA');
  const hc = await asegurarHistoria(p.pacienteId, { sedeId: p.sedeId, usuarioId: p.usuarioId });
  // La misma sustancia dos veces (con distinta mayúscula o tilde) confunde la franja roja y el chequeo: se avisa.
  const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const vivas = await prisma.alergiaPaciente.findMany({ where: { historiaClinicaId: hc.id, deletedAt: null }, select: { sustancia: true, activa: true } });
  const repetida = vivas.find((a) => normalizar(a.sustancia) === normalizar(sust));
  if (repetida) throw new AppError(repetida.activa ? `La alergia a «${sust}» ya está registrada` : `La alergia a «${sust}» ya existe (inactiva): actívala en vez de repetirla`, 409, 'ALERGIA_DUPLICADA');
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    const a = await tx.alergiaPaciente.create({ data: { historiaClinicaId: hc.id, sustancia: sust, reaccion: limpiar(p.reaccion), severidad: p.severidad ?? 'moderada', registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'registrar_alergia', entidad: 'historia_clinica', entidadId: p.pacienteId, sedeId: p.sedeId ?? undefined, despues: { alergiaId: a.id, sustancia: a.sustancia, severidad: a.severidad } });
  });
  return getHistoriaCompleta(p.pacienteId);
}

export async function editarAlergia(p: Ctx & { alergiaId: string; sustancia?: string; reaccion?: string | null; severidad?: SeveridadAlergia; activa?: boolean }) {
  const a = await prisma.alergiaPaciente.findFirst({ where: { id: p.alergiaId, deletedAt: null }, include: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Alergia no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    const n = await tx.alergiaPaciente.update({ where: { id: a.id }, data: { ...(p.sustancia !== undefined ? { sustancia: p.sustancia.trim() } : {}), ...(p.reaccion !== undefined ? { reaccion: limpiar(p.reaccion) } : {}), ...(p.severidad ? { severidad: p.severidad } : {}), ...(p.activa !== undefined ? { activa: p.activa } : {}) } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'editar_alergia', entidad: 'historia_clinica', entidadId: a.historiaClinica.pacienteId, antes: { sustancia: a.sustancia, reaccion: a.reaccion, severidad: a.severidad, activa: a.activa }, despues: { sustancia: n.sustancia, reaccion: n.reaccion, severidad: n.severidad, activa: n.activa } });
  });
  return getHistoriaCompleta(a.historiaClinica.pacienteId);
}

export async function eliminarAlergia(p: Ctx & { alergiaId: string }) {
  const a = await prisma.alergiaPaciente.findFirst({ where: { id: p.alergiaId, deletedAt: null }, include: { historiaClinica: { select: { pacienteId: true } } } });
  if (!a) throw new AppError('Alergia no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.alergiaPaciente.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'eliminar_alergia', entidad: 'historia_clinica', entidadId: a.historiaClinica.pacienteId, antes: { sustancia: a.sustancia, severidad: a.severidad } });
  });
  return getHistoriaCompleta(a.historiaClinica.pacienteId);
}

// ─── Guard para la agenda: ¿alguna cita del bloque tiene atención? ───────────
// Único punto donde la agenda consulta a la HC. Cancelar / no_show con atención → 409.
export async function assertSinAtencionClinica(citaId: string): Promise<void> {
  const ids = await idsDelBloque(citaId);
  const at = await prisma.atencionClinica.findFirst({ where: { citaId: { in: ids } }, select: { id: true } });
  if (at) throw new AppError('La cita ya tiene una atención clínica registrada: no se puede cancelar ni marcar como no asistida', 409, 'CITA_CON_ATENCION_CLINICA');
}

/** Al MOVER una cita con atención (acción oculta de coordinación/admin), la atención acompaña la fecha. */
export async function sincronizarFechaAtencion(tx: Tx, citaId: string, nuevaFecha: Date): Promise<boolean> {
  const at = await tx.atencionClinica.findUnique({ where: { citaId }, select: { id: true } });
  if (!at) return false;
  await tx.atencionClinica.update({ where: { id: at.id }, data: { fecha: nuevaFecha } });
  return true;
}
