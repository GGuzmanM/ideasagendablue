/**
 * MODO VITRINA de la reserva web (15-oct-2026): RESERVA_WEB_MODO=vitrina.
 * La página se recorre completa con la disponibilidad REAL (sedes, servicios, días y horas), pero NADA se escribe en
 * la base: no se guarda el intento, no se aparta el horario, no se cobra y no se crea ninguna cita. Lo que la página
 * necesita recordar entre pasos (la «reserva» de demostración) vive solo en memoria, 30 minutos.
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { horasLibres, servicioReservable, type NuevaReservaWeb } from './reservaWebService';
import type { DatosCheckout } from './pasarelas';

export function modoVitrina(): boolean {
  return (process.env.RESERVA_WEB_MODO || '').trim().toLowerCase() === 'vitrina';
}

const MIN = 60_000;
const VIDA = 30 * MIN;
interface ReservaDemo {
  token: string; estado: 'esperando_pago' | 'confirmada'; datos: NuevaReservaWeb; subcategoriaId: string | null;
  duracionMinutos: number; monto: number; expiraEn: Date; pagadoEn: Date | null; vence: number;
}
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
  const expiraEn = new Date(Date.now() + 10 * MIN);
  intentos.set(intentoId, { expiraEn, vence: Date.now() + VIDA });
  return { intentoId, token: crypto.randomBytes(24).toString('hex'), expiraEn };
}

export function avanceDemo(intentoId: string, paso?: string) {
  const i = intentos.get(intentoId);
  return { expiraEn: i?.expiraEn ?? new Date(Date.now() + 10 * MIN), pasoAlcanzado: paso ?? null };
}

export async function crearReservaDemo(d: NuevaReservaWeb & { intentoId?: string | null }) {
  limpiar();
  const { servicio, variante, monto } = await servicioReservable(d.sedeId, d.servicioId, d.subcategoriaId);
  const libres = await horasLibres(d.sedeId, d.servicioId, d.fecha);
  if (!libres.includes(d.horaInicio)) throw new AppError('Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
  const codigo = `DEMO-${crypto.randomInt(100000, 1000000)}`;
  const tokenConsulta = crypto.randomBytes(24).toString('hex');
  const expiraEn = (d.intentoId && intentos.get(d.intentoId)?.expiraEn) || new Date(Date.now() + 10 * MIN);
  reservas.set(codigo, {
    token: tokenConsulta, estado: 'esperando_pago', datos: d, subcategoriaId: variante.id,
    duracionMinutos: servicio.duracionMinutos, monto, expiraEn, pagadoEn: null, vence: Date.now() + VIDA,
  });
  return { codigo, tokenConsulta, estado: 'esperando_pago', monto, moneda: 'PEN', horaInicio: d.horaInicio, expiraEn };
}

function demoConToken(codigo: string, token: string): ReservaDemo {
  const r = reservas.get(codigo);
  const ok = !!r && r.token.length === token.length && crypto.timingSafeEqual(Buffer.from(r.token), Buffer.from(token));
  if (!r || !ok) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  return r;
}

export function pagoDemo(codigo: string, token: string): DatosCheckout {
  const r = demoConToken(codigo, token);
  if (r.estado !== 'esperando_pago') throw new AppError('Esta reserva ya no está esperando pago', 409, 'RESERVA_NO_PAGABLE');
  return { pasarela: 'vitrina', modo: 'simulada', datos: { monto: r.monto, moneda: 'PEN', nota: 'Demostración: no se cobra nada y no se reserva ninguna cita.' } };
}

/** «Pago» de la demostración: solo cambia el estado en memoria. */
export function confirmarDemo(codigo: string, token: string) {
  const r = demoConToken(codigo, token);
  if (r.estado === 'esperando_pago') { r.estado = 'confirmada'; r.pagadoEn = new Date(); }
  return { ok: true, estado: r.estado, demo: true };
}

export async function estadoDemo(codigo: string, token: string) {
  const r = demoConToken(codigo, token);
  const [sede, servicio, variante] = await Promise.all([
    prisma.sede.findUnique({ where: { id: r.datos.sedeId }, select: { nombre: true, direccion: true } }),
    prisma.servicio.findUnique({ where: { id: r.datos.servicioId }, select: { nombre: true } }),
    r.subcategoriaId ? prisma.subcategoriaServicio.findUnique({ where: { id: r.subcategoriaId }, select: { nombre: true } }) : Promise.resolve(null),
  ]);
  return {
    codigo, estado: r.estado === 'esperando_pago' && r.expiraEn <= new Date() ? 'expirada' : r.estado, nombres: r.datos.nombres,
    fecha: r.datos.fecha, horaInicio: r.datos.horaInicio, duracionMinutos: r.duracionMinutos,
    sede, servicio: servicio?.nombre ?? null, variante: variante?.nombre ?? null,
    monto: r.monto, moneda: 'PEN', expiraEn: r.expiraEn, pagadoEn: r.pagadoEn, demo: true,
  };
}
