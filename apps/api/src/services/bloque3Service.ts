/**
 * Bloque 3 — Consulta enriquecida: procedimientos, escalas clínicas y podograma.
 *
 * Extensión del módulo de Historia Clínica (mismo estilo y reglas que
 * `historiaClinicaService.ts`): todo cuelga de una AtencionClinica, es EDITABLE en
 * la vista clínica, con borrado suave (`deletedAt`) + auditoría; los autores se
 * guardan como uuid plano + etiqueta (snapshot), sin FK a Usuario.
 *
 *  · Procedimientos (1.11): matricectomía, láser, curación, etc. Los de tipo láser
 *    pueden ligarse a una membresía (PaquetePaciente) para el conteo de sesiones (1.12).
 *  · Escalas (2.1–2.5): EVA, Wagner, Texas, IWGDF, monofilamento. El detalle va en
 *    `datos` (Json) y el backend calcula la etiqueta legible (`resultado`).
 *  · Podograma (1.3): marcas con coordenadas normalizadas (0..1) sobre la silueta.
 */
import path from 'path';
import fs from 'fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { UPLOADS_ROOT, rutaRelativaUpload } from '../middleware/uploadPodograma';
import { auditEnTx } from './audit';
import { Ctx, ctxAudit, etiquetaUsuario, atencionOr404, getAtencionCompleta } from './historiaClinicaService';

const limpiar = (s?: string | null) => { const t = (s ?? '').trim(); return t ? t : null; };

/** "Apellidos, Nombres" de un profesional (snapshot para mostrar quién realizó). */
async function etiquetaProfesional(profesionalId?: string | null): Promise<string | null> {
  if (!profesionalId) return null;
  const p = await prisma.profesional.findFirst({ where: { id: profesionalId, deletedAt: null }, select: { nombres: true, apellidos: true } });
  if (!p) throw new AppError('Profesional no encontrado', 404, 'PROFESIONAL_INVALIDO');
  return `${p.apellidos ?? ''} ${p.nombres ?? ''}`.trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.11 / 1.12 · Procedimientos
// ─────────────────────────────────────────────────────────────────────────────
const TIPOS_PROCEDIMIENTO = ['matricectomia', 'laser', 'curacion', 'debridacion', 'onicotomia', 'quiropodia', 'infiltracion', 'otro'] as const;
const PIES = ['izquierdo', 'derecho', 'ambos'] as const;

export interface CamposProcedimiento {
  tipo?: string;
  nombre?: string;
  pie?: string | null;
  ubicacion?: string | null;
  detalle?: string | null;
  parametros?: Prisma.InputJsonValue | null;
  anestesia?: string | null;
  paquetePacienteId?: string | null;
  sesionNumero?: number | null;
  profesionalId?: string | null;
}

function assertTipoProcedimiento(tipo: string): string {
  const t = tipo.trim().toLowerCase();
  if (!TIPOS_PROCEDIMIENTO.includes(t as (typeof TIPOS_PROCEDIMIENTO)[number])) {
    throw new AppError(`Tipo de procedimiento no válido: ${tipo}`, 400, 'PROCEDIMIENTO_TIPO_INVALIDO');
  }
  return t;
}
function assertPie(pie?: string | null): string | null {
  const p = limpiar(pie);
  if (!p) return null;
  if (!PIES.includes(p as (typeof PIES)[number])) throw new AppError(`Lado no válido: ${pie}`, 400, 'PIE_INVALIDO');
  return p;
}

/** Valida que el paquete-membresía pertenezca al paciente de la atención y devuelve su total de sesiones. */
async function resolverPaqueteLaser(paquetePacienteId: string, pacienteId: string): Promise<{ sesionesTotales: number; sugeridaSiguiente: number }> {
  const paq = await prisma.paquetePaciente.findFirst({ where: { id: paquetePacienteId }, select: { pacienteId: true, sesionesTotal: true, sesionesUsadas: true } });
  if (!paq) throw new AppError('Membresía no encontrada', 404, 'PAQUETE_INVALIDO');
  if (paq.pacienteId !== pacienteId) throw new AppError('La membresía no pertenece a este paciente', 400, 'PAQUETE_OTRO_PACIENTE');
  return { sesionesTotales: paq.sesionesTotal, sugeridaSiguiente: paq.sesionesUsadas + 1 };
}

export async function agregarProcedimiento(p: Ctx & CamposProcedimiento & { atencionId: string }) {
  const at = await atencionOr404(p.atencionId);
  const tipo = assertTipoProcedimiento(p.tipo ?? '');
  const nombre = limpiar(p.nombre) ?? etiquetaTipoProcedimiento(tipo);
  const pie = assertPie(p.pie);
  const profesionalEtiqueta = await etiquetaProfesional(p.profesionalId);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);

  let paquetePacienteId: string | null = null;
  let sesionNumero: number | null = p.sesionNumero ?? null;
  let sesionesTotales: number | null = null;
  if (p.paquetePacienteId) {
    const info = await resolverPaqueteLaser(p.paquetePacienteId, at.pacienteId);
    paquetePacienteId = p.paquetePacienteId;
    sesionesTotales = info.sesionesTotales;
    if (sesionNumero == null) sesionNumero = info.sugeridaSiguiente;
  }

  const creado = await prisma.$transaction(async (tx) => {
    const row = await tx.procedimientoAtencion.create({
      data: {
        atencionId: at.id, tipo, nombre, pie, ubicacion: limpiar(p.ubicacion), detalle: limpiar(p.detalle),
        parametros: (p.parametros ?? undefined) as Prisma.InputJsonValue | undefined, anestesia: limpiar(p.anestesia),
        paquetePacienteId, sesionNumero, sesionesTotales,
        profesionalId: p.profesionalId ?? null, profesionalEtiqueta,
        registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta,
      },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'agregar_procedimiento', entidad: 'procedimiento_atencion', entidadId: row.id, sedeId: at.sedeId, despues: { tipo, nombre, pie, paquetePacienteId, sesionNumero } });
    return row;
  });
  void creado;
  return getAtencionCompleta(at.id);
}

export async function editarProcedimiento(p: Ctx & CamposProcedimiento & { procedimientoId: string }) {
  const row = await prisma.procedimientoAtencion.findFirst({ where: { id: p.procedimientoId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true, pacienteId: true } } } });
  if (!row) throw new AppError('Procedimiento no encontrado', 404);
  const data: Prisma.ProcedimientoAtencionUpdateInput = {};
  if (p.tipo !== undefined) data.tipo = assertTipoProcedimiento(p.tipo);
  if (p.nombre !== undefined) { const n = limpiar(p.nombre); if (!n) throw new AppError('El nombre no puede quedar vacío', 400); data.nombre = n; }
  if (p.pie !== undefined) data.pie = assertPie(p.pie);
  if (p.ubicacion !== undefined) data.ubicacion = limpiar(p.ubicacion);
  if (p.detalle !== undefined) data.detalle = limpiar(p.detalle);
  if (p.anestesia !== undefined) data.anestesia = limpiar(p.anestesia);
  if (p.parametros !== undefined) data.parametros = p.parametros === null ? Prisma.DbNull : (p.parametros as Prisma.InputJsonValue);
  if (p.sesionNumero !== undefined) data.sesionNumero = p.sesionNumero ?? null;
  if (p.profesionalId !== undefined) { data.profesionalId = p.profesionalId ?? null; data.profesionalEtiqueta = await etiquetaProfesional(p.profesionalId); }
  if (p.paquetePacienteId !== undefined) {
    if (p.paquetePacienteId) { const info = await resolverPaqueteLaser(p.paquetePacienteId, row.atencion.pacienteId); data.paquetePaciente = { connect: { id: p.paquetePacienteId } }; data.sesionesTotales = info.sesionesTotales; }
    else { data.paquetePaciente = { disconnect: true }; data.sesionesTotales = null; }
  }
  await prisma.$transaction(async (tx) => {
    await tx.procedimientoAtencion.update({ where: { id: row.id }, data });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'editar_procedimiento', entidad: 'procedimiento_atencion', entidadId: row.id, sedeId: row.atencion.sedeId, despues: { tipo: p.tipo, nombre: p.nombre } });
  });
  return getAtencionCompleta(row.atencion.id);
}

export async function eliminarProcedimiento(p: Ctx & { procedimientoId: string }) {
  const row = await prisma.procedimientoAtencion.findFirst({ where: { id: p.procedimientoId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!row) throw new AppError('Procedimiento no encontrado', 404);
  await prisma.$transaction(async (tx) => {
    await tx.procedimientoAtencion.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'eliminar_procedimiento', entidad: 'procedimiento_atencion', entidadId: row.id, sedeId: row.atencion.sedeId, antes: { tipo: row.tipo, nombre: row.nombre } });
  });
  return getAtencionCompleta(row.atencion.id);
}

function etiquetaTipoProcedimiento(tipo: string): string {
  const map: Record<string, string> = {
    matricectomia: 'Matricectomía', laser: 'Láser', curacion: 'Curación', debridacion: 'Debridación',
    onicotomia: 'Onicotomía', quiropodia: 'Quiropodia', infiltracion: 'Infiltración', otro: 'Procedimiento',
  };
  return map[tipo] ?? 'Procedimiento';
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.1–2.5 · Escalas clínicas (EVA, Wagner, Texas, IWGDF, monofilamento)
// ─────────────────────────────────────────────────────────────────────────────
const TIPOS_ESCALA = ['eva', 'wagner', 'texas', 'iwgdf', 'monofilamento'] as const;
type TipoEscala = (typeof TIPOS_ESCALA)[number];

function assertTipoEscala(tipo: string): TipoEscala {
  const t = tipo.trim().toLowerCase();
  if (!TIPOS_ESCALA.includes(t as TipoEscala)) throw new AppError(`Tipo de escala no válido: ${tipo}`, 400, 'ESCALA_TIPO_INVALIDA');
  return t as TipoEscala;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Calcula la etiqueta legible de una escala a partir de sus datos. Defensivo: nunca lanza. */
export function calcularResultadoEscala(tipo: TipoEscala, datos: Record<string, unknown>): string {
  try {
    switch (tipo) {
      case 'eva': {
        const v = num(datos.valor);
        if (v == null) return 'EVA sin valor';
        const cat = v === 0 ? 'Sin dolor' : v <= 3 ? 'Leve' : v <= 6 ? 'Moderado' : v <= 9 ? 'Intenso' : 'Máximo';
        return `EVA ${v}/10 — ${cat}`;
      }
      case 'wagner': {
        const g = num(datos.grado);
        const desc: Record<number, string> = { 0: 'Piel intacta / sin lesión', 1: 'Úlcera superficial', 2: 'Úlcera profunda (tendón/cápsula)', 3: 'Absceso u osteomielitis', 4: 'Gangrena localizada', 5: 'Gangrena extensa' };
        return g == null ? 'Wagner sin grado' : `Wagner grado ${g} — ${desc[g] ?? '—'}`;
      }
      case 'texas': {
        const g = num(datos.grado);
        const est = typeof datos.estadio === 'string' ? datos.estadio.toUpperCase() : null;
        const dg: Record<number, string> = { 0: 'Pre/post-ulcerativa', 1: 'Superficial', 2: 'Tendón o cápsula', 3: 'Hueso o articulación' };
        const de: Record<string, string> = { A: 'Sin infección ni isquemia', B: 'Infección', C: 'Isquemia', D: 'Infección + isquemia' };
        if (g == null || !est) return 'Texas incompleto';
        return `Texas ${g}-${est} — ${dg[g] ?? '—'} / ${de[est] ?? '—'}`;
      }
      case 'iwgdf': {
        const c = num(datos.categoria);
        const riesgo: Record<number, string> = { 0: 'Muy bajo', 1: 'Bajo', 2: 'Moderado', 3: 'Alto' };
        const control: Record<number, string> = { 0: 'control anual', 1: 'control 6–12 meses', 2: 'control 3–6 meses', 3: 'control 1–3 meses' };
        return c == null ? 'IWGDF sin categoría' : `IWGDF categoría ${c} — Riesgo ${riesgo[c] ?? '—'} (${control[c] ?? '—'})`;
      }
      case 'monofilamento': {
        const resumen = (lado: unknown): string | null => {
          if (!Array.isArray(lado)) return null;
          const total = lado.length;
          const percibidos = lado.filter((x) => x === true).length;
          return `${percibidos}/${total}`;
        };
        const izq = resumen(datos.izquierdo);
        const der = resumen(datos.derecho);
        const partes: string[] = [];
        if (izq) partes.push(`Izq ${izq}`);
        if (der) partes.push(`Der ${der}`);
        if (!partes.length) return 'Monofilamento sin registro';
        // Pérdida de sensibilidad protectora si algún punto no se percibe.
        const alterado = [datos.izquierdo, datos.derecho].some((l) => Array.isArray(l) && l.some((x) => x === false));
        return `Monofilamento — ${partes.join(', ')} percibidos${alterado ? ' · sensibilidad protectora disminuida' : ''}`;
      }
      default:
        return '—';
    }
  } catch {
    return '—';
  }
}

export async function guardarEscala(p: Ctx & { atencionId: string; tipo: string; datos: Record<string, unknown>; pie?: string | null }) {
  const at = await atencionOr404(p.atencionId);
  const tipo = assertTipoEscala(p.tipo);
  if (!p.datos || typeof p.datos !== 'object') throw new AppError('Faltan los datos de la escala', 400, 'ESCALA_DATOS_REQUERIDOS');
  const pie = assertPie(p.pie);
  const resultado = calcularResultadoEscala(tipo, p.datos);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const creado = await prisma.$transaction(async (tx) => {
    const row = await tx.escalaClinica.create({
      data: { atencionId: at.id, tipo, datos: p.datos as Prisma.InputJsonValue, resultado, pie, registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'guardar_escala', entidad: 'escala_clinica', entidadId: row.id, sedeId: at.sedeId, despues: { tipo, resultado } });
    return row;
  });
  void creado;
  return getAtencionCompleta(at.id);
}

export async function editarEscala(p: Ctx & { escalaId: string; datos?: Record<string, unknown>; pie?: string | null }) {
  const row = await prisma.escalaClinica.findFirst({ where: { id: p.escalaId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!row) throw new AppError('Escala no encontrada', 404);
  const data: Prisma.EscalaClinicaUpdateInput = {};
  if (p.datos !== undefined) {
    if (!p.datos || typeof p.datos !== 'object') throw new AppError('Faltan los datos de la escala', 400, 'ESCALA_DATOS_REQUERIDOS');
    data.datos = p.datos as Prisma.InputJsonValue;
    data.resultado = calcularResultadoEscala(row.tipo as TipoEscala, p.datos);
  }
  if (p.pie !== undefined) data.pie = assertPie(p.pie);
  await prisma.$transaction(async (tx) => {
    await tx.escalaClinica.update({ where: { id: row.id }, data });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'editar_escala', entidad: 'escala_clinica', entidadId: row.id, sedeId: row.atencion.sedeId, despues: { tipo: row.tipo } });
  });
  return getAtencionCompleta(row.atencion.id);
}

export async function eliminarEscala(p: Ctx & { escalaId: string }) {
  const row = await prisma.escalaClinica.findFirst({ where: { id: p.escalaId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!row) throw new AppError('Escala no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.escalaClinica.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'eliminar_escala', entidad: 'escala_clinica', entidadId: row.id, sedeId: row.atencion.sedeId, antes: { tipo: row.tipo, resultado: row.resultado } });
  });
  return getAtencionCompleta(row.atencion.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.3 · Podograma (marcas sobre la silueta del pie)
// ─────────────────────────────────────────────────────────────────────────────
const PIES_PODOGRAMA = ['izquierdo', 'derecho'] as const;
const TIPOS_LESION = ['hiperqueratosis', 'heloma', 'onicocriptosis', 'ulcera', 'fisura', 'micosis', 'ampolla', 'verruga', 'otro'] as const;

function assertPiePodograma(pie: string): string {
  const p = (pie ?? '').trim().toLowerCase();
  if (!PIES_PODOGRAMA.includes(p as (typeof PIES_PODOGRAMA)[number])) throw new AppError('Indica el pie (izquierdo o derecho)', 400, 'PIE_INVALIDO');
  return p;
}
function assertTipoLesion(tipo: string): string {
  const t = (tipo ?? '').trim().toLowerCase();
  if (!TIPOS_LESION.includes(t as (typeof TIPOS_LESION)[number])) throw new AppError(`Tipo de lesión no válido: ${tipo}`, 400, 'LESION_TIPO_INVALIDA');
  return t;
}
function assertCoord(v: unknown, eje: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new AppError(`Coordenada ${eje} fuera de rango (0..1)`, 400, 'COORDENADA_INVALIDA');
  return v;
}

export async function agregarMarca(p: Ctx & { atencionId: string; pie: string; x: number; y: number; zona?: string | null; tipoLesion: string; nota?: string | null }) {
  const at = await atencionOr404(p.atencionId);
  const pie = assertPiePodograma(p.pie);
  const tipoLesion = assertTipoLesion(p.tipoLesion);
  const x = assertCoord(p.x, 'x');
  const y = assertCoord(p.y, 'y');
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const creado = await prisma.$transaction(async (tx) => {
    const row = await tx.marcaPodograma.create({
      data: { atencionId: at.id, pie, x, y, zona: limpiar(p.zona), tipoLesion, nota: limpiar(p.nota), registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'agregar_marca_podograma', entidad: 'marca_podograma', entidadId: row.id, sedeId: at.sedeId, despues: { pie, tipoLesion, x, y } });
    return row;
  });
  void creado;
  return getAtencionCompleta(at.id);
}

export async function editarMarca(p: Ctx & { marcaId: string; pie?: string; x?: number; y?: number; zona?: string | null; tipoLesion?: string; nota?: string | null }) {
  const row = await prisma.marcaPodograma.findFirst({ where: { id: p.marcaId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!row) throw new AppError('Marca no encontrada', 404);
  const data: Prisma.MarcaPodogramaUpdateInput = {};
  if (p.pie !== undefined) data.pie = assertPiePodograma(p.pie);
  if (p.tipoLesion !== undefined) data.tipoLesion = assertTipoLesion(p.tipoLesion);
  if (p.x !== undefined) data.x = assertCoord(p.x, 'x');
  if (p.y !== undefined) data.y = assertCoord(p.y, 'y');
  if (p.zona !== undefined) data.zona = limpiar(p.zona);
  if (p.nota !== undefined) data.nota = limpiar(p.nota);
  await prisma.$transaction(async (tx) => {
    await tx.marcaPodograma.update({ where: { id: row.id }, data });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'editar_marca_podograma', entidad: 'marca_podograma', entidadId: row.id, sedeId: row.atencion.sedeId });
  });
  return getAtencionCompleta(row.atencion.id);
}

export async function eliminarMarca(p: Ctx & { marcaId: string }) {
  const row = await prisma.marcaPodograma.findFirst({ where: { id: p.marcaId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!row) throw new AppError('Marca no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.marcaPodograma.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: row.atencion.citaId, accion: 'eliminar_marca_podograma', entidad: 'marca_podograma', entidadId: row.id, sedeId: row.atencion.sedeId, antes: { pie: row.pie, tipoLesion: row.tipoLesion } });
  });
  return getAtencionCompleta(row.atencion.id);
}

/** Membresías/paquetes de láser vivos del paciente (para ligar un procedimiento láser, 1.12). */
export async function paquetesLaserVivos(pacienteId: string) {
  const paquetes = await prisma.paquetePaciente.findMany({
    where: { pacienteId, activo: true, estado: 'ACTIVO' },
    select: { id: true, sesionesTotal: true, sesionesUsadas: true, vigenciaFin: true, paquete: { select: { nombre: true } }, servicioNuevo: { select: { nombre: true } } },
    orderBy: { creadoEn: 'desc' },
  });
  return paquetes.map((q) => ({
    id: q.id,
    nombre: q.paquete?.nombre ?? q.servicioNuevo?.nombre ?? 'Membresía',
    sesionesTotal: q.sesionesTotal,
    sesionesUsadas: q.sesionesUsadas,
    sesionesRestantes: Math.max(0, q.sesionesTotal - q.sesionesUsadas),
    vigenciaFin: q.vigenciaFin,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.3b · Imágenes del podograma (plataforma Baro) + anotaciones vectoriales
// El archivo NUNCA se modifica ni se borra físicamente (evidencia clínica, retención de HC);
// las anotaciones (trazos/textos en 0..1) viven en `anotaciones` y cada guardado se audita.
// ─────────────────────────────────────────────────────────────────────────────
export interface ArchivoSubido { path: string; originalname: string; mimetype: string; size: number }

// Las 4 vistas fijas que entrega la Baro. Máx. 1 imagen viva por (atención, vista): al subir otra
// a la misma vista, la anterior se REEMPLAZA (borrado suave, archivo conservado, auditado).
export const VISTAS_PODOGRAMA = ['frontal_izquierdo', 'frontal_derecho', 'posterior_izquierdo', 'posterior_derecho'] as const;
export type VistaPodograma = (typeof VISTAS_PODOGRAMA)[number];
function assertVista(v?: string | null): VistaPodograma | null {
  const s = limpiar(v)?.toLowerCase() ?? null;
  if (!s) return null;
  if (!VISTAS_PODOGRAMA.includes(s as VistaPodograma)) throw new AppError(`Vista de podograma no válida: ${v}`, 400, 'VISTA_INVALIDA');
  return s as VistaPodograma;
}

export async function registrarImagenPodograma(p: Ctx & { atencionId: string; archivo: ArchivoSubido; descripcion?: string | null; vista?: string | null }) {
  const at = await atencionOr404(p.atencionId);
  const vista = assertVista(p.vista);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const ruta = rutaRelativaUpload(p.archivo.path);
  await prisma.$transaction(async (tx) => {
    if (vista) {
      const previa = await tx.imagenPodograma.findFirst({ where: { atencionId: at.id, vista, deletedAt: null }, select: { id: true, nombreArchivo: true } });
      if (previa) {
        await tx.imagenPodograma.update({ where: { id: previa.id }, data: { deletedAt: new Date() } });
        await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'reemplazar_imagen_podograma', entidad: 'imagen_podograma', entidadId: previa.id, sedeId: at.sedeId, antes: { nombreArchivo: previa.nombreArchivo, vista } });
      }
    }
    const row = await tx.imagenPodograma.create({
      data: {
        atencionId: at.id, vista, nombreArchivo: (p.archivo.originalname || 'podograma').slice(0, 200), ruta, mime: p.archivo.mimetype,
        tamano: p.archivo.size, descripcion: limpiar(p.descripcion), subidoPorUsuarioId: p.usuarioId ?? null, subidoEtiqueta: etiqueta,
      },
    });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: at.citaId, accion: 'subir_imagen_podograma', entidad: 'imagen_podograma', entidadId: row.id, sedeId: at.sedeId, despues: { nombreArchivo: row.nombreArchivo, mime: row.mime, tamano: row.tamano, vista } });
  });
  return getAtencionCompleta(at.id);
}

/** Localiza el archivo de una imagen (para servirlo). Blinda contra path traversal. */
export async function archivoImagenPodograma(imagenId: string) {
  const img = await prisma.imagenPodograma.findFirst({
    where: { id: imagenId, deletedAt: null },
    select: { id: true, ruta: true, mime: true, nombreArchivo: true, atencion: { select: { id: true, sedeId: true, pacienteId: true } } },
  });
  if (!img) throw new AppError('Imagen no encontrada', 404);
  const abs = path.resolve(UPLOADS_ROOT, img.ruta);
  if (!abs.startsWith(UPLOADS_ROOT + path.sep)) throw new AppError('Ruta de archivo inválida', 400);
  if (!fs.existsSync(abs)) throw new AppError('El archivo de la imagen no está disponible', 404, 'ARCHIVO_NO_DISPONIBLE');
  return { ...img, rutaAbsoluta: abs };
}

const MAX_ANOTACIONES = 3000;
const MAX_PUNTOS_TRAZO = 5000;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const esCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const redondear = (v: number) => Math.round(v * 10000) / 10000;
const invalida = (m: string) => new AppError(m, 400, 'ANOTACIONES_INVALIDAS');

/** Sanea la capa de anotaciones: solo trazos y textos con coordenadas 0..1, colores hex y tamaños acotados. */
export function validarAnotaciones(raw: unknown): Prisma.InputJsonValue {
  if (!Array.isArray(raw)) throw invalida('Las anotaciones deben ser una lista');
  if (raw.length > MAX_ANOTACIONES) throw invalida(`Demasiadas anotaciones (máx. ${MAX_ANOTACIONES})`);
  const out: Record<string, unknown>[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') throw invalida('Anotación mal formada');
    const o = a as Record<string, unknown>;
    const color = typeof o.color === 'string' && COLOR_RE.test(o.color) ? o.color.toLowerCase() : '#ef4444';
    if (o.tipo === 'trazo') {
      const puntos = Array.isArray(o.puntos) ? o.puntos : [];
      if (puntos.length < 1 || puntos.length > MAX_PUNTOS_TRAZO) throw invalida('Trazo sin puntos o demasiado largo');
      const limpios = puntos.map((pt) => {
        if (!Array.isArray(pt) || !esCoord(pt[0]) || !esCoord(pt[1])) throw invalida('Punto fuera de la imagen');
        return [redondear(pt[0]), redondear(pt[1])];
      });
      const grosor = typeof o.grosor === 'number' && o.grosor >= 1 && o.grosor <= 40 ? Math.round(o.grosor) : 4;
      out.push({ tipo: 'trazo', color, grosor, puntos: limpios });
    } else if (o.tipo === 'texto') {
      if (!esCoord(o.x) || !esCoord(o.y)) throw invalida('Texto fuera de la imagen');
      const texto = typeof o.texto === 'string' ? o.texto.trim().slice(0, 200) : '';
      if (!texto) throw invalida('Texto vacío');
      out.push({ tipo: 'texto', x: redondear(o.x), y: redondear(o.y), texto, color });
    } else {
      throw invalida('Tipo de anotación no válido');
    }
  }
  return out as unknown as Prisma.InputJsonValue;
}

export async function guardarAnotacionesPodograma(p: Ctx & { imagenId: string; anotaciones: unknown }) {
  const img = await prisma.imagenPodograma.findFirst({ where: { id: p.imagenId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!img) throw new AppError('Imagen no encontrada', 404);
  const anotaciones = validarAnotaciones(p.anotaciones);
  const antes = Array.isArray(img.anotaciones) ? img.anotaciones.length : 0;
  const despues = (anotaciones as unknown[]).length;
  await prisma.$transaction(async (tx) => {
    await tx.imagenPodograma.update({ where: { id: img.id }, data: { anotaciones } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: img.atencion.citaId, accion: 'anotar_podograma', entidad: 'imagen_podograma', entidadId: img.id, sedeId: img.atencion.sedeId, antes: { anotaciones: antes }, despues: { anotaciones: despues } });
  });
  return getAtencionCompleta(img.atencion.id);
}

/** Borrado SUAVE: la fila y el archivo se conservan (retención de HC); deja de listarse. */
export async function eliminarImagenPodograma(p: Ctx & { imagenId: string }) {
  const img = await prisma.imagenPodograma.findFirst({ where: { id: p.imagenId, deletedAt: null }, include: { atencion: { select: { id: true, citaId: true, sedeId: true } } } });
  if (!img) throw new AppError('Imagen no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.imagenPodograma.update({ where: { id: img.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), citaId: img.atencion.citaId, accion: 'eliminar_imagen_podograma', entidad: 'imagen_podograma', entidadId: img.id, sedeId: img.atencion.sedeId, antes: { nombreArchivo: img.nombreArchivo } });
  });
  return getAtencionCompleta(img.atencion.id);
}
