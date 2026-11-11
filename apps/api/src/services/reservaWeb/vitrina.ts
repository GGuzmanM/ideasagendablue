/**
 * MODO VITRINA de la reserva web (15-oct-2026): RESERVA_WEB_MODO=vitrina.
 * La página se recorre completa con la disponibilidad REAL (sedes, servicios, días y horas), pero NADA se escribe en
 * la base: no se guarda el intento, no se registra al paciente y no se crea ninguna cita. Lo que la página necesita
 * recordar (la «reserva» de demostración) vive solo en memoria, 30 minutos.
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { horasLibres, servicioReservable, type NuevaReservaWeb, type ReservaCreada } from './reservaWebService';

export function modoVitrina(): boolean {
  return (process.env.RESERVA_WEB_MODO || '').trim().toLowerCase() === 'vitrina';
}

const MIN = 60_000;
const VIDA = 30 * MIN;
interface ReservaDemo { token: string; datos: NuevaReservaWeb; subcategoriaId: string | null; duracionMinutos: number; monto: number; vence: number }
const reservas = new Map<string, ReservaDemo>();
const intentos = new Map<string, { expiraEn: Date; vence: number }>();
function limpiar() {
  const t = Date.now();
  for (const [k, v] of reservas) if (v.vence < t) reservas.delete(k);
  for (const [k, v] of intentos) if (v.vence < t) intentos.delete(k);
}

export function intentoDemo() {
  limpiar();
  const intentoId = crypto.randomUUID();
  const expiraEn = new Date(Date.now() + 60 * MIN);
  intentos.set(intentoId, { expiraEn, vence: Date.now() + VIDA });
  return { intentoId, token: crypto.randomBytes(24).toString('hex'), expiraEn };
}

export function avanceDemo(intentoId: string, paso?: string) {
  const i = intentos.get(intentoId);
  return { expiraEn: i?.expiraEn ?? new Date(Date.now() + 60 * MIN), pasoAlcanzado: paso ?? null };
}

/** «Confirma» la demostración: valida servicio y hora con la disponibilidad real, pero no registra nada. */
export async function reservaDemo(d: NuevaReservaWeb): Promise<ReservaCreada & { demo: true }> {
  limpiar();
  const { servicio, variante, monto } = await servicioReservable(d.sedeId, d.servicioId, d.subcategoriaId);
  const libres = await horasLibres(d.sedeId, d.servicioId, d.fecha);
  if (!libres.includes(d.horaInicio)) throw new AppError('Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
  const codigo = `DEMO-${crypto.randomInt(100000, 1000000)}`;
  const token = crypto.randomBytes(24).toString('hex');
  reservas.set(codigo, { token, datos: d, subcategoriaId: variante.id, duracionMinutos: servicio.duracionMinutos, monto, vence: Date.now() + VIDA });
  const sede = await prisma.sede.findUnique({ where: { id: d.sedeId }, select: { nombre: true, direccion: true } });
  return {
    codigo, token, estado: 'confirmada', citaId: '', numeroCita: null, repetida: false, fecha: d.fecha, horaInicio: d.horaInicio, duracionMinutos: servicio.duracionMinutos,
    monto, moneda: 'PEN', sede, servicio: servicio.nombre, variante: variante.id ? variante.nombre : null, demo: true,
  };
}

export async function estadoDemo(codigo: string, token: string) {
  const r = reservas.get(codigo);
  const ok = !!r && r.token.length === token.length && crypto.timingSafeEqual(Buffer.from(r.token), Buffer.from(token));
  if (!r || !ok) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  const [sede, servicio, variante] = await Promise.all([
    prisma.sede.findUnique({ where: { id: r.datos.sedeId }, select: { nombre: true, direccion: true } }),
    prisma.servicio.findUnique({ where: { id: r.datos.servicioId }, select: { nombre: true } }),
    r.subcategoriaId ? prisma.subcategoriaServicio.findUnique({ where: { id: r.subcategoriaId }, select: { nombre: true } }) : Promise.resolve(null),
  ]);
  return {
    codigo, estado: 'confirmada', nombres: r.datos.nombres, fecha: r.datos.fecha, horaInicio: r.datos.horaInicio, duracionMinutos: r.duracionMinutos,
    sede, servicio: servicio?.nombre ?? null, variante: variante?.nombre ?? null, monto: r.monto, moneda: 'PEN', demo: true,
  };
}
