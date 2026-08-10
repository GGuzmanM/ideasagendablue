/**
 * Promociones — Fase 1 (motor). Elegibilidad automática + cálculo del monto.
 *
 * Una promoción DESCUENTA de tres formas (tipo): PORCENTAJE (% off), MONTO_DESCUENTO
 * (S/ X menos) o PRECIO_FIJO (precio FINAL del servicio/combo). MEMBRESIA/OTRO no descuentan.
 *
 * Restricciones (todas "null = sin restricción"): serviciosIds, sedesIds, canales,
 * vigenciaInicio/Fin (según la FECHA DE LA CITA), diasSemana (0=Dom..6=Sáb), codigo
 * (convenio/cupón), soloPacientesNuevos, cupoTotal, limitePorPaciente.
 *
 * Regla de negocio: una promo NUNCA se combina con una membresía (se valida en la ruta de
 * creación). La aplicación es "automática sugerida": el server filtra las que CALIFICAN y
 * revalida en la creación (estricto, sin override).
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import type { EstadoCita, TipoPromocion } from '@prisma/client';

// Estados de cita que NO cuentan para cupos/límites (la cita ya no consume la promo).
const ESTADOS_INACTIVOS = ['cancelada', 'no_show', 'reprogramada'] as unknown as EstadoCita[];
// Tipos que efectivamente descuentan (los ofrecidos por el motor automático).
export const TIPOS_DESCUENTO = ['PORCENTAJE', 'PRECIO_FIJO', 'MONTO_DESCUENTO'] as const;
const TIPOS_DESCUENTO_ENUM = TIPOS_DESCUENTO as unknown as TipoPromocion[];

export interface ContextoPromo {
  servicioId: string;
  sedeId: string;
  fecha: string; // "YYYY-MM-DD" (fecha de la cita)
  canal?: string | null;
  pacienteId?: string | null;
}

type PromoRow = {
  id: string; nombre: string; tipo: string; valor: unknown;
  serviciosIds: unknown; sedesIds: unknown; canales: unknown;
  vigenciaInicio: Date | null; vigenciaFin: Date | null; diasSemana: unknown;
  codigo: string | null; soloPacientesNuevos: boolean; cupoTotal: number | null; limitePorPaciente: number | null;
};

const asStrList = (v: unknown): string[] | null => (Array.isArray(v) && v.length ? (v as string[]) : null);
const asNumList = (v: unknown): number[] | null => (Array.isArray(v) && v.length ? (v as number[]) : null);
const ymd = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Día de la semana (0=Dom..6=Sáb) de una fecha civil "YYYY-MM-DD" (TZ-safe). */
export function diaSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** ¿La promo pasa las restricciones ESTÁTICAS (sin consultar uso)? No valida el código. */
function pasaRestriccionesEstaticas(p: PromoRow, ctx: ContextoPromo): boolean {
  const ini = ymd(p.vigenciaInicio);
  const fin = ymd(p.vigenciaFin);
  if (ini && ctx.fecha < ini) return false;
  if (fin && ctx.fecha > fin) return false;

  const dias = asNumList(p.diasSemana);
  if (dias && !dias.includes(diaSemana(ctx.fecha))) return false;

  const servs = asStrList(p.serviciosIds);
  if (servs && !servs.includes(ctx.servicioId)) return false;

  const sedes = asStrList(p.sedesIds);
  if (sedes && !sedes.includes(ctx.sedeId)) return false;

  const canales = asStrList(p.canales);
  if (canales && (!ctx.canal || !canales.includes(ctx.canal))) return false;

  return true;
}

/** ¿La promo tiene cupo/límite disponible para este contexto? Consulta el uso. */
async function tieneCupo(p: PromoRow, ctx: ContextoPromo): Promise<boolean> {
  if (p.cupoTotal != null) {
    const total = await prisma.cita.count({
      where: { promocionId: p.id, deletedAt: null, estado: { notIn: ESTADOS_INACTIVOS } },
    });
    if (total >= p.cupoTotal) return false;
  }
  if (p.limitePorPaciente != null && ctx.pacienteId) {
    const n = await prisma.cita.count({
      where: { promocionId: p.id, pacienteId: ctx.pacienteId, deletedAt: null, estado: { notIn: ESTADOS_INACTIVOS } },
    });
    if (n >= p.limitePorPaciente) return false;
  }
  if (p.soloPacientesNuevos && ctx.pacienteId) {
    const previas = await prisma.cita.count({ where: { pacienteId: ctx.pacienteId, deletedAt: null } });
    if (previas > 0) return false;
  }
  return true;
}

/**
 * Reporte de USO de promociones (Fase 3). Agrega las citas VIVAS (no canceladas/no-show/
 * reprogramadas) con promo en el rango [desde, hasta] (por fecha de la cita), opcionalmente
 * de una sede. Devuelve por promo: usos, monto descontado, monto facturado (final) y precio
 * de lista; más los totales. Incluye promos aunque estén inactivas (para ver histórico).
 */
export async function reporteUsoPromociones(params: { desde: string; hasta: string; sedeId?: string | null }) {
  const desde = new Date(`${params.desde}T00:00:00.000Z`);
  const hasta = new Date(`${params.hasta}T00:00:00.000Z`);
  const rows = await prisma.cita.groupBy({
    by: ['promocionId'],
    where: {
      promocionId: { not: null },
      deletedAt: null,
      estado: { notIn: ESTADOS_INACTIVOS },
      fecha: { gte: desde, lte: hasta },
      ...(params.sedeId ? { sedeId: params.sedeId } : {}),
    },
    _count: { _all: true },
    _sum: { montoDescuento: true, montoFinal: true, precioLista: true },
  });
  const ids = rows.map((r) => r.promocionId!).filter(Boolean);
  const promos = await prisma.promocion.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, tipo: true, valor: true, activo: true },
  });
  const pmap = new Map(promos.map((p) => [p.id, p]));
  const num = (d: unknown) => (d == null ? 0 : Number(d));

  const porPromo = rows.map((r) => {
    const p = pmap.get(r.promocionId!);
    return {
      promocionId: r.promocionId,
      nombre: p?.nombre ?? '(eliminada)',
      tipo: p?.tipo ?? null,
      valor: p?.valor != null ? Number(p.valor) : null,
      activo: p?.activo ?? false,
      usos: r._count._all,
      descontado: num(r._sum.montoDescuento),
      facturado: num(r._sum.montoFinal),
      precioLista: num(r._sum.precioLista),
    };
  }).sort((a, b) => b.descontado - a.descontado);

  const totales = porPromo.reduce(
    (acc, r) => ({ usos: acc.usos + r.usos, descontado: acc.descontado + r.descontado, facturado: acc.facturado + r.facturado, precioLista: acc.precioLista + r.precioLista }),
    { usos: 0, descontado: 0, facturado: 0, precioLista: 0 },
  );
  return { porPromo, totales, desde: params.desde, hasta: params.hasta };
}

/** Precio de LISTA de un servicio: usa el de la subcategoría si la tiene fijada, si no el del
 *  servicio. Devuelve 0 si no hay precio de referencia configurado (no rompe el cálculo). */
export async function precioListaDe(servicioId: string, subcategoriaId?: string | null): Promise<number> {
  if (subcategoriaId) {
    const sc = await prisma.subcategoriaServicio.findUnique({ where: { id: subcategoriaId }, select: { precioReferencial: true } });
    if (sc?.precioReferencial != null) return Number(sc.precioReferencial);
  }
  const s = await prisma.servicio.findUnique({ where: { id: servicioId }, select: { precioReferencial: true } });
  return s?.precioReferencial != null ? Number(s.precioReferencial) : 0;
}

/** Calcula descuento y monto final según el tipo de beneficio. Nunca negativo; redondeo a céntimos. */
export function calcularMontoFinal(precioLista: number, tipo: string, valor: number | null): { descuento: number; final: number } {
  const base = Math.max(0, Number(precioLista) || 0);
  const v = Number(valor ?? 0);
  let fin = base;
  if (tipo === 'PORCENTAJE') fin = base * (1 - v / 100);
  else if (tipo === 'MONTO_DESCUENTO') fin = base - v;
  else if (tipo === 'PRECIO_FIJO') fin = v; // precio FINAL fijo
  fin = Math.max(0, Math.round(fin * 100) / 100);
  const descuento = Math.max(0, Math.round((base - fin) * 100) / 100);
  return { descuento, final: fin };
}

/**
 * Promociones que CALIFICAN para el contexto (para el desplegable "automático sugerido").
 * Excluye membresías y OTRO (no descuentan). Incluye las que requieren código: llevan
 * `requiereCodigo=true` para que el front pida el cupón antes de aplicarlas.
 */
export async function promocionesElegibles(ctx: ContextoPromo) {
  const promos = (await prisma.promocion.findMany({
    where: { activo: true, deletedAt: null, tipo: { in: TIPOS_DESCUENTO_ENUM } },
    orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    select: {
      id: true, nombre: true, descripcion: true, tipo: true, valor: true,
      serviciosIds: true, sedesIds: true, canales: true, vigenciaInicio: true, vigenciaFin: true,
      diasSemana: true, codigo: true, soloPacientesNuevos: true, cupoTotal: true, limitePorPaciente: true,
    },
  })) as unknown as (PromoRow & { descripcion: string | null })[];

  const out: any[] = [];
  for (const p of promos) {
    if (!pasaRestriccionesEstaticas(p, ctx)) continue;
    if (!(await tieneCupo(p, ctx))) continue;
    out.push({
      id: p.id, nombre: p.nombre, descripcion: p.descripcion, tipo: p.tipo,
      valor: p.valor != null ? Number(p.valor) : null,
      requiereCodigo: !!p.codigo,
    });
  }
  return out;
}

/**
 * Revalida (estricto) que una promo aplica al contexto y devuelve el cálculo. La usa la
 * creación de cita. Lanza AppError si la promo no existe, no califica o el código no coincide.
 * `precioLista` es el precio de referencia total (servicio + extra en combo).
 */
export async function validarYCalcularPromo(
  promocionId: string,
  ctx: ContextoPromo,
  precioLista: number,
  codigo?: string | null,
): Promise<{ descuento: number; final: number; tipo: string }> {
  const p = (await prisma.promocion.findFirst({
    where: { id: promocionId, deletedAt: null },
    select: {
      id: true, nombre: true, tipo: true, valor: true, activo: true,
      serviciosIds: true, sedesIds: true, canales: true, vigenciaInicio: true, vigenciaFin: true,
      diasSemana: true, codigo: true, soloPacientesNuevos: true, cupoTotal: true, limitePorPaciente: true,
    },
  })) as unknown as (PromoRow & { activo: boolean }) | null;
  if (!p || !p.activo) throw new AppError('La promoción no existe o está inactiva', 400, 'PROMO_INVALIDA');

  // Promos que no descuentan (OTRO/MEMBRESIA): no computan monto, pero tampoco bloquean.
  if (!(TIPOS_DESCUENTO as unknown as string[]).includes(p.tipo)) {
    return { descuento: 0, final: Math.max(0, Number(precioLista) || 0), tipo: p.tipo };
  }

  if (!pasaRestriccionesEstaticas(p, ctx)) {
    throw new AppError(`La promoción "${p.nombre}" no aplica para este servicio/sede/fecha/canal`, 409, 'PROMO_NO_APLICA');
  }
  if (!(await tieneCupo(p, ctx))) {
    throw new AppError(`La promoción "${p.nombre}" ya no tiene cupo disponible`, 409, 'PROMO_SIN_CUPO');
  }
  if (p.codigo && (codigo ?? '').trim().toUpperCase() !== p.codigo.trim().toUpperCase()) {
    throw new AppError(`La promoción "${p.nombre}" requiere un código válido`, 409, 'PROMO_CODIGO_INVALIDO');
  }

  const { descuento, final } = calcularMontoFinal(precioLista, p.tipo, p.valor != null ? Number(p.valor) : null);
  return { descuento, final, tipo: p.tipo };
}
