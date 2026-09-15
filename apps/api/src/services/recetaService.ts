/**
 * Receta — servicio de dominio (Fase 2).
 *
 * Dos documentos del mismo flujo, ambos INMUTABLES (corrección = anulación con motivo):
 *  · RECETA_MEDICA: solo un MÉDICO colegiado vinculado. Candado explícito (sin heurísticas):
 *    req.user.profesionalId → Profesional tipo=medico, !esEquipo, activo, colegiatura no vacía.
 *    Único documento que admite ítems MEDICAMENTO_RX (venta bajo receta).
 *  · INDICACIONES_PODOLOGICAS: la emite el profesional que atendió (podóloga/fisio/médico) —
 *    recepción puede registrarla a su nombre. Solo ítems OTC, productos y servicios.
 * Los ítems se agrupan por diagnóstico CIE-10 y llevan snapshot de nombre/concentración/forma
 * (el catálogo puede cambiar; el documento no). La marca se imprime junto al genérico.
 */
import { Prisma, TipoDocumentoReceta, TipoItemReceta } from '@prisma/client';
import { randomBytes } from 'crypto';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthPayload } from '../middleware/auth';
import { auditEnTx } from './audit';
import { Ctx, etiquetaUsuario } from './historiaClinicaService';

const ctxAudit = (c: Ctx) => ({ usuarioId: c.usuarioId, ip: c.ip, userAgent: c.userAgent });

// Código corto legible (sin 0/O/1/I) para el QR / verificación en farmacia.
function codigoVerificacion(): string {
  const alf = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(10);
  return Array.from(b, (x) => alf[x % alf.length]).join('');
}

export interface ItemEntrada {
  tipo?: TipoItemReceta;
  diagnosticoCie10Codigo?: string | null;
  medicamentoId?: string | null;
  servicioId?: string | null;
  nombre?: string | null;
  marcaImpresa?: string | null;
  concentracion?: string | null;
  formaFarmaceutica?: string | null;
  dosis?: string | null;
  via?: string | null;
  frecuencia?: string | null;
  duracion?: string | null;
  cantidad?: string | null;
  indicaciones?: string | null;
}

const limpiar = (s?: string | null) => { const t = (s ?? '').trim(); return t ? t : null; };

// ─── Recetas favoritas (3.5) ──────────────────────────────────────────────────
// Plantillas compartidas por la clínica. Se guardan SIN diagnóstico (se asigna al usarla) y con el
// mismo candado de contenido que la emisión: una favorita de indicaciones no lleva ítems Rx. Al
// usarla, la receta se emite por el flujo normal (con todos sus candados).
export async function listarFavoritas(tipoDocumento: TipoDocumentoReceta) {
  return prisma.recetaFavorita.findMany({ where: { deletedAt: null, tipoDocumento }, orderBy: { nombre: 'asc' } });
}

export async function crearFavorita(p: Ctx & {
  nombre: string; tipoDocumento: TipoDocumentoReceta; items: ItemEntrada[]; indicacionesGenerales?: string | null; vigenciaDias?: number | null;
}) {
  const items = p.items.map(({ diagnosticoCie10Codigo: _dx, ...it }) => it).filter((it) => limpiar(it.nombre));
  if (!items.length) throw new AppError('La favorita necesita al menos un ítem con nombre', 400, 'FAVORITA_VACIA');
  if (p.tipoDocumento === 'INDICACIONES_PODOLOGICAS' && items.some((it) => it.tipo === 'MEDICAMENTO_RX')) {
    throw new AppError('Las indicaciones no llevan medicamentos de venta bajo receta', 400, 'RX_EN_INDICACIONES');
  }
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  return prisma.$transaction(async (tx) => {
    const f = await tx.recetaFavorita.create({
      data: {
        nombre: p.nombre.trim(), tipoDocumento: p.tipoDocumento, items: items as unknown as Prisma.InputJsonValue,
        indicacionesGenerales: limpiar(p.indicacionesGenerales), vigenciaDias: p.vigenciaDias ?? null,
        creadoPorUsuarioId: p.usuarioId ?? null, creadoEtiqueta: etiqueta,
      },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), accion: 'crear_receta_favorita', entidad: 'receta_favorita', entidadId: f.id,
      despues: { nombre: f.nombre, tipoDocumento: f.tipoDocumento, items: items.length },
    });
    return f;
  });
}

/** La quita quien la creó o coordinación/admin (`hc.anular`). Borrado suave. */
export async function eliminarFavorita(p: Ctx & { user: AuthPayload; id: string }) {
  const f = await prisma.recetaFavorita.findFirst({ where: { id: p.id, deletedAt: null } });
  if (!f) throw new AppError('Favorita no encontrada', 404);
  if (f.creadoPorUsuarioId !== p.user.userId && !p.user.permisos?.includes('hc.anular')) {
    throw new AppError('Solo quien creó la favorita o coordinación puede quitarla', 403, 'SIN_PERMISO');
  }
  await prisma.$transaction(async (tx) => {
    await tx.recetaFavorita.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'eliminar_receta_favorita', entidad: 'receta_favorita', entidadId: f.id, antes: { nombre: f.nombre } });
  });
  return { ok: true };
}

// ─── Candados de emisor ───────────────────────────────────────────────────────
/** Médico prescriptor válido para RECETA_MEDICA. 403 NO_ES_MEDICO / 409 SIN_COLEGIATURA. */
export async function asegurarMedicoPrescriptor(user: AuthPayload) {
  if (!user.profesionalId) throw new AppError('Tu usuario no está vinculado a una ficha de médico', 403, 'NO_ES_MEDICO');
  const p = await prisma.profesional.findFirst({
    where: { id: user.profesionalId, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, tipo: true, esEquipo: true, activo: true, colegiatura: true },
  });
  if (!p || p.tipo !== 'medico' || p.esEquipo || !p.activo) throw new AppError('Solo un médico colegiado puede emitir recetas', 403, 'NO_ES_MEDICO');
  const cmp = (p.colegiatura ?? '').trim();
  if (!cmp) throw new AppError('Falta registrar la colegiatura (CMP) del médico en su ficha', 409, 'SIN_COLEGIATURA');
  return { id: p.id, nombre: `${p.nombres} ${p.apellidos}`.trim(), registro: cmp };
}

/** Emisor de INDICACIONES: un profesional persona (por defecto, quien atendió). */
async function asegurarEmisorIndicaciones(profesionalId: string) {
  const p = await prisma.profesional.findFirst({
    where: { id: profesionalId, deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, esEquipo: true, colegiatura: true },
  });
  if (!p) throw new AppError('Profesional no encontrado', 404, 'PROFESIONAL_INVALIDO');
  if (p.esEquipo) throw new AppError('Un equipo no puede emitir indicaciones', 400, 'PROFESIONAL_ES_EQUIPO');
  return { id: p.id, nombre: `${p.nombres} ${p.apellidos}`.trim(), registro: limpiar(p.colegiatura) };
}

// ─── Lectores ─────────────────────────────────────────────────────────────────
const recetaInclude = {
  items: { orderBy: { orden: 'asc' }, include: { diagnostico: { select: { codigo: true, descripcion: true } } } },
  paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true, sexo: true } },
  emisor: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
  atencion: { select: { id: true, fecha: true, citaId: true, sede: { select: { id: true, nombre: true, direccion: true } } } },
  historiaClinica: { select: { numero: true, alergias: { where: { deletedAt: null, activa: true }, select: { sustancia: true, severidad: true, reaccion: true } } } },
} as const;
export type RecetaCompleta = Prisma.RecetaGetPayload<{ include: typeof recetaInclude }>;

export async function getRecetaCompleta(id: string): Promise<RecetaCompleta> {
  const r = await prisma.receta.findUnique({ where: { id }, include: recetaInclude });
  if (!r) throw new AppError('Receta no encontrada', 404);
  return r;
}

export async function listarRecetasPaciente(pacienteId: string) {
  return prisma.receta.findMany({
    where: { pacienteId },
    orderBy: { fechaEmision: 'desc' },
    select: {
      id: true, numero: true, tipoDocumento: true, estado: true, fechaEmision: true, emisorNombre: true, codigoVerificacion: true,
      atencionId: true, _count: { select: { items: true } },
      items: { orderBy: { orden: 'asc' }, select: { nombre: true, tipo: true }, take: 4 },
    },
  });
}

// ─── Emisión ──────────────────────────────────────────────────────────────────
export async function emitirReceta(p: Ctx & {
  user: AuthPayload;
  atencionId: string;
  tipoDocumento: TipoDocumentoReceta;
  emisorProfesionalId?: string | null; // solo INDICACIONES; default = profesional de la atención
  indicacionesGenerales?: string | null;
  vigenciaDias?: number | null;
  items: ItemEntrada[];
}) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: p.atencionId },
    select: { id: true, citaId: true, sedeId: true, pacienteId: true, historiaClinicaId: true, profesionalId: true },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  if (!p.items.length) throw new AppError('La receta necesita al menos un ítem', 400, 'RECETA_SIN_ITEMS');

  const esReceta = p.tipoDocumento === 'RECETA_MEDICA';
  const emisor = esReceta
    ? await asegurarMedicoPrescriptor(p.user)
    : await asegurarEmisorIndicaciones(p.emisorProfesionalId ?? at.profesionalId);

  // Resolver ítems: snapshots desde el catálogo + validaciones de tipo.
  const itemsData: Prisma.RecetaItemCreateWithoutRecetaInput[] = [];
  let orden = 0;
  for (const it of p.items) {
    let tipo: TipoItemReceta = it.tipo ?? 'MEDICAMENTO_OTC';
    let nombre = limpiar(it.nombre);
    let concentracion = limpiar(it.concentracion);
    let forma = limpiar(it.formaFarmaceutica);
    let medicamento: { id: string } | null = null;
    let servicio: { id: string } | null = null;

    if (it.medicamentoId) {
      const m = await prisma.medicamento.findFirst({ where: { id: it.medicamentoId, activo: true } });
      if (!m) throw new AppError(`Medicamento no encontrado en el vademécum: ${it.medicamentoId}`, 400, 'MEDICAMENTO_INVALIDO');
      medicamento = { id: m.id };
      nombre = nombre ?? m.dci;
      concentracion = concentracion ?? m.concentracion;
      forma = forma ?? m.formaFarmaceutica;
      if (m.esProducto) tipo = 'PRODUCTO';
      else if (m.requiereReceta) tipo = 'MEDICAMENTO_RX';
      else if (tipo === 'MEDICAMENTO_RX') tipo = 'MEDICAMENTO_OTC'; // el catálogo manda
    }
    if (it.servicioId) {
      const s = await prisma.servicio.findFirst({ where: { id: it.servicioId, deletedAt: null }, select: { id: true, nombre: true } });
      if (!s) throw new AppError('Servicio no encontrado', 400, 'SERVICIO_INVALIDO');
      servicio = { id: s.id };
      nombre = nombre ?? s.nombre;
      tipo = 'SERVICIO';
    }
    if (!nombre) throw new AppError('Cada ítem necesita nombre, medicamento o servicio', 400, 'ITEM_SIN_NOMBRE');
    if (tipo === 'MEDICAMENTO_RX' && !esReceta) {
      throw new AppError(`"${nombre}" es de venta bajo receta: debe ir en una Receta Médica firmada por médico`, 400, 'ITEM_RX_EN_INDICACIONES');
    }
    if (it.diagnosticoCie10Codigo) {
      const c = await prisma.cie10.findFirst({ where: { codigo: it.diagnosticoCie10Codigo }, select: { codigo: true } });
      if (!c) throw new AppError(`Código CIE-10 no válido: ${it.diagnosticoCie10Codigo}`, 400, 'CIE10_INVALIDO');
    }
    itemsData.push({
      tipo, nombre, marcaImpresa: limpiar(it.marcaImpresa), concentracionSnapshot: concentracion, formaSnapshot: forma,
      dosis: limpiar(it.dosis), via: limpiar(it.via), frecuencia: limpiar(it.frecuencia), duracion: limpiar(it.duracion),
      cantidad: limpiar(it.cantidad), indicaciones: limpiar(it.indicaciones), orden: orden++,
      ...(it.diagnosticoCie10Codigo ? { diagnostico: { connect: { codigo: it.diagnosticoCie10Codigo } } } : {}),
      ...(medicamento ? { medicamento: { connect: medicamento } } : {}),
      ...(servicio ? { servicio: { connect: servicio } } : {}),
    });
  }

  const receta = await prisma.$transaction(async (tx) => {
    const r = await tx.receta.create({
      data: {
        tipoDocumento: p.tipoDocumento, atencionId: at.id, historiaClinicaId: at.historiaClinicaId, pacienteId: at.pacienteId, sedeId: at.sedeId,
        emisorProfesionalId: emisor.id, emisorUsuarioId: p.usuarioId ?? null, emisorNombre: emisor.nombre, emisorRegistro: emisor.registro,
        indicacionesGenerales: limpiar(p.indicacionesGenerales), vigenciaDias: p.vigenciaDias ?? (esReceta ? 30 : null),
        codigoVerificacion: codigoVerificacion(),
        items: { create: itemsData },
      },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: at.citaId, accion: esReceta ? 'emitir_receta' : 'emitir_indicaciones', entidad: 'receta', entidadId: r.id, sedeId: at.sedeId,
      despues: { numero: r.numero, tipoDocumento: r.tipoDocumento, pacienteId: at.pacienteId, emisor: emisor.nombre, items: itemsData.map((i) => ({ tipo: i.tipo, nombre: i.nombre })) },
    });
    return r;
  });
  return getRecetaCompleta(receta.id);
}

// ─── Anulación ────────────────────────────────────────────────────────────────
/** Anula (nunca borra). Puede: quien la emitió (mismo usuario) o quien tenga hc.anular. */
export async function anularReceta(p: Ctx & { user: AuthPayload; recetaId: string; motivo: string }) {
  const r = await prisma.receta.findUnique({ where: { id: p.recetaId }, select: { id: true, estado: true, emisorUsuarioId: true, sedeId: true, numero: true, atencion: { select: { citaId: true } } } });
  if (!r) throw new AppError('Receta no encontrada', 404);
  if (r.estado === 'anulada') throw new AppError('La receta ya está anulada', 409, 'YA_ANULADA');
  const motivo = p.motivo.trim();
  if (motivo.length < 5) throw new AppError('Indica el motivo de la anulación (mín. 5 caracteres)', 400, 'MOTIVO_REQUERIDO');
  const puede = p.user.permisos.includes('hc.anular') || (!!r.emisorUsuarioId && r.emisorUsuarioId === p.user.userId);
  if (!puede) throw new AppError('Solo quien la emitió o un usuario con permiso de anulación puede anularla', 403, 'SIN_PERMISO');
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  await prisma.$transaction(async (tx) => {
    await tx.receta.update({ where: { id: r.id }, data: { estado: 'anulada', anuladaEn: new Date(), anuladaPorUsuarioId: p.usuarioId ?? null, motivoAnulacion: motivo } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: r.atencion.citaId, accion: 'anular_receta', entidad: 'receta', entidadId: r.id, sedeId: r.sedeId, despues: { numero: r.numero, motivo, por: etiqueta } });
  });
  return getRecetaCompleta(r.id);
}

// ─── Advertencias al prescribir (3.1): alergias registradas vs ítems ─────────
/** Cruce simple por texto: sustancia de la alergia contenida en el nombre/marca del ítem o viceversa. */
export function advertenciasAlergia(
  alergias: { sustancia: string; severidad: string }[],
  items: { nombre: string; marcaImpresa?: string | null }[],
): { item: string; sustancia: string; severidad: string }[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out: { item: string; sustancia: string; severidad: string }[] = [];
  for (const a of alergias) {
    const sust = norm(a.sustancia);
    if (sust.length < 3) continue;
    for (const it of items) {
      const txt = norm(`${it.nombre} ${it.marcaImpresa ?? ''}`);
      if (txt.includes(sust) || sust.includes(norm(it.nombre))) out.push({ item: it.nombre, sustancia: a.sustancia, severidad: a.severidad });
    }
  }
  return out;
}
