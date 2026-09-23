/**
 * Validaciones de ENTRADA de una cita que antes solo hacía la pantalla (20-sep-2026, 2ª auditoría de
 * la agenda). El API las repite porque también lo llaman el buscador, integraciones con API key y
 * cualquiera con un token: una hora «10:07», una fecha «2026-13-01» o una cita para 2031 no deben
 * llegar a la base.
 */
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { hoyLimaStr } from './fechaLima';

/** La agenda trabaja en bloques de 30 minutos: toda cita empieza en :00 o :30. */
export const REJILLA_MINUTOS = 30;
/** Hasta cuántos meses hacia adelante se puede agendar o reprogramar. */
export const MESES_MAX_ADELANTE = 12;

/** «YYYY-MM-DD» que existe en el calendario (rechaza 2026-13-01 y 2026-02-30). */
export function esFechaReal(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** «HH:mm» de 00:00 a 23:30 y en la rejilla de 30 minutos. */
export function horaEnRejilla(h: string): boolean {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(h);
  return !!m && Number(m[2]) % REJILLA_MINUTOS === 0;
}

/** Último día agendable: hoy (Lima) + MESES_MAX_ADELANTE. */
export function fechaMaximaAgendable(ref: Date = new Date()): string {
  const [y, m, d] = hoyLimaStr(ref).split('-').map(Number) as [number, number, number];
  const tope = new Date(Date.UTC(y, m - 1 + MESES_MAX_ADELANTE, d, 12));
  // 31-ago + 6 meses no existe (31-feb): Date lo pasa a marzo; se recorta al último día del mes pedido.
  if (tope.getUTCDate() !== d) tope.setUTCDate(0);
  return tope.toISOString().slice(0, 10);
}

/** Lanza 400 si la fecha está más allá de lo agendable. */
export function assertFechaNoMuyLejana(fechaStr: string, ref: Date = new Date()): void {
  const tope = fechaMaximaAgendable(ref);
  if (fechaStr > tope) {
    throw new AppError(`Solo se puede agendar hasta ${MESES_MAX_ADELANTE} meses hacia adelante (máximo ${tope}). Revisa el año de la fecha.`, 400, 'FECHA_MUY_LEJANA');
  }
}

export const zFechaCita = z.string().refine(esFechaReal, { message: 'La fecha no existe en el calendario (formato AAAA-MM-DD)' });
export const zHoraCita = z.string().refine(horaEnRejilla, { message: 'La hora debe ser HH:mm en bloques de 30 minutos (09:00, 09:30, …)' });
/** Texto libre de la cita (comentario inicial): mismo tope que el hilo de comentarios. */
export const zComentarioCita = z.string().max(2000, 'El comentario no puede pasar de 2000 caracteres');
