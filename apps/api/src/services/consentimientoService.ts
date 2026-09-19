/**
 * Consentimiento informado (5.1 + 5.2) firmado en la tablet.
 *
 * Inmutable como la receta: lo que se leyó y firmó queda como snapshot y la corrección es la
 * REVOCACIÓN (queda en el historial y en su PDF con marca de agua; nunca se borra). Las firmas son
 * trazos normalizados 0..1 sobre un lienzo de proporción `firmaAspecto` (ancho/alto); el PDF los
 * redibuja como vector.
 *
 * Desde el 18-sep-2026 (formato OFICIAL de la clínica, ver consentimientoFormal.ts):
 *  · Se firma EN CUALQUIER MOMENTO: desde la cita en la agenda (antes de que exista la atención),
 *    dentro de la atención (abierta o cerrada) o solo con el paciente y la sede.
 *  · Cada plantilla dice a qué servicios aplica: la agenda y la atención avisan si falta firmarlo.
 *  · Revocar es un derecho del paciente y NO exige motivo (la ley dice «sin expresar el motivo»).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { Ctx, etiquetaUsuario, asegurarHistoria } from './historiaClinicaService';
import { fichaPrevia } from './fichaPreviaService';
import { citaInicioUtc } from '../utils/fechaLima';
import {
  ErrorConsentimiento, esFormatoOficial, normalizarContenido, validarDatos, textoPlano, riesgosSugeridos,
  consentimientosPendientes, firmaVigente, plantillasDelServicio,
  type PlantillaResumen, type ContenidoConsentimiento,
} from './consentimientoFormal';

const ctxAudit = (c: Ctx) => ({ usuarioId: c.usuarioId, ip: c.ip, userAgent: c.userAgent });

export interface TrazoFirma { puntos: [number, number][]; grosor?: number }

const MAX_TRAZOS = 300, MAX_PUNTOS_TRAZO = 2000, MIN_PUNTOS_FIRMA = 12;

/** Valida y sanea la firma. 400 FIRMA_INVALIDA / FIRMA_VACIA. */
export function validarFirma(firma: unknown): TrazoFirma[] {
  if (!Array.isArray(firma) || firma.length > MAX_TRAZOS) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
  const limpia: TrazoFirma[] = [];
  let total = 0;
  for (const t of firma) {
    const puntos = (t as { puntos?: unknown })?.puntos;
    if (!Array.isArray(puntos) || puntos.length > MAX_PUNTOS_TRAZO) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
    const pts: [number, number][] = [];
    for (const p of puntos) {
      if (!Array.isArray(p) || p.length < 2) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
      pts.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
    }
    if (!pts.length) continue;
    const g = Number((t as { grosor?: unknown }).grosor);
    limpia.push({ puntos: pts, grosor: Number.isFinite(g) ? Math.min(12, Math.max(1, g)) : 3 });
    total += pts.length;
  }
  if (total < MIN_PUNTOS_FIRMA) throw new AppError('Falta la firma: pide que firme en el recuadro', 400, 'FIRMA_VACIA');
  return limpia;
}

/** Firma opcional (profesional, testigo): vacía = null; si hay trazos, se valida igual que la del paciente. */
function firmaOpcional(firma: unknown): TrazoFirma[] | null {
  if (!Array.isArray(firma) || firma.length === 0) return null;
  return validarFirma(firma);
}

const aAppError = (e: unknown): never => {
  if (e instanceof ErrorConsentimiento) throw new AppError(e.message, 400, e.code);
  throw e;
};

// ─── Plantillas oficiales ────────────────────────────────────────────────────
/** Plantillas de consentimiento ACTIVAS con su resumen (servicios, vigencia) para calcular pendientes. */
export async function plantillasConsentimiento() {
  const rows = await prisma.plantillaClinica.findMany({
    where: { tipo: 'consentimiento', activa: true, deletedAt: null },
    select: { id: true, clave: true, nombre: true, contenido: true },
    orderBy: { nombre: 'asc' },
  });
  return rows.map((r) => {
    const oficial = esFormatoOficial(r.contenido);
    let contenido: ContenidoConsentimiento | null = null;
    if (oficial) { try { contenido = normalizarContenido(r.contenido); } catch { contenido = null; } }
    const resumen: PlantillaResumen = { id: r.id, clave: r.clave, nombre: r.nombre, servicioIds: contenido?.servicioIds ?? [], vigenciaDias: contenido?.vigenciaDias ?? 180 };
    return { ...resumen, oficial: !!contenido, contenido, textoLibre: oficial ? null : ((r.contenido as { texto?: string } | null)?.texto ?? null) };
  });
}

// ─── Contexto de firma ───────────────────────────────────────────────────────
type Origen = { citaId?: string | null; atencionId?: string | null; pacienteId?: string | null; sedeId?: string | null };

/** Paciente, sede, cita, atención y profesional tratante a partir de desde dónde se firma. */
async function resolverOrigen(o: Origen) {
  let atencion: { id: string; citaId: string; pacienteId: string; sedeId: string; profesionalId: string } | null = null;
  if (o.atencionId) {
    atencion = await prisma.atencionClinica.findUnique({ where: { id: o.atencionId }, select: { id: true, citaId: true, pacienteId: true, sedeId: true, profesionalId: true } });
    if (!atencion) throw new AppError('Atención no encontrada', 404);
  }
  const citaId = atencion?.citaId ?? o.citaId ?? null;
  const cita = citaId
    ? await prisma.cita.findFirst({
      where: { id: citaId, deletedAt: null },
      select: {
        id: true, pacienteId: true, sedeId: true, servicioId: true, fecha: true, horaInicio: true, slotGrupoId: true,
        profesional: { select: { id: true, esEquipo: true } }, solicitadoProfesionalId: true,
      },
    })
    : null;
  if (citaId && !cita) throw new AppError('Cita no encontrada', 404);
  if (!atencion && cita) {
    atencion = await prisma.atencionClinica.findUnique({ where: { citaId: cita.id }, select: { id: true, citaId: true, pacienteId: true, sedeId: true, profesionalId: true } });
  }
  const pacienteId = atencion?.pacienteId ?? cita?.pacienteId ?? o.pacienteId ?? null;
  const sedeId = atencion?.sedeId ?? cita?.sedeId ?? o.sedeId ?? null;
  if (!pacienteId) throw new AppError('Indica el paciente', 400, 'FALTA_PACIENTE');
  if (!sedeId) throw new AppError('Indica la sede donde se firma', 400, 'FALTA_SEDE');
  // Servicios de la visita: en un bloque combinado (profilaxis + extra) cuentan los dos.
  let servicioIds: string[] = cita ? [cita.servicioId] : [];
  if (cita?.slotGrupoId) {
    const hermanas = await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, select: { servicioId: true } });
    servicioIds = [...new Set(hermanas.map((h) => h.servicioId))];
  }
  // Profesional tratante: el de la atención; si no hay, el de la cita (persona, no un equipo Baro).
  const profesionalId = atencion?.profesionalId
    ?? (cita?.profesional && !cita.profesional.esEquipo ? cita.profesional.id : cita?.solicitadoProfesionalId ?? null);
  return { atencionId: atencion?.id ?? null, cita, citaId: cita?.id ?? null, pacienteId, sedeId, servicioIds, profesionalId };
}

/** Lo que la pantalla necesita para firmar: paciente, HC, plantillas (las que exige el servicio primero) y riesgos sugeridos. */
export async function contextoFirma(o: Origen) {
  const org = await resolverOrigen(o);
  const [paciente, sede, historia, profesional, plantillas, ficha, antecedentes, firmas] = await Promise.all([
    prisma.paciente.findFirst({
      where: { id: org.pacienteId, deletedAt: null },
      select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true, sexo: true, telefono: true },
    }),
    prisma.sede.findUnique({ where: { id: org.sedeId }, select: { id: true, nombre: true, direccion: true } }),
    prisma.historiaClinica.findUnique({ where: { pacienteId: org.pacienteId }, select: { numero: true, alergias: { where: { deletedAt: null, activa: true }, select: { sustancia: true } } } }),
    org.profesionalId ? prisma.profesional.findUnique({ where: { id: org.profesionalId }, select: { id: true, nombres: true, apellidos: true, colegiatura: true } }) : null,
    plantillasConsentimiento(),
    fichaPrevia(org.pacienteId).catch(() => null),
    prisma.antecedentePaciente.findMany({ where: { historiaClinica: { pacienteId: org.pacienteId }, deletedAt: null, activo: true }, select: { descripcion: true } }),
    firmasDelPaciente(org.pacienteId),
  ]);
  if (!paciente) throw new AppError('Paciente no encontrado', 404);
  const fechaRef = org.cita ? citaInicioUtc(org.cita.fecha, org.cita.horaInicio) : new Date();
  const requeridas = new Set(plantillasDelServicio(plantillas, org.servicioIds).map((p) => p.id));
  const hc = { banderas: (ficha?.banderas ?? []).map((b) => b.clave), alergiasActivas: historia?.alergias.length ?? 0, antecedentes: antecedentes.map((a) => a.descripcion).join(' · ') };
  return {
    origen: { citaId: org.citaId, atencionId: org.atencionId, pacienteId: org.pacienteId, sedeId: org.sedeId },
    paciente, sede, historiaNumero: historia?.numero ?? null,
    profesional: profesional ? { id: profesional.id, nombre: `${profesional.nombres} ${profesional.apellidos}`.trim(), colegiatura: profesional.colegiatura } : null,
    plantillas: plantillas
      .map((p) => {
        const vigente = firmaVigente(p, firmas, fechaRef, org.citaId);
        return {
          id: p.id, clave: p.clave, nombre: p.nombre, oficial: p.oficial, contenido: p.contenido, textoLibre: p.textoLibre,
          requerida: requeridas.has(p.id),
          riesgosSugeridos: p.contenido ? riesgosSugeridos(p.contenido.riesgosParticulares, hc) : [],
          firmado: vigente ? { id: vigente.id, numero: vigente.numero, firmadoEn: vigente.firmadoEn } : null,
        };
      })
      .sort((a, b) => Number(b.requerida) - Number(a.requerida) || Number(b.oficial) - Number(a.oficial) || a.nombre.localeCompare(b.nombre)),
  };
}

/** Firmas del paciente (para saber qué está cubierto). */
async function firmasDelPaciente(pacienteId: string) {
  return prisma.consentimientoInformado.findMany({
    where: { pacienteId },
    select: { id: true, numero: true, plantillaClave: true, plantillaId: true, estado: true, firmadoEn: true, citaId: true },
    orderBy: { firmadoEn: 'desc' },
  });
}

/**
 * Consentimientos que FALTAN por cita, para muchas citas a la vez (la agenda del día): una consulta
 * de plantillas y una de firmas por todos los pacientes. Devuelve { citaId: [{ id, clave, nombre }] }.
 */
export async function pendientesPorCitas(citas: { id: string; pacienteId: string; servicioId: string; fecha: Date; horaInicio: string; slotGrupoId: string | null; estado: string }[]) {
  const out: Record<string, { id: string; clave: string | null; nombre: string }[]> = {};
  if (!citas.length) return out;
  const plantillas = (await plantillasConsentimiento()).filter((p) => p.servicioIds.length);
  if (!plantillas.length) return out;
  const servicios = new Set(plantillas.flatMap((p) => p.servicioIds));
  // Servicios por bloque combinado (las dos citas del bloque comparten el aviso).
  const porGrupo = new Map<string, string[]>();
  for (const c of citas) if (c.slotGrupoId) porGrupo.set(c.slotGrupoId, [...(porGrupo.get(c.slotGrupoId) ?? []), c.servicioId]);
  const relevantes = citas.filter((c) => !['cancelada', 'no_show', 'reprogramada'].includes(c.estado)
    && (c.slotGrupoId ? porGrupo.get(c.slotGrupoId)! : [c.servicioId]).some((s) => servicios.has(s)));
  if (!relevantes.length) return out;
  const firmas = await prisma.consentimientoInformado.findMany({
    where: { pacienteId: { in: [...new Set(relevantes.map((c) => c.pacienteId))] } },
    select: { pacienteId: true, plantillaClave: true, plantillaId: true, estado: true, firmadoEn: true, citaId: true },
  });
  for (const c of relevantes) {
    const deGrupo = c.slotGrupoId ? citas.filter((x) => x.slotGrupoId === c.slotGrupoId).map((x) => x.id) : [c.id];
    const f = firmas.filter((x) => x.pacienteId === c.pacienteId).map((x) => ({ ...x, citaId: x.citaId && deGrupo.includes(x.citaId) ? c.id : x.citaId }));
    const pend = consentimientosPendientes(plantillas, c.slotGrupoId ? porGrupo.get(c.slotGrupoId)! : [c.servicioId], f, citaInicioUtc(c.fecha, c.horaInicio), c.id);
    if (pend.length) out[c.id] = pend.map((p) => ({ id: p.id, clave: p.clave, nombre: p.nombre }));
  }
  return out;
}

/** Pendientes de UNA cita (detalle de la cita, cabecera de la atención, cierre). */
export async function pendientesDeCita(citaId: string) {
  const cita = await prisma.cita.findFirst({ where: { id: citaId, deletedAt: null }, select: { id: true, pacienteId: true, servicioId: true, fecha: true, horaInicio: true, slotGrupoId: true, estado: true } });
  if (!cita) return [];
  const hermanas = cita.slotGrupoId
    ? await prisma.cita.findMany({ where: { slotGrupoId: cita.slotGrupoId, deletedAt: null }, select: { id: true, pacienteId: true, servicioId: true, fecha: true, horaInicio: true, slotGrupoId: true, estado: true } })
    : [cita];
  return (await pendientesPorCitas(hermanas))[cita.id] ?? [];
}

// ─── Firmar ──────────────────────────────────────────────────────────────────
export async function crearConsentimiento(p: Ctx & Origen & {
  plantillaId?: string | null;
  procedimiento?: string | null; texto?: string | null;
  firmanteNombre: string; firmanteDocumento?: string | null; firmanteRelacion: 'paciente' | 'apoderado';
  firma: unknown; firmaAspecto: number;
  datos?: unknown; firmaProfesional?: unknown; firmaTestigo?: unknown;
}) {
  const org = await resolverOrigen(p);
  const firma = validarFirma(p.firma);
  const firmaProfesional = firmaOpcional(p.firmaProfesional);
  const firmaTestigo = firmaOpcional(p.firmaTestigo);

  // Plantilla oficial (formato 2) o texto libre (formato 1, como antes).
  let formato = 1, contenido: ContenidoConsentimiento | null = null, plantilla: { id: string; clave: string | null; nombre: string } | null = null;
  let procedimiento = (p.procedimiento ?? '').trim(), texto = (p.texto ?? '').trim();
  let datos: ReturnType<typeof validarDatos> | null = null;
  if (p.plantillaId) {
    const row = await prisma.plantillaClinica.findFirst({ where: { id: p.plantillaId, tipo: 'consentimiento', deletedAt: null }, select: { id: true, clave: true, nombre: true, contenido: true, activa: true } });
    if (!row || !row.activa) throw new AppError('Esa plantilla de consentimiento no existe o está desactivada', 404, 'PLANTILLA_INVALIDA');
    plantilla = { id: row.id, clave: row.clave, nombre: row.nombre };
    if (esFormatoOficial(row.contenido)) {
      formato = 2;
      try {
        contenido = normalizarContenido(row.contenido);
        datos = validarDatos(p.datos, contenido, p.firmanteRelacion);
      } catch (e) { aAppError(e); }
      procedimiento = contenido!.titulo;
      texto = textoPlano(contenido!, datos!, { firmante: p.firmanteNombre.trim(), relacion: p.firmanteRelacion });
    }
  }
  if (formato === 1) {
    if (procedimiento.length < 3) throw new AppError('Indica el procedimiento que se autoriza', 400, 'FALTA_PROCEDIMIENTO');
    if (texto.length < 40) throw new AppError('El texto del consentimiento quedó muy corto', 400, 'TEXTO_CORTO');
    if (p.firmanteRelacion === 'apoderado' && !(p.firmanteDocumento ?? '').trim()) {
      throw new AppError('Para un apoderado, registra su documento de identidad', 400, 'FALTA_DOCUMENTO_APODERADO');
    }
  }
  if (firmaTestigo && !datos?.testigo) throw new AppError('Si firma un testigo, registra su nombre', 400, 'FALTA_TESTIGO');

  const prof = org.profesionalId
    ? await prisma.profesional.findUnique({ where: { id: org.profesionalId }, select: { nombres: true, apellidos: true, colegiatura: true } })
    : null;
  // El consentimiento es parte de la historia clínica (NTS 139): si el paciente aún no tiene HC, se abre.
  await asegurarHistoria(org.pacienteId, { sedeId: org.sedeId, usuarioId: p.usuarioId });
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const firmante = datos?.representante ? datos.representante.nombre : p.firmanteNombre.trim();
  const documento = datos?.representante ? datos.representante.documento : (p.firmanteDocumento ?? '').trim() || null;

  return prisma.$transaction(async (tx) => {
    const creado = await tx.consentimientoInformado.create({
      data: {
        atencionId: org.atencionId, citaId: org.citaId, pacienteId: org.pacienteId, sedeId: org.sedeId,
        procedimiento, texto, formato,
        plantillaId: plantilla?.id ?? null, plantillaClave: plantilla?.clave ?? null,
        contenido: contenido ? (contenido as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        datos: datos ? (datos as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        firmanteNombre: firmante, firmanteDocumento: documento, firmanteRelacion: p.firmanteRelacion,
        firma: firma as unknown as Prisma.InputJsonValue, firmaAspecto: p.firmaAspecto,
        firmaProfesional: firmaProfesional ? (firmaProfesional as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        firmaTestigo: firmaTestigo ? (firmaTestigo as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        profesionalId: org.profesionalId, profesionalEtiqueta: prof ? `${prof.nombres} ${prof.apellidos}`.trim() : null,
        profesionalRegistro: (prof?.colegiatura ?? '').trim() || null,
        registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta,
      },
      select: { id: true, numero: true },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: org.citaId ?? undefined, sedeId: org.sedeId, accion: 'firmar_consentimiento', entidad: 'consentimiento', entidadId: creado.id,
      despues: {
        numero: creado.numero, procedimiento, plantilla: plantilla?.clave ?? null, formato, firmante, relacion: p.firmanteRelacion,
        trazos: firma.length, firmaProfesional: !!firmaProfesional, testigo: !!datos?.testigo,
        antesDeLaAtencion: !org.atencionId,
      },
    });
    return creado;
  });
}

/** Revocar: derecho del paciente, SIN motivo obligatorio («no estoy obligado a expresar el motivo»). */
export async function revocarConsentimiento(p: Ctx & { id: string; motivo?: string | null }) {
  const c = await prisma.consentimientoInformado.findUnique({ where: { id: p.id }, select: { id: true, estado: true, sedeId: true, numero: true, citaId: true } });
  if (!c) throw new AppError('Consentimiento no encontrado', 404);
  if (c.estado === 'revocado') throw new AppError('El consentimiento ya fue revocado', 409, 'YA_REVOCADO');
  const motivo = (p.motivo ?? '').trim() || null;
  await prisma.$transaction(async (tx) => {
    // Con guarda: dos revocaciones a la vez → la segunda recibe 409 y no pisa la primera.
    const u = await tx.consentimientoInformado.updateMany({
      where: { id: c.id, estado: 'firmado' },
      data: { estado: 'revocado', revocadoEn: new Date(), revocadoPorUsuarioId: p.usuarioId ?? null, motivoRevocacion: motivo },
    });
    if (u.count === 0) throw new AppError('El consentimiento ya fue revocado', 409, 'YA_REVOCADO');
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: c.citaId ?? undefined, sedeId: c.sedeId, accion: 'revocar_consentimiento', entidad: 'consentimiento', entidadId: c.id,
      antes: { estado: 'firmado' }, despues: { estado: 'revocado', motivo: motivo ?? 'sin expresar motivo' },
    });
  });
}

/** Lista de consentimientos del paciente (todos: de cualquier atención o firmados antes). */
export async function consentimientosDelPaciente(pacienteId: string) {
  return prisma.consentimientoInformado.findMany({
    where: { pacienteId },
    orderBy: { firmadoEn: 'desc' },
    select: {
      id: true, numero: true, procedimiento: true, formato: true, plantillaClave: true, atencionId: true, citaId: true, sedeId: true,
      firmanteNombre: true, firmanteDocumento: true, firmanteRelacion: true, estado: true, firmadoEn: true, revocadoEn: true, motivoRevocacion: true, registradoEtiqueta: true,
    },
  });
}

/** Todo para el PDF del consentimiento. */
export async function consentimientoParaPdf(id: string) {
  const c = await prisma.consentimientoInformado.findUnique({ where: { id } });
  if (!c) throw new AppError('Consentimiento no encontrado', 404);
  const [sede, paciente, historia, atencion] = await Promise.all([
    prisma.sede.findUnique({ where: { id: c.sedeId }, select: { nombre: true, direccion: true } }),
    prisma.paciente.findUnique({
      where: { id: c.pacienteId },
      select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true, sexo: true, telefono: true },
    }),
    prisma.historiaClinica.findUnique({ where: { pacienteId: c.pacienteId }, select: { numero: true } }),
    c.atencionId ? prisma.atencionClinica.findUnique({ where: { id: c.atencionId }, select: { fecha: true, servicio: { select: { nombre: true } } } }) : null,
  ]);
  if (!sede || !paciente) throw new AppError('Consentimiento incompleto', 500);
  return { ...c, sede, paciente, historiaNumero: historia?.numero ?? null, servicioNombre: atencion?.servicio.nombre ?? null };
}
export type ConsentimientoParaPdf = Awaited<ReturnType<typeof consentimientoParaPdf>>;
