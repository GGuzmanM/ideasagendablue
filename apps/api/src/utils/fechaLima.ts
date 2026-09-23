/**
 * Punto ÚNICO para el manejo de fechas/horas de Limablue.
 * Zona de la clínica: America/Lima = UTC-5 (sin horario de verano).
 *
 * Convención de datos:
 *  - `Cita.fecha` es @db.Date (solo día). Se parsea/serializa a MEDIODÍA UTC para
 *    que NUNCA se desplace de día por la zona horaria del servidor.
 *  - `Cita.horaInicio` es "HH:mm" en hora local de Lima.
 */
import { AppError } from '../middleware/errorHandler';

export const LIMA_OFFSET_H = 5;
export const TZ_LIMA = 'America/Lima';

/** Parsea "YYYY-MM-DD" a un Date seguro para columnas @db.Date (mediodía UTC). */
export function fechaDb(fechaStr: string): Date {
  const d = new Date(`${fechaStr}T12:00:00.000Z`);
  // «ayer», «2026-13-01» o «2026-02-30» (JS lo corre al 2-mar) → 400 claro en vez de un 500 de Prisma
  // o, peor, una cita guardada en un día distinto al que se escribió.
  if (typeof fechaStr !== 'string' || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== fechaStr) {
    throw new AppError('La fecha no es válida (se espera AAAA-MM-DD de un día que exista)', 400, 'FECHA_INVALIDA');
  }
  return d;
}

/** Devuelve "YYYY-MM-DD" de un Date (usa getters UTC para no desfasar el día). */
export function fechaAStr(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" del día de HOY en hora de Lima (independiente de la TZ del proceso). */
export function hoyLimaStr(ref: Date = new Date()): string {
  // en-CA da el formato ISO (YYYY-MM-DD) directo.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_LIMA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ref);
}

/**
 * ¿La fecha "YYYY-MM-DD" es ANTERIOR a hoy (en hora Lima)? → cita retroactiva.
 * Compara strings ISO (comparación lexicográfica = cronológica para YYYY-MM-DD).
 */
export function esFechaPasadaLima(fechaStr: string, ref: Date = new Date()): boolean {
  return fechaStr < hoyLimaStr(ref);
}

/** Nº de días que `fechaStr` está en el pasado respecto a hoy (Lima). 0 si es hoy o futura. */
export function diasEnPasadoLima(fechaStr: string, ref: Date = new Date()): number {
  const hoy = hoyLimaStr(ref);
  if (fechaStr >= hoy) return 0;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fechaStr}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Datetime UTC del inicio de una cita a partir de su `fecha` (@db.Date) y
 * `horaInicio` ("HH:mm" hora Lima). Ej.: 2026-06-20 + "10:00" → 2026-06-20T15:00:00Z.
 */
export function citaInicioUtc(fecha: Date, horaInicio: string): Date {
  const [hh, mm] = horaInicio.split(':').map((n) => parseInt(n, 10));
  return new Date(Date.UTC(
    fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(),
    (hh || 0) + LIMA_OFFSET_H, mm || 0, 0,
  ));
}
