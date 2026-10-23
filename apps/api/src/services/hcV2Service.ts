/**
 * Historia clínica v2 (02-oct-2026) — mejoras pedidas por los médicos, que se ven en la vista de una sola pestaña:
 *  · «NIEGA» por tipo: alergias y cada tipo de antecedente (se preguntó y el paciente niega).
 *  · NOTAS PARA DOCTORES: recomendaciones internas del paciente para los próximos médicos (solo en la HC).
 *  · PRECARGAR la consulta anterior: al abrir una atención de control, los diagnósticos y la anamnesis de la anterior
 *    quedan puestos (editables).
 *  · RESUMEN DEL DÍA para el Visor: si la atención está «Completada» y si tiene procedimiento realizado.
 *  · CONSENTIMIENTO POR FOTO: foto del formato en papel firmado (formato 3), mientras se estandariza el digital.
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload } from '../middleware/auth';
import { auditEnTx } from './audit';
import {
  Ctx, ctxAudit, etiquetaUsuario, asegurarHistoria, exigirAbierta, getAtencionCompleta, getHistoriaCompleta,
} from './historiaClinicaService';
import { rutaRelativaUpload } from '../middleware/uploadPodograma';
import { leerArchivo } from './almacenArchivos';
import { fechaDb } from '../utils/fechaLima';
import { esRolMedico } from '../utils/rolesMedico';

// ─── «Niega» ──────────────────────────────────────────────────────────────────
// 03-oct-2026: en antecedentes se usa UN solo check («antecedentes»); los de cada tipo quedan aceptados por compatibilidad.
export const CATEGORIAS_NIEGA = ['alergias', 'antecedentes', 'patologico', 'quirurgico', 'familiar', 'farmacologico', 'habito', 'otro'] as const;
export type CategoriaNiega = (typeof CATEGORIAS_NIEGA)[number];

/** Marca o quita «Niega …» para una categoría. Devuelve la historia completa (como el resto de antecedentes). */
export async function marcarNegacion(p: Ctx & { pacienteId: string; categoria: CategoriaNiega; activa: boolean; sedeId?: string | null }) {
  const hc = await asegurarHistoria(p.pacienteId, { sedeId: p.sedeId, usuarioId: p.usuarioId });
  if (p.activa) {
    // Contradicción: no se puede «negar» lo que ya tiene registrado y activo.
    const hay = p.categoria === 'alergias'
      ? await prisma.alergiaPaciente.count({ where: { historiaClinicaId: hc.id, deletedAt: null, activa: true } })
      : p.categoria === 'antecedentes'
        ? await prisma.antecedentePaciente.count({ where: { historiaClinicaId: hc.id, deletedAt: null, activo: true } })
        : await prisma.antecedentePaciente.count({ where: { historiaClinicaId: hc.id, deletedAt: null, activo: true, tipo: p.categoria } });
    if (hay > 0) throw new AppError('Ya tiene registros activos de ese tipo: no se puede marcar «Niega»', 409, 'NIEGA_CON_REGISTROS');
  }
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    await tx.negacionHc.upsert({
      where: { historiaClinicaId_categoria: { historiaClinicaId: hc.id, categoria: p.categoria } },
      update: { activa: p.activa, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta },
      create: { historiaClinicaId: hc.id, categoria: p.categoria, activa: p.activa, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), accion: p.activa ? 'marcar_niega' : 'quitar_niega', entidad: 'historia_clinica', entidadId: p.pacienteId,
      sedeId: p.sedeId ?? undefined, despues: { categoria: p.categoria },
    });
  });
  return getHistoriaCompleta(p.pacienteId);
}

// Al registrar una alergia o un antecedente, su «Niega» deja de valer: lo hace historiaClinicaService
// (registrarAlergia / registrarAntecedente) dentro de su misma transacción.

// ─── Notas para doctores ──────────────────────────────────────────────────────
/** Quién ve y escribe las notas para doctores: los médicos (y el auditor), administración y coordinación. */
export function puedeNotasMedico(u: AuthPayload): boolean {
  return esRolMedico(u.rol) || u.rol === 'admin' || u.rol === 'coordinadora_sedes';
}

export async function listarNotasMedico(pacienteId: string) {
  const hc = await prisma.historiaClinica.findUnique({ where: { pacienteId }, select: { id: true } });
  if (!hc) return [];
  return prisma.notaMedicoPaciente.findMany({
    where: { historiaClinicaId: hc.id, deletedAt: null },
    orderBy: { creadoEn: 'desc' },
    select: { id: true, texto: true, autorUsuarioId: true, autorEtiqueta: true, creadoEn: true },
  });
}

export async function crearNotaMedico(p: Ctx & { pacienteId: string; texto: string; sedeId?: string | null }) {
  const texto = p.texto.trim();
  if (texto.length < 3) throw new AppError('Escribe la nota', 400, 'NOTA_VACIA');
  const hc = await asegurarHistoria(p.pacienteId, { sedeId: p.sedeId, usuarioId: p.usuarioId });
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    const n = await tx.notaMedicoPaciente.create({ data: { historiaClinicaId: hc.id, texto, autorUsuarioId: p.usuarioId ?? null, autorEtiqueta: etiqueta } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'crear_nota_medico', entidad: 'historia_clinica', entidadId: p.pacienteId, sedeId: p.sedeId ?? undefined, despues: { notaId: n.id, texto } });
  });
  return listarNotasMedico(p.pacienteId);
}

/** La quita su autor, o administración / coordinación. Borrado suave (queda en la auditoría). */
export async function eliminarNotaMedico(p: Ctx & { user: AuthPayload; notaId: string }) {
  const n = await prisma.notaMedicoPaciente.findFirst({ where: { id: p.notaId, deletedAt: null }, include: { historiaClinica: { select: { pacienteId: true } } } });
  if (!n) throw new AppError('Nota no encontrada', 404);
  const puede = n.autorUsuarioId === p.user.userId || p.user.rol === 'admin' || p.user.rol === 'coordinadora_sedes';
  if (!puede) throw new AppError('Solo quien escribió la nota, administración o coordinación pueden quitarla', 403, 'SIN_PERMISO');
  await prisma.$transaction(async (tx) => {
    await tx.notaMedicoPaciente.update({ where: { id: n.id }, data: { deletedAt: new Date(), deletedPorUsuarioId: p.usuarioId ?? null } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'eliminar_nota_medico', entidad: 'historia_clinica', entidadId: n.historiaClinica.pacienteId, antes: { texto: n.texto } });
  });
  return listarNotasMedico(n.historiaClinica.pacienteId);
}

// ─── Precargar la consulta anterior ───────────────────────────────────────────
/**
 * En una atención de CONTROL deja puestos (editables) los diagnósticos y la anamnesis de la consulta ANTERIOR del
 * paciente (la más reciente antes que esta). Solo llena lo que esté vacío: si ya tiene diagnósticos o anamnesis, no
 * los toca. Idempotente (llamarla dos veces no duplica nada).
 */
export async function precargarAnterior(p: Ctx & { atencionId: string }) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: p.atencionId },
    select: { id: true, estado: true, citaId: true, sedeId: true, pacienteId: true, fecha: true, creadoEn: true, anamnesis: true, _count: { select: { diagnosticos: { where: { deletedAt: null } } } } },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  exigirAbierta(at);
  const anteriores = {
    pacienteId: at.pacienteId, id: { not: at.id },
    OR: [{ fecha: { lt: at.fecha } }, { fecha: at.fecha, creadoEn: { lt: at.creadoEn } }],
  };
  const orden = [{ fecha: 'desc' as const }, { creadoEn: 'desc' as const }];

  let dxCopiados = 0, anamnesisCopiada = false;
  const desde: { dx?: Date; anamnesis?: Date } = {};
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    if (at._count.diagnosticos === 0) {
      const previa = await tx.atencionClinica.findFirst({
        where: { ...anteriores, diagnosticos: { some: { deletedAt: null } } }, orderBy: orden,
        select: { id: true, fecha: true, diagnosticos: { where: { deletedAt: null }, orderBy: [{ principal: 'desc' }, { creadoEn: 'asc' }], select: { cie10Codigo: true, tipo: true, principal: true, observacion: true } } },
      });
      if (previa) {
        let yaPrincipal = false;
        for (const d of previa.diagnosticos) {
          const principal = d.principal && !yaPrincipal; // máx 1 principal (índice único parcial)
          if (principal) yaPrincipal = true;
          await tx.diagnosticoAtencion.create({ data: { atencionId: at.id, cie10Codigo: d.cie10Codigo, tipo: d.tipo, principal, observacion: d.observacion, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta } });
          dxCopiados++;
        }
        desde.dx = previa.fecha;
      }
    }
    if (!at.anamnesis?.trim()) {
      const previa = await tx.atencionClinica.findFirst({
        where: { ...anteriores, AND: [{ anamnesis: { not: null } }, { anamnesis: { not: '' } }] }, orderBy: orden,
        select: { fecha: true, anamnesis: true },
      });
      if (previa?.anamnesis?.trim()) {
        await tx.atencionClinica.update({ where: { id: at.id }, data: { anamnesis: previa.anamnesis } });
        anamnesisCopiada = true;
        desde.anamnesis = previa.fecha;
      }
    }
    if (dxCopiados || anamnesisCopiada) {
      await auditEnTx(tx, {
        ...ctxAudit(p), citaId: at.citaId, accion: 'precargar_consulta_anterior', entidad: 'atencion_clinica', entidadId: at.id, sedeId: at.sedeId,
        despues: { diagnosticos: dxCopiados, anamnesis: anamnesisCopiada },
      });
    }
  });
  return { atencion: await getAtencionCompleta(at.id), dxCopiados, anamnesisCopiada, desde };
}

// ─── Resumen del día (Visor de Pacientes) ─────────────────────────────────────
/**
 * Por cada cita atendida hoy en la sede: si la atención está «Completada» y si tiene procedimiento realizado. Solo
 * banderas y conteos (sin contenido clínico). «Completada» = tiene anamnesis (o una nota SOAP con contenido), al menos
 * un diagnóstico, y al menos un procedimiento O una receta vigente (decisión del 02-oct-2026: no siempre hay receta).
 */
export async function resumenClinicoDelDia(sedeId: string | undefined, fecha: string | Date | { gte: Date; lte: Date }) {
  const ats = await prisma.atencionClinica.findMany({
    where: { ...(sedeId ? { sedeId } : {}), fecha: typeof fecha === 'string' ? fechaDb(fecha) : fecha }, // sin sede = todas
    select: {
      id: true, citaId: true, anamnesis: true,
      notas: { where: { deletedAt: null }, select: { subjetivo: true, objetivo: true, apreciacion: true, plan: true, texto: true } },
      _count: { select: { diagnosticos: { where: { deletedAt: null } }, procedimientos: { where: { deletedAt: null } }, recetas: { where: { estado: 'emitida' } } } },
    },
  });
  // El visor muestra cada cita de un bloque combinado: la atención vive en la PRINCIPAL; se replica a sus hermanas.
  const grupos = await prisma.cita.findMany({ where: { id: { in: ats.map((a) => a.citaId) }, slotGrupoId: { not: null } }, select: { id: true, slotGrupoId: true } });
  const hermanas = grupos.length
    ? await prisma.cita.findMany({ where: { slotGrupoId: { in: grupos.map((g) => g.slotGrupoId!) }, deletedAt: null }, select: { id: true, slotGrupoId: true } })
    : [];
  const out: Record<string, { atencionId: string; anamnesis: boolean; diagnosticos: number; procedimientos: number; recetas: number; completada: boolean }> = {};
  for (const a of ats) {
    const conTexto = (t: string | null) => !!t?.trim();
    const anamnesis = conTexto(a.anamnesis) || a.notas.some((n) => [n.subjetivo, n.objetivo, n.apreciacion, n.plan, n.texto].some(conTexto));
    const fila = {
      atencionId: a.id, anamnesis, diagnosticos: a._count.diagnosticos, procedimientos: a._count.procedimientos, recetas: a._count.recetas,
      completada: anamnesis && a._count.diagnosticos > 0 && (a._count.procedimientos > 0 || a._count.recetas > 0),
    };
    out[a.citaId] = fila;
    const g = grupos.find((x) => x.id === a.citaId)?.slotGrupoId;
    if (g) for (const h of hermanas.filter((x) => x.slotGrupoId === g)) out[h.id] = fila;
  }
  return out;
}

// ─── Consentimiento por foto (formato 3) ──────────────────────────────────────
export async function crearConsentimientoFoto(p: Ctx & {
  atencionId: string; procedimiento?: string | null; plantillaId?: string | null; archivo: Express.Multer.File;
}) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: p.atencionId },
    select: { id: true, estado: true, citaId: true, sedeId: true, pacienteId: true, profesionalId: true, profesional: { select: { nombres: true, apellidos: true } }, paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true } } },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  exigirAbierta(at);
  let plantilla: { id: string; clave: string | null; nombre: string } | null = null;
  if (p.plantillaId) {
    plantilla = await prisma.plantillaClinica.findFirst({ where: { id: p.plantillaId, tipo: 'consentimiento', deletedAt: null }, select: { id: true, clave: true, nombre: true } });
    if (!plantilla) throw new AppError('Esa plantilla de consentimiento no existe', 404, 'PLANTILLA_INVALIDA');
  }
  const procedimiento = (p.procedimiento ?? '').trim() || plantilla?.nombre || '';
  if (procedimiento.length < 3) throw new AppError('Indica de qué procedimiento es el consentimiento', 400, 'FALTA_PROCEDIMIENTO');
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const nombrePaciente = `${at.paciente.nombres} ${at.paciente.apellidoPaterno} ${at.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();
  const c = await prisma.$transaction(async (tx) => {
    const c = await tx.consentimientoInformado.create({
      data: {
        atencionId: at.id, citaId: at.citaId, pacienteId: at.pacienteId, sedeId: at.sedeId,
        procedimiento, texto: 'Formato en papel firmado por el paciente: ver la foto adjunta.',
        firmanteNombre: nombrePaciente, firmanteDocumento: at.paciente.numeroDocumento, firmanteRelacion: 'paciente',
        firma: [], formato: 3, plantillaId: plantilla?.id ?? null, plantillaClave: plantilla?.clave ?? null,
        archivoRuta: rutaRelativaUpload(p.archivo.path), archivoMime: p.archivo.mimetype, archivoTamano: p.archivo.size,
        profesionalId: at.profesionalId, profesionalEtiqueta: `${at.profesional.nombres} ${at.profesional.apellidos}`.trim(),
        registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta,
      },
      select: { id: true, numero: true },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: at.citaId, accion: 'registrar_consentimiento_foto', entidad: 'consentimiento', entidadId: c.id, sedeId: at.sedeId,
      despues: { numero: c.numero, procedimiento, plantilla: plantilla?.clave ?? null },
    });
    return c;
  });
  return { ...c, atencion: await getAtencionCompleta(at.id) };
}

/** Archivo de un consentimiento por foto (solo por endpoint autenticado; nunca se expone la ruta). */
export async function archivoConsentimiento(id: string) {
  const c = await prisma.consentimientoInformado.findUnique({ where: { id }, select: { id: true, sedeId: true, pacienteId: true, atencionId: true, archivoRuta: true, archivoMime: true } });
  if (!c || !c.archivoRuta) throw new AppError('Este consentimiento no tiene foto', 404);
  const archivo = await leerArchivo(c.archivoRuta);
  if (!archivo) throw new AppError('No se encontró la foto', 404);
  return { ...c, mime: archivo.mime, datos: archivo.datos };
}
