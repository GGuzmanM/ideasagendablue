/**
 * Intentos de RESERVA WEB (06-oct-2026).
 *
 * El intento nace en el PRIMER «Continuar» de la página (datos del paciente) y se actualiza en cada paso (sede,
 * servicio, fecha, hora). Desde ese momento corren los minutos del apartado (RESERVA_WEB_MINUTOS_APARTADO, 10): el
 * apartado del horario (reservas_web) hereda el MISMO vencimiento. Así recepción / contact center ve quién empezó,
 * hasta dónde llegó y lo puede llamar (con «contactado» + nota).
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { fechaDb, fechaAStr } from '../../utils/fechaLima';
import { registrarAudit } from '../audit';

const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const MINUTOS = () => num(process.env.RESERVA_WEB_MINUTOS_APARTADO, 10);

export const PASOS_INTENTO = ['datos', 'sede', 'servicio', 'fecha', 'hora', 'pago'] as const;
export type PasoIntento = (typeof PASOS_INTENTO)[number];

export interface DatosPaciente {
  numeroDocumento: string; nombres: string; apellidoPaterno: string; apellidoMaterno?: string | null; telefono: string; email: string;
}
export interface CambiosIntento extends Partial<DatosPaciente> {
  paso?: PasoIntento;
  sedeId?: string | null; servicioId?: string | null; subcategoriaId?: string | null; fecha?: string | null; horaInicio?: string | null;
}

function limpiarDatos(d: Partial<DatosPaciente>) {
  return {
    ...(d.numeroDocumento !== undefined ? { numeroDocumento: d.numeroDocumento } : {}),
    ...(d.nombres !== undefined ? { nombres: d.nombres.trim() } : {}),
    ...(d.apellidoPaterno !== undefined ? { apellidoPaterno: d.apellidoPaterno.trim() } : {}),
    ...(d.apellidoMaterno !== undefined ? { apellidoMaterno: d.apellidoMaterno?.trim() || null } : {}),
    ...(d.telefono !== undefined ? { telefono: d.telefono } : {}),
    ...(d.email !== undefined ? { email: d.email.trim().toLowerCase() } : {}),
  };
}

/** Primer «Continuar»: crea el intento y arranca el reloj. */
export async function crearIntento(d: DatosPaciente, meta: { ip?: string; userAgent?: string }) {
  if (meta.ip) {
    const recientes = await prisma.reservaWebIntento.count({ where: { ip: meta.ip, creadoEn: { gt: new Date(Date.now() - 60 * 60_000) } } });
    if (recientes >= 30) throw new AppError('Demasiados intentos desde esta conexión. Espera un momento.', 429, 'DEMASIADOS_INTENTOS');
  }
  const i = await prisma.reservaWebIntento.create({
    data: {
      numeroDocumento: d.numeroDocumento, nombres: d.nombres.trim(), apellidoPaterno: d.apellidoPaterno.trim(),
      apellidoMaterno: d.apellidoMaterno?.trim() || null, telefono: d.telefono, email: d.email.trim().toLowerCase(),
      pasoAlcanzado: 'sede', // ya completó sus datos: está eligiendo la sede
      token: crypto.randomBytes(24).toString('hex'),
      expiraEn: new Date(Date.now() + MINUTOS() * 60_000),
      ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { intentoId: i.id, token: i.token, expiraEn: i.expiraEn };
}

/** Intento con su secreto. `exigirVigente`: el reloj no debe haber vencido. */
export async function intentoConToken(id: string, token: string, exigirVigente = true) {
  const i = await prisma.reservaWebIntento.findUnique({ where: { id } });
  const ok = !!i && i.token.length === token.length && crypto.timingSafeEqual(Buffer.from(i.token), Buffer.from(token));
  if (!i || !ok) throw new AppError('Tu sesión de reserva no es válida. Vuelve a empezar.', 404, 'INTENTO_NO_ENCONTRADO');
  if (exigirVigente && i.expiraEn <= new Date()) throw new AppError('Se terminó el tiempo para reservar. Vuelve a empezar: tus datos se mantienen.', 410, 'TIEMPO_VENCIDO');
  return i;
}

/** Cada «Continuar»: guarda lo elegido y el paso más avanzado al que llegó. */
export async function actualizarIntento(id: string, token: string, c: CambiosIntento) {
  const i = await intentoConToken(id, token);
  // El paso guardado es el MÁS AVANZADO al que llegó (si vuelve atrás no retrocede); lo elegido sí se actualiza.
  const nuevoPaso = c.paso && PASOS_INTENTO.indexOf(c.paso) > PASOS_INTENTO.indexOf(i.pasoAlcanzado as PasoIntento) ? c.paso : undefined;
  const u = await prisma.reservaWebIntento.update({
    where: { id },
    data: {
      ...limpiarDatos(c),
      ...(nuevoPaso ? { pasoAlcanzado: nuevoPaso } : {}),
      ...(c.sedeId !== undefined ? { sedeId: c.sedeId } : {}),
      ...(c.servicioId !== undefined ? { servicioId: c.servicioId } : {}),
      ...(c.subcategoriaId !== undefined ? { subcategoriaId: c.subcategoriaId } : {}),
      ...(c.fecha !== undefined ? { fecha: c.fecha ? fechaDb(c.fecha) : null } : {}),
      ...(c.horaInicio !== undefined ? { horaInicio: c.horaInicio } : {}),
    },
  });
  return { expiraEn: u.expiraEn, pasoAlcanzado: u.pasoAlcanzado };
}

/** Al apartar el horario: enlaza la reserva y marca el paso «pago». */
export async function enlazarReserva(intentoId: string, reservaId: string, d: { sedeId: string; servicioId: string; subcategoriaId: string | null; fecha: string; horaInicio: string }) {
  await prisma.reservaWebIntento.update({
    where: { id: intentoId },
    data: { reservaId, pasoAlcanzado: 'pago', sedeId: d.sedeId, servicioId: d.servicioId, subcategoriaId: d.subcategoriaId, fecha: fechaDb(d.fecha), horaInicio: d.horaInicio },
  });
}

// ─── Uso interno (Agenda) ─────────────────────────────────────────────────────
export type ResultadoIntento = 'en_curso' | 'abandono' | 'pagando' | 'vencio_pagando' | 'pago_rechazado' | 'reservo' | 'pago_sin_cupo' | 'retomo';

export async function listarIntentos(f: { desde: string; hasta: string; soloPendientes: boolean }) {
  const ini = new Date(f.desde + 'T05:00:00Z'); // 00:00 Lima
  const fin = new Date(new Date(f.hasta + 'T05:00:00Z').getTime() + 86_400_000);
  const filas = await prisma.reservaWebIntento.findMany({ where: { creadoEn: { gte: ini, lt: fin } }, orderBy: { creadoEn: 'desc' }, take: 1000 });
  const ids = <T,>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => !!x))];
  const [sedes, servicios, variantes, reservas, pacientes, usuarios] = await Promise.all([
    prisma.sede.findMany({ where: { id: { in: ids(filas.map((x) => x.sedeId)) } }, select: { id: true, nombre: true } }),
    prisma.servicio.findMany({ where: { id: { in: ids(filas.map((x) => x.servicioId)) } }, select: { id: true, nombre: true } }),
    prisma.subcategoriaServicio.findMany({ where: { id: { in: ids(filas.map((x) => x.subcategoriaId)) } }, select: { id: true, nombre: true } }),
    prisma.reservaWeb.findMany({ where: { id: { in: ids(filas.map((x) => x.reservaId)) } }, select: { id: true, codigo: true, estado: true, pagoEstado: true, monto: true, citaId: true, expiraEn: true } }),
    prisma.paciente.findMany({ where: { tipoDocumento: 'DNI', numeroDocumento: { in: ids(filas.map((x) => x.numeroDocumento)) }, deletedAt: null }, select: { id: true, numeroDocumento: true } }),
    prisma.usuario.findMany({ where: { id: { in: ids(filas.map((x) => x.contactadoPorId)) } }, select: { id: true, nombre: true } }),
  ]);
  const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
  const mSede = m(sedes), mServ = m(servicios), mVar = m(variantes), mRes = m(reservas), mUsu = m(usuarios);
  const mPac = new Map(pacientes.map((p) => [p.numeroDocumento, p.id]));
  const ahora = new Date();

  const out = filas.map((x) => {
    const r = x.reservaId ? mRes.get(x.reservaId) : undefined;
    let resultado: ResultadoIntento;
    if (r) {
      resultado = r.estado === 'confirmada' || r.estado === 'pagada' ? 'reservo'
        : r.estado === 'reembolsar' ? 'pago_sin_cupo'
        : r.estado === 'esperando_pago' && r.expiraEn > ahora ? (r.pagoEstado === 'rechazado' ? 'pago_rechazado' : 'pagando')
        : r.pagoEstado === 'rechazado' ? 'pago_rechazado' : 'vencio_pagando';
    } else {
      resultado = x.expiraEn > ahora ? 'en_curso' : 'abandono';
    }
    return {
      id: x.id, creadoEn: x.creadoEn, actualizadoEn: x.actualizadoEn, expiraEn: x.expiraEn,
      paciente: `${x.nombres} ${x.apellidoPaterno} ${x.apellidoMaterno ?? ''}`.replace(/\s+/g, ' ').trim(),
      numeroDocumento: x.numeroDocumento, telefono: x.telefono, email: x.email,
      pacienteId: mPac.get(x.numeroDocumento) ?? null,
      pasoAlcanzado: x.pasoAlcanzado,
      sede: x.sedeId ? mSede.get(x.sedeId)?.nombre ?? null : null,
      servicio: x.servicioId ? mServ.get(x.servicioId)?.nombre ?? null : null,
      variante: x.subcategoriaId ? mVar.get(x.subcategoriaId)?.nombre ?? null : null,
      fecha: x.fecha ? fechaAStr(x.fecha) : null, horaInicio: x.horaInicio,
      reserva: r ? { codigo: r.codigo, estado: r.estado, monto: Number(r.monto), citaId: r.citaId } : null,
      resultado: resultado as ResultadoIntento,
      contactadoEn: x.contactadoEn, contactadoPor: x.contactadoPorId ? mUsu.get(x.contactadoPorId)?.nombre ?? null : null, notaContacto: x.notaContacto,
    };
  });
  // Si después volvió (mismo DNI) y sí reservó, sus intentos anteriores sin terminar no hay que llamarlos.
  const reservoDespues = new Map<string, Date>();
  for (const x of out) {
    if (x.resultado !== 'reservo') continue;
    const prev = reservoDespues.get(x.numeroDocumento);
    if (!prev || x.creadoEn > prev) reservoDespues.set(x.numeroDocumento, x.creadoEn);
  }
  for (const x of out) {
    const r = reservoDespues.get(x.numeroDocumento);
    if (r && x.creadoEn < r && x.resultado !== 'reservo' && x.resultado !== 'pago_sin_cupo') x.resultado = 'retomo';
  }
  // «Pendientes» = no terminó de reservar (ni volvió a hacerlo) y nadie lo contactó aún.
  const noLlamar: ResultadoIntento[] = ['reservo', 'retomo', 'en_curso', 'pagando'];
  return f.soloPendientes ? out.filter((x) => !noLlamar.includes(x.resultado) && !x.contactadoEn) : out;
}

export async function marcarContactado(id: string, usuarioId: string, nota: string | null, contactado: boolean) {
  const antes = await prisma.reservaWebIntento.findUnique({ where: { id }, select: { contactadoEn: true, notaContacto: true } });
  if (!antes) throw new AppError('Intento no encontrado', 404, 'NOT_FOUND');
  const u = await prisma.reservaWebIntento.update({
    where: { id },
    data: contactado ? { contactadoEn: new Date(), contactadoPorId: usuarioId, notaContacto: nota } : { contactadoEn: null, contactadoPorId: null, notaContacto: nota },
  });
  void registrarAudit({ usuarioId, accion: contactado ? 'reserva_web_contactado' : 'reserva_web_contacto_quitado', entidad: 'reserva_web_intento', entidadId: id,
    antes: { contactadoEn: antes.contactadoEn, nota: antes.notaContacto }, despues: { contactadoEn: u.contactadoEn, nota: u.notaContacto } });
  return { contactadoEn: u.contactadoEn, notaContacto: u.notaContacto };
}
