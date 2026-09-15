/**
 * Controles sugeridos (4.1) y su alerta (4.2).
 *
 * Al CERRAR la atención se proponen los próximos controles y el profesional elige cuáles guardar:
 *  - IWGDF: según la última categoría de riesgo del pie del paciente (0 → 12 meses, 1 → 6,
 *    2 → 3, 3 → 1; el extremo más prudente de cada rango de la guía).
 *  - Indicación: cada servicio indicado en la receta de indicaciones (ítems SERVICIO), con la
 *    frecuencia escrita («cada 15 días», «semanal», «1 mes»…); sin frecuencia legible, 7 días.
 *  - Manual: el que agregue el profesional.
 * Quedan «pendiente» hasta que recepción o el profesional los marca «agendado» (con la cita, si
 * ya existe) o «descartado» (con motivo). La bandeja clínica los lista y el menú muestra cuántos
 * vencen en 7 días o ya vencieron. Solo tipos se importan de historiaClinicaService (sin ciclo).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { fechaAStr, fechaDb, hoyLimaStr } from '../utils/fechaLima';
import type { Ctx } from './historiaClinicaService';
import { categoriaIwgdfDe } from './bloque3Service';

type Tx = Prisma.TransactionClient;
const ctxAudit = (c: Ctx) => ({ usuarioId: c.usuarioId, ip: c.ip, userAgent: c.userAgent });

export const MESES_IWGDF: Record<number, number> = { 0: 12, 1: 6, 2: 3, 3: 1 };
export const RIESGO_IWGDF: Record<number, string> = { 0: 'muy bajo', 1: 'bajo', 2: 'moderado', 3: 'alto' };
export type OrigenControl = 'iwgdf' | 'indicacion' | 'manual';

export interface ControlEntrada { fechaSugerida: string; motivo: string; origen: OrigenControl; servicioId?: string | null }
export interface SugerenciaControl extends ControlEntrada { riesgo: number | null; servicioNombre: string | null }

// ─── Fechas (YYYY-MM-DD, calendario de Lima) ─────────────────────────────────
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
/** Suma meses sin desbordar (31-ene + 1 mes = 28/29-feb, no 3-mar). */
export function sumarMeses(fecha: string, meses: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.toISOString().slice(0, 10);
}
const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);

/** Días entre sesiones a partir del texto de frecuencia de la indicación; null si no se entiende. */
export function diasDeFrecuencia(texto?: string | null): number | null {
  if (!texto) return null;
  const s = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/diari|cada dia\b/.test(s)) return 1;
  if (/quincen/.test(s)) return 15;
  if (/semanal/.test(s)) return 7;
  if (/mensual/.test(s)) return 30;
  if (/anual/.test(s)) return 365;
  const m = s.match(/(\d+)\s*(dia|semana|mes|ano)/);
  if (!m) return null;
  const n = Number(m[1]);
  const d = m[2] === 'dia' ? n : m[2] === 'semana' ? n * 7 : m[2] === 'mes' ? n * 30 : n * 365;
  return d >= 1 ? d : null;
}

/** Categoría IWGDF más reciente de cada paciente (de su `resultado` o de `datos.categoria`). */
export async function categoriaIwgdf(pacienteIds: string[]): Promise<Map<string, number>> {
  const res = new Map<string, number>();
  if (!pacienteIds.length) return res;
  const escalas = await prisma.escalaClinica.findMany({
    where: { tipo: 'iwgdf', deletedAt: null, atencion: { pacienteId: { in: pacienteIds } } },
    orderBy: { creadoEn: 'desc' },
    select: { resultado: true, datos: true, atencion: { select: { pacienteId: true } } },
  });
  for (const e of escalas) {
    const pid = e.atencion.pacienteId;
    if (res.has(pid)) continue;
    const c = categoriaIwgdfDe(e);
    if (c != null) res.set(pid, c);
  }
  return res;
}

// ─── Sugerencias al cerrar ────────────────────────────────────────────────────
export async function sugerirControles(atencionId: string) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: atencionId },
    select: {
      id: true, pacienteId: true, servicioId: true, servicio: { select: { nombre: true } },
      recetas: {
        where: { estado: 'emitida' },
        select: { items: { where: { tipo: 'SERVICIO' }, select: { nombre: true, servicioId: true, frecuencia: true, duracion: true, servicio: { select: { nombre: true } } } } },
      },
    },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  const hoy = hoyLimaStr();
  const sugerencias: SugerenciaControl[] = [];

  const cat = (await categoriaIwgdf([at.pacienteId])).get(at.pacienteId);
  if (cat != null) {
    const meses = MESES_IWGDF[cat];
    sugerencias.push({
      origen: 'iwgdf', riesgo: cat, fechaSugerida: sumarMeses(hoy, meses), servicioId: at.servicioId, servicioNombre: at.servicio.nombre,
      motivo: `Control de pie en riesgo · IWGDF ${cat} (riesgo ${RIESGO_IWGDF[cat]}): cada ${meses} ${meses === 1 ? 'mes' : 'meses'}`,
    });
  }
  const vistos = new Set<string>();
  for (const it of at.recetas.flatMap((r) => r.items)) {
    const clave = it.servicioId ?? it.nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const nombre = it.servicio?.nombre ?? it.nombre;
    sugerencias.push({
      origen: 'indicacion', riesgo: null, fechaSugerida: sumarDias(hoy, diasDeFrecuencia(it.frecuencia) ?? 7),
      servicioId: it.servicioId, servicioNombre: nombre,
      motivo: [nombre, it.frecuencia, it.duracion].filter(Boolean).join(' · ').slice(0, 300),
    });
  }
  const pendientes = await prisma.controlSugerido.findMany({
    where: { pacienteId: at.pacienteId, estado: 'pendiente' },
    orderBy: { fechaSugerida: 'asc' },
    select: { id: true, fechaSugerida: true, motivo: true, origen: true },
  });
  return { hoy, sugerencias, pendientes: pendientes.map((c) => ({ ...c, fechaSugerida: fechaAStr(c.fechaSugerida) })) };
}

/** Valida los controles elegidos al cerrar (fechas desde hoy hasta 3 años, servicio existente). */
export async function validarControles(controles: ControlEntrada[]): Promise<ControlEntrada[]> {
  const hoy = hoyLimaStr();
  const tope = sumarMeses(hoy, 36);
  for (const c of controles) {
    // Fecha real del calendario («2026-02-30» no vale aunque Date.parse la acepte).
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.fechaSugerida);
    const real = m && new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)).toISOString().slice(0, 10) === c.fechaSugerida;
    if (!real) throw new AppError('Fecha de control no válida', 400, 'FECHA_CONTROL_INVALIDA');
    if (c.fechaSugerida < hoy) throw new AppError('El control no puede quedar en una fecha pasada', 400, 'FECHA_CONTROL_PASADA');
    if (c.fechaSugerida > tope) throw new AppError('El control no puede quedar a más de 3 años', 400, 'FECHA_CONTROL_LEJANA');
  }
  const ids = [...new Set(controles.map((c) => c.servicioId).filter((x): x is string => !!x))];
  if (ids.length && (await prisma.servicio.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError('Servicio del control no encontrado', 400, 'SERVICIO_NO_ENCONTRADO');
  }
  return controles.map((c) => ({ ...c, motivo: c.motivo.trim() }));
}

export async function crearControlesEnTx(tx: Tx, p: {
  ctx: Ctx; atencion: { id: string; pacienteId: string; sedeId: string; citaId: string }; controles: ControlEntrada[]; etiqueta: string | null;
}) {
  for (const c of p.controles) {
    // Reabrir y volver a cerrar propone los mismos controles: no se duplica uno pendiente idéntico.
    const repetido = await tx.controlSugerido.findFirst({
      where: { pacienteId: p.atencion.pacienteId, estado: 'pendiente', fechaSugerida: fechaDb(c.fechaSugerida), motivo: c.motivo },
      select: { id: true },
    });
    if (repetido) continue;
    const creado = await tx.controlSugerido.create({
      data: {
        atencionId: p.atencion.id, pacienteId: p.atencion.pacienteId, sedeId: p.atencion.sedeId, servicioId: c.servicioId ?? null,
        fechaSugerida: fechaDb(c.fechaSugerida), motivo: c.motivo, origen: c.origen,
        registradoPorUsuarioId: p.ctx.usuarioId ?? null, registradoEtiqueta: p.etiqueta,
      },
      select: { id: true },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p.ctx), citaId: p.atencion.citaId, sedeId: p.atencion.sedeId, accion: 'sugerir_control', entidad: 'control_sugerido', entidadId: creado.id,
      despues: { fechaSugerida: c.fechaSugerida, motivo: c.motivo, origen: c.origen },
    });
  }
}

// ─── Bandeja y alerta ────────────────────────────────────────────────────────
type Alcance = { sedeIds: string[] | null; profesionalId?: string | null };
const whereAlcance = (a: Alcance): Prisma.ControlSugeridoWhereInput => ({
  ...(a.sedeIds ? { sedeId: { in: a.sedeIds } } : {}),
  ...(a.profesionalId ? { atencion: { profesionalId: a.profesionalId } } : {}),
});

/** Pendientes que vencen dentro de `horizonteDias` (o ya vencieron), con riesgo y próxima cita. */
export async function listarControles(p: Alcance & { horizonteDias?: number }) {
  const hoy = hoyLimaStr();
  const horizonte = p.horizonteDias ?? 14;
  const filas = await prisma.controlSugerido.findMany({
    where: { estado: 'pendiente', fechaSugerida: { lte: fechaDb(sumarDias(hoy, horizonte)) }, ...whereAlcance(p) },
    orderBy: [{ fechaSugerida: 'asc' }, { creadoEn: 'asc' }],
    take: 300,
    select: {
      id: true, pacienteId: true, fechaSugerida: true, motivo: true, origen: true, registradoEtiqueta: true, creadoEn: true,
      servicio: { select: { id: true, nombre: true, color: true } },
      atencion: { select: { id: true, fecha: true, citaId: true, sede: { select: { nombre: true } }, profesional: { select: { nombres: true, apellidos: true } } } },
    },
  });
  const ids = [...new Set(filas.map((f) => f.pacienteId))];
  const [pacientes, citas, riesgos] = ids.length
    ? await Promise.all([
        prisma.paciente.findMany({ where: { id: { in: ids } }, select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } }),
        prisma.cita.findMany({
          where: { pacienteId: { in: ids }, deletedAt: null, fecha: { gte: fechaDb(hoy) }, estado: { in: ['agendada', 'confirmada'] } },
          orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
          select: { id: true, pacienteId: true, fecha: true, horaInicio: true, servicio: { select: { nombre: true } }, sede: { select: { nombre: true } } },
        }),
        categoriaIwgdf(ids),
      ])
    : [[], [], new Map<string, number>()];
  const pacPor = new Map(pacientes.map((x) => [x.id, x]));
  const citaPor = new Map<string, (typeof citas)[number]>();
  for (const c of citas) if (!citaPor.has(c.pacienteId)) citaPor.set(c.pacienteId, c);
  return {
    hoy, horizonteDias: horizonte,
    controles: filas.map((f) => {
      const fecha = fechaAStr(f.fechaSugerida);
      const cita = citaPor.get(f.pacienteId);
      return {
        id: f.id, fechaSugerida: fecha, diasRestantes: diasEntre(hoy, fecha), vencido: fecha < hoy,
        motivo: f.motivo, origen: f.origen, registradoEtiqueta: f.registradoEtiqueta, servicio: f.servicio,
        atencion: { id: f.atencion.id, fecha: fechaAStr(f.atencion.fecha), citaId: f.atencion.citaId, sede: f.atencion.sede.nombre, profesional: f.atencion.profesional },
        paciente: pacPor.get(f.pacienteId) ?? { id: f.pacienteId, nombres: '—', apellidoPaterno: '', apellidoMaterno: '', telefono: null },
        riesgo: riesgos.get(f.pacienteId) ?? null,
        proximaCita: cita ? { id: cita.id, fecha: fechaAStr(cita.fecha), horaInicio: cita.horaInicio, servicio: cita.servicio.nombre, sede: cita.sede.nombre } : null,
      };
    }),
  };
}

/** Para el menú: vencidos y los que vencen en los próximos 7 días. */
export async function contarControles(p: Alcance) {
  const hoy = hoyLimaStr();
  const base = { estado: 'pendiente', ...whereAlcance(p) } satisfies Prisma.ControlSugeridoWhereInput;
  const [vencidos, proximos] = await Promise.all([
    prisma.controlSugerido.count({ where: { ...base, fechaSugerida: { lt: fechaDb(hoy) } } }),
    prisma.controlSugerido.count({ where: { ...base, fechaSugerida: { gte: fechaDb(hoy), lte: fechaDb(sumarDias(hoy, 7)) } } }),
  ]);
  return { vencidos, proximos, total: vencidos + proximos };
}

export async function sedeDeControl(id: string) {
  const c = await prisma.controlSugerido.findUnique({ where: { id }, select: { sedeId: true } });
  if (!c) throw new AppError('Control no encontrado', 404);
  return c.sedeId;
}

/** Agendar (con la cita, si ya existe) o descartar (con motivo). Escritura con guarda de estado. */
export async function resolverControl(p: Ctx & { id: string; accion: 'agendar' | 'descartar'; citaId?: string | null; motivo?: string | null }) {
  const c = await prisma.controlSugerido.findUnique({ where: { id: p.id }, select: { id: true, pacienteId: true, sedeId: true, estado: true } });
  if (!c) throw new AppError('Control no encontrado', 404);
  if (c.estado !== 'pendiente') throw new AppError('Este control ya fue resuelto', 409, 'CONTROL_RESUELTO');
  if (p.accion === 'descartar' && (p.motivo ?? '').trim().length < 3) throw new AppError('Indica por qué se descarta el control', 400, 'FALTA_MOTIVO');
  if (p.accion === 'agendar' && p.citaId) {
    const cita = await prisma.cita.findFirst({ where: { id: p.citaId, deletedAt: null }, select: { pacienteId: true } });
    if (!cita || cita.pacienteId !== c.pacienteId) throw new AppError('La cita no es de este paciente', 400, 'CITA_DE_OTRO_PACIENTE');
  }
  const estado = p.accion === 'agendar' ? 'agendado' : 'descartado';
  await prisma.$transaction(async (tx) => {
    const r = await tx.controlSugerido.updateMany({
      where: { id: c.id, estado: 'pendiente' },
      data: {
        estado, citaId: p.accion === 'agendar' ? p.citaId ?? null : null, motivoDescarte: p.accion === 'descartar' ? p.motivo!.trim() : null,
        resueltoPorUsuarioId: p.usuarioId ?? null, resueltoEn: new Date(),
      },
    });
    if (r.count === 0) throw new AppError('Este control ya fue resuelto', 409, 'CONTROL_RESUELTO');
    await auditEnTx(tx, {
      ...ctxAudit(p), sedeId: c.sedeId, accion: p.accion === 'agendar' ? 'agendar_control' : 'descartar_control', entidad: 'control_sugerido', entidadId: c.id,
      antes: { estado: 'pendiente' }, despues: { estado, citaId: p.citaId ?? null, motivo: p.motivo ?? null },
    });
  });
  return { ok: true, estado };
}
