/**
 * Reglas PURAS del aparato del consultorio (sin BD): textos de la pantalla 16x2, hora real del
 * botón y qué cita le toca a un INICIO. Probadas en __tests__/tiempo-reglas.test.ts.
 */
import { TZ_LIMA } from '../utils/fechaLima';

/** Un FIN antes de este tiempo anula el tratamiento (botón apretado por error). */
export const MIN_DURACION_S = 60;
/** Sin FIN en este tiempo, el tratamiento se cierra solo como «sin fin». */
export const MAX_ABIERTO_MIN = 180;
/** Edad máxima creíble de un evento guardado sin red (el aparato lo reenvía al volver la red). */
export const EDAD_MAX_MS = 24 * 60 * 60_000;

export const ANCHO_LCD = 16;

// sin_cita / sin_llegada: el INICIO no encontró cita y NO se inició nada (solo queda en la bitácora).
export type ResultadoEvento = 'iniciado' | 'sin_cita' | 'sin_llegada' | 'ya_en_curso' | 'finalizado' | 'anulado' | 'sin_inicio';

/** Texto apto para la LCD: mayúsculas, sin tildes, solo ASCII imprimible y 16 caracteres como máximo. */
export function textoLcd(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tildes y diéresis (la ñ queda como n)
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ANCHO_LCD);
}

/** «Rosa María» + «Mendoza» → «ROSA M.» (nombre de pila + inicial del apellido). */
export function nombreCorto(nombres: string | null | undefined, apellidoPaterno: string | null | undefined, max = 9): string {
  const pila = textoLcd(nombres ?? '').split(' ')[0] ?? '';
  const inicial = textoLcd(apellidoPaterno ?? '').charAt(0);
  const nombre = pila.slice(0, Math.max(1, max - (inicial ? 3 : 0)));
  return inicial ? `${nombre} ${inicial}.` : nombre;
}

const dos = (n: number) => String(n).padStart(2, '0');

/** Segundos → «HH:MM:SS» (como imprimirTiempoLCD del boceto del cliente). */
export function formatoDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${dos(Math.floor(s / 3600))}:${dos(Math.floor((s % 3600) / 60))}:${dos(s % 60)}`;
}

/** «HH:MM» en hora de Lima. */
export function horaLima(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ_LIMA, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/** Minutos desde medianoche, hora de Lima. */
export function minutosLima(d: Date): number {
  const [h, m] = horaLima(d).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Hora REAL del botón. Orden de confianza:
 *  1. `edadMs` (ms desde que se presionó hasta que se envió, medidos con el cronómetro interno del
 *     aparato): no depende de su reloj → hora = recepción − edad.
 *  2. `presionadoEn` del reloj del aparato, solo si está sincronizado por NTP y es creíble.
 *  3. La hora del servidor al recibirlo, marcada como aproximada.
 */
export function resolverHoraBoton(args: { recibidoEn: Date; edadMs?: number | null; presionadoEn?: string | null; ntp?: boolean | null }): { hora: Date; aproximada: boolean } {
  const { recibidoEn, edadMs, presionadoEn, ntp } = args;
  if (typeof edadMs === 'number' && Number.isFinite(edadMs) && edadMs >= 0 && edadMs <= EDAD_MAX_MS) {
    return { hora: new Date(recibidoEn.getTime() - Math.round(edadMs)), aproximada: false };
  }
  if (ntp && presionadoEn) {
    const p = Date.parse(presionadoEn);
    if (Number.isFinite(p) && p <= recibidoEn.getTime() + 2 * 60_000 && recibidoEn.getTime() - p <= EDAD_MAX_MS) {
      return { hora: new Date(Math.min(p, recibidoEn.getTime())), aproximada: false };
    }
  }
  return { hora: recibidoEn, aproximada: true };
}

export interface CitaCandidata {
  id: string;
  estado: string;
  horaInicio: string; // "HH:mm" Lima
  slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null;
  /** Ya tiene un tiempo vigente (en curso, finalizado o sin fin). */
  tieneTiempo: boolean;
}

/**
 * Qué cita le toca a un INICIO entre las del consultorio hoy:
 *  - solo «Llegó» o «En atención» y sin un tiempo ya medido;
 *  - primero una que recepción ya puso «En atención» (la podóloga la está atendiendo);
 *  - luego la de hora más cercana a ahora;
 *  - en un bloque combinado (misma hora), el 1º tratamiento (PRINCIPAL) antes que el 2º.
 */
export function elegirCita<T extends CitaCandidata>(candidatas: T[], ahoraMin: number): T | null {
  const hhmm = (h: string) => { const [a, b] = h.split(':').map(Number); return (a ?? 0) * 60 + (b ?? 0); };
  const validas = candidatas.filter((c) => (c.estado === 'llego' || c.estado === 'en_atencion') && !c.tieneTiempo);
  validas.sort((a, b) =>
    (a.estado === 'en_atencion' ? 0 : 1) - (b.estado === 'en_atencion' ? 0 : 1)
    || Math.abs(hhmm(a.horaInicio) - ahoraMin) - Math.abs(hhmm(b.horaInicio) - ahoraMin)
    || (a.slotRol === 'SECUNDARIO' ? 1 : 0) - (b.slotRol === 'SECUNDARIO' ? 1 : 0));
  return validas[0] ?? null;
}

/** Nº de tratamiento dentro de un bloque combinado (1 = principal, 2 = el extra); null si es una cita suelta. */
export function numeroTratamiento(c: { slotGrupoId: string | null; slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null }): 1 | 2 | null {
  if (!c.slotGrupoId) return null;
  return c.slotRol === 'SECUNDARIO' ? 2 : 1;
}

// ─── Reporte ──────────────────────────────────────────────────────────────────
export interface ResumenDuraciones { n: number; promedio: number; mediana: number; p90: number; min: number; max: number }

/** Resumen de duraciones (en minutos, 1 decimal). Percentiles por el método del rango más cercano. */
export function resumirDuraciones(minutos: number[]): ResumenDuraciones | null {
  if (!minutos.length) return null;
  const v = [...minutos].sort((a, b) => a - b);
  const pct = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]!;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    n: v.length,
    promedio: r1(v.reduce((s, x) => s + x, 0) / v.length),
    mediana: r1(v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2),
    p90: r1(pct(0.9)),
    min: r1(v[0]!),
    max: r1(v[v.length - 1]!),
  };
}

// ─── Pantallas (2 líneas de 16) ───────────────────────────────────────────────
type Lcd = [string, string];
const lcd = (a: string, b: string): Lcd => [textoLcd(a), textoLcd(b)];

export const PANTALLA = {
  /** Reposo (igual que mostrarDisponible del boceto del cliente). */
  disponible: (consultorio: number): Lcd => lcd(`CONSULTORIO ${dos(consultorio)}`, 'DISPONIBLE'),
  iniciado: (nombre: string, hora: string, tratamiento: 1 | 2 | null): Lcd =>
    lcd(tratamiento ? `TRAT.${tratamiento} INICIADO` : 'INICIADO', `${nombre} ${hora}`),
  /** Reposo con la cita LISTA en el consultorio (la que tomará INICIO: misma regla, `elegirCita`). */
  siguiente: (nombre: string, tratamiento: 1 | 2 | null): Lcd =>
    lcd(`SIGUE: ${nombre}`, tratamiento ? `TRAT.${tratamiento} > INICIO` : 'PULSE INICIO'),
  /** Reposo: hay cita con ese consultorio, pero recepción aún no marcó «Llegó». */
  porLlegar: (nombre: string): Lcd => lcd(`SIGUE: ${nombre}`, 'FALTA "LLEGO"'),
  /** INICIO sin cita en el consultorio: no se inicia nada. */
  sinCita: (): Lcd => lcd('SIN CITA ASIGN.', 'NO SE INICIO'),
  /** Hay cita con ese consultorio, pero recepción aún no marcó «Llegó»: no se inicia nada. */
  sinLlegada: (): Lcd => lcd('CITA SIN LLEGADA', 'MARCAR "LLEGO"'),
  yaEnCurso: (desde: string): Lcd => lcd('YA EN CURSO', `DESDE ${desde}`),
  enCurso: (nombre: string | null): Lcd => lcd('EN CURSO', nombre ?? ''),
  finalizado: (segundos: number): Lcd => lcd(`FIN ${formatoDuracion(segundos)}`, 'GUARDADO'),
  /** Terminó el 1º tratamiento de un bloque y falta el otro. */
  finalizadoBloque: (tratamiento: 1 | 2, segundos: number, siguiente: 1 | 2): Lcd =>
    lcd(`TRAT.${tratamiento} ${formatoDuracion(segundos)}`, `INICIO=TRAT.${siguiente}`),
  anulado: (): Lcd => lcd('ANULADO', 'MUY CORTO <1MIN'),
  sinInicio: (): Lcd => lcd('SIN INICIO', 'PULSE INICIO'),
};
