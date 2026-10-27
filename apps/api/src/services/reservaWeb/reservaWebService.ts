/**
 * RESERVA WEB (05-oct-2026): reserva de citas desde la página pública (www.limablue.com/reserva) con pago previo.
 *
 * Flujo: catálogo → días/horas libres → crear reserva (aparta el horario RESERVA_WEB_MINUTOS_APARTADO min) →
 * iniciar pago en la pasarela → aviso de pago aprobado → se crea la cita en la Agenda (canal «web», pago completo,
 * profesional asignado automáticamente) con el MISMO endpoint que usa recepción (POST /citas), así hereda todas
 * sus reglas (anti doble reserva, almuerzos, permisos, correo de reserva, tiempo real, auditoría).
 *
 * Disponibilidad: la de siempre (calcularDisponibilidad) desglosada por profesional, MENOS los horarios ya
 * apartados por otras reservas web. Nunca se exponen nombres de profesionales ni datos de otros pacientes.
 * Todo queda inerte salvo RESERVA_WEB_HABILITADA=1.
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { calcularDisponibilidad } from '../disponibilidad';
import { fechaDb, fechaAStr, hoyLimaStr, LIMA_OFFSET_H } from '../../utils/fechaLima';
import { registrarAudit } from '../audit';
import { timeToMinutes } from '@limablue/shared';
import { pasarelaActiva, type AvisoPago, type DatosCheckout } from './pasarelas';
import { intentoConToken, enlazarReserva } from './intentos';

const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const MINUTOS_APARTADO = () => num(process.env.RESERVA_WEB_MINUTOS_APARTADO, 10);
const DIAS_MAX = () => num(process.env.RESERVA_WEB_DIAS_MAX, 30);
const ANTICIPACION_MIN = () => num(process.env.RESERVA_WEB_ANTICIPACION_MIN, 120); // reservar hoy: al menos 2 h antes
const ESTADOS_QUE_OCUPAN = ['esperando_pago', 'pagada'];

export function reservaWebHabilitada(): boolean {
  const v = (process.env.RESERVA_WEB_HABILITADA || '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

// 21-oct-2026: la cita se crea SOLO cuando el pago queda aprobado (procesarAvisoPago). Se quitó el modo
// RESERVA_WEB_MODO=sin_pago (creaba la cita al elegir la hora, sin pagar). Sin pasarela, la reserva no agenda.

function sumarDias(fecha: string, dias: number): string {
  const d = fechaDb(fecha); d.setUTCDate(d.getUTCDate() + dias); return fechaAStr(d);
}
function minutosAhoraLima(ref: Date = new Date()): number {
  return ((ref.getUTCHours() - LIMA_OFFSET_H + 24) % 24) * 60 + ref.getUTCMinutes();
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────
export interface VarianteWeb { id: string | null; nombre: string; precio: number }
export interface ServicioWeb { id: string; nombre: string; duracionMinutos: number; unidad: string; sedes: string[]; variantes: VarianteWeb[] }

export async function catalogo() {
  const [sedes, sedeUnidades, servicios] = await Promise.all([
    prisma.sede.findMany({ where: { activa: true, deletedAt: null }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }], select: { id: true, nombre: true, direccion: true, horario: true } }),
    prisma.sedeUnidadNegocio.findMany({ select: { sedeId: true, unidadNegocioId: true } }),
    prisma.servicio.findMany({
      where: { reservaOnline: true, activo: true, deletedAt: null, unidadNegocio: { activa: true, deletedAt: null, modoReserva: { not: 'preferencia_obligatoria' } } },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
      include: {
        unidadNegocio: { select: { id: true, nombre: true } },
        subcategorias: { where: { activo: true, deletedAt: null, reservaOnline: true }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] },
      },
    }),
  ]);
  const sedesActivas = new Set(sedes.map((s) => s.id));
  const out: ServicioWeb[] = [];
  for (const s of servicios) {
    const variantes: VarianteWeb[] = s.subcategorias.length
      ? s.subcategorias.map((v) => ({ id: v.id, nombre: v.nombre, precio: Number(v.precioReferencial ?? s.precioOnline ?? s.precioReferencial ?? 0) }))
      : [{ id: null, nombre: s.nombre, precio: Number(s.precioOnline ?? s.precioReferencial ?? 0) }];
    const conPrecio = variantes.filter((v) => v.precio > 0); // sin precio no se puede cobrar en línea
    if (!conPrecio.length) continue;
    out.push({
      id: s.id, nombre: s.nombre, duracionMinutos: s.duracionMinutos, unidad: s.unidadNegocio.nombre,
      sedes: sedeUnidades.filter((x) => x.unidadNegocioId === s.unidadNegocio.id && sedesActivas.has(x.sedeId)).map((x) => x.sedeId),
      variantes: conPrecio,
    });
  }
  return {
    sedes: sedes.map((s) => ({ id: s.id, nombre: s.nombre, direccion: s.direccion, horario: s.horario })),
    servicios: out.filter((s) => s.sedes.length > 0),
    reglas: { diasMaximos: DIAS_MAX(), minutosApartado: MINUTOS_APARTADO(), anticipacionMinutosHoy: ANTICIPACION_MIN() },
  };
}

/** Servicio + variante reservables en esa sede, con el monto a cobrar. */
export async function servicioReservable(sedeId: string, servicioId: string, subcategoriaId?: string | null) {
  const cat = await catalogo();
  const sv = cat.servicios.find((s) => s.id === servicioId);
  if (!sv || !sv.sedes.includes(sedeId)) throw new AppError('Ese servicio no se puede reservar en línea en esta sede', 400, 'SERVICIO_NO_RESERVABLE');
  const variante = sv.variantes.length === 1 && sv.variantes[0]!.id === null
    ? sv.variantes[0]!
    : sv.variantes.find((v) => v.id === (subcategoriaId ?? null));
  if (!variante) throw new AppError('Elige el tipo de servicio', 400, 'VARIANTE_REQUERIDA');
  const servicio = await prisma.servicio.findUniqueOrThrow({ where: { id: servicioId }, select: { unidadNegocioId: true, duracionMinutos: true, nombre: true } });
  return { servicio, variante, monto: variante.precio };
}

// ─── Disponibilidad ───────────────────────────────────────────────────────────
function validarVentana(fecha: string) {
  const hoy = hoyLimaStr();
  if (fecha < hoy) throw new AppError('Esa fecha ya pasó', 400, 'FECHA_PASADA');
  if (fecha > sumarDias(hoy, DIAS_MAX())) throw new AppError(`Solo se puede reservar hasta ${DIAS_MAX()} días adelante`, 400, 'FECHA_MUY_LEJANA');
}

/** Horas libres (HH:MM) para ese servicio, juntando a todos los profesionales y descontando lo apartado en la web. */
export async function horasLibres(sedeId: string, servicioId: string, fecha: string): Promise<string[]> {
  validarVentana(fecha);
  const servicio = await prisma.servicio.findUnique({ where: { id: servicioId }, select: { unidadNegocioId: true, duracionMinutos: true } });
  if (!servicio) return [];
  const opera = await prisma.sedeUnidadNegocio.findUnique({ where: { sedeId_unidadNegocioId: { sedeId, unidadNegocioId: servicio.unidadNegocioId } } });
  if (!opera) return [];

  const slots = await calcularDisponibilidad({ sedeId, unidadNegocioId: servicio.unidadNegocioId, servicioId, fecha, desglosado: true });
  const libresPorHora = new Map<string, number>();
  for (const s of slots) if (s.disponible) libresPorHora.set(s.horaInicio, (libresPorHora.get(s.horaInicio) ?? 0) + 1);

  const ahora = new Date();
  const apartadas = await prisma.reservaWeb.findMany({
    where: {
      sedeId, unidadNegocioId: servicio.unidadNegocioId, fecha: fechaDb(fecha),
      OR: [{ estado: 'esperando_pago', expiraEn: { gt: ahora } }, { estado: 'pagada' }],
    },
    select: { horaInicio: true, duracionMinutos: true },
  });
  const corte = fecha === hoyLimaStr() ? minutosAhoraLima(ahora) + ANTICIPACION_MIN() : -1;
  const out: string[] = [];
  for (const [hora, libres] of libresPorHora) {
    const ini = timeToMinutes(hora), fin = ini + servicio.duracionMinutos;
    if (ini < corte) continue;
    const ocupadasWeb = apartadas.filter((a) => { const ai = timeToMinutes(a.horaInicio); return ai < fin && ai + a.duracionMinutos > ini; }).length;
    if (libres - ocupadasWeb > 0) out.push(hora);
  }
  return out.sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
}

const cacheDias = new Map<string, { vence: number; valor: { fecha: string; horas: number }[] }>();
/** Días con horas libres en un rango (máx. 31 días) para pintar el calendario. Caché de 60 s. */
export async function diasDisponibles(sedeId: string, servicioId: string, desde: string, hasta: string) {
  const hoy = hoyLimaStr();
  const ini = desde < hoy ? hoy : desde;
  const tope = sumarDias(hoy, DIAS_MAX());
  let fin = hasta > tope ? tope : hasta;
  if (fin > sumarDias(ini, 30)) fin = sumarDias(ini, 30);
  const clave = `${sedeId}|${servicioId}|${ini}|${fin}`;
  const c = cacheDias.get(clave);
  if (c && c.vence > Date.now()) return c.valor;
  const valor: { fecha: string; horas: number }[] = [];
  for (let f = ini; f <= fin; f = sumarDias(f, 1)) {
    const n = (await horasLibres(sedeId, servicioId, f)).length;
    if (n > 0) valor.push({ fecha: f, horas: n });
  }
  cacheDias.set(clave, { vence: Date.now() + 60_000, valor });
  if (cacheDias.size > 500) for (const [k, v] of cacheDias) if (v.vence < Date.now()) cacheDias.delete(k);
  return valor;
}

// ─── Crear reserva (aparta el horario) ────────────────────────────────────────
export interface NuevaReservaWeb {
  numeroDocumento: string; nombres: string; apellidoPaterno: string; apellidoMaterno?: string | null;
  telefono: string; email: string; sedeId: string; servicioId: string; subcategoriaId?: string | null;
  fecha: string; horaInicio: string;
}

function nuevoCodigo(): string { return 'LB-' + String(crypto.randomInt(100000, 1000000)); }

export async function crearReserva(d: NuevaReservaWeb & { intentoId?: string | null; intentoToken?: string | null }, meta: { ip?: string; userAgent?: string }) {
  // 06-oct-2026: si viene de un intento (página nueva), el apartado vence cuando vence el intento (10 min desde el
  // primer «Continuar»), no 10 min desde aquí.
  const intento = d.intentoId && d.intentoToken ? await intentoConToken(d.intentoId, d.intentoToken) : null;
  const { servicio, variante, monto } = await servicioReservable(d.sedeId, d.servicioId, d.subcategoriaId);
  const ahora = new Date();
  // Freno de abuso: pocas reservas abiertas a la vez por documento y por IP.
  const otraQueLaPropia = intento?.reservaId ? { id: { not: intento.reservaId } } : {}; // la que este intento va a soltar no cuenta
  const [porDni, porIp] = await Promise.all([
    prisma.reservaWeb.count({ where: { numeroDocumento: d.numeroDocumento, estado: 'esperando_pago', expiraEn: { gt: ahora }, ...otraQueLaPropia } }),
    meta.ip ? prisma.reservaWeb.count({ where: { ip: meta.ip, estado: 'esperando_pago', expiraEn: { gt: ahora }, ...otraQueLaPropia } }) : Promise.resolve(0),
  ]);
  if (porDni >= 2 || porIp >= 5) throw new AppError('Ya tienes una reserva en curso. Termina de pagarla o espera unos minutos.', 429, 'RESERVAS_EN_CURSO');

  const reserva = await prisma.$transaction(async (tx) => {
    // Un solo «apartado» a la vez por sede y día: dos personas no pueden tomar el último cupo al mismo tiempo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reserva-web|${d.sedeId}|${d.fecha}`}))`;
    // Si volvió atrás y eligió otra hora: suelta el apartado anterior de ESTE intento (no ocupa dos horarios).
    if (intento?.reservaId) {
      await tx.reservaWeb.updateMany({ where: { id: intento.reservaId, estado: 'esperando_pago' }, data: { estado: 'expirada', expiraEn: ahora } });
    }
    const libres = await horasLibres(d.sedeId, d.servicioId, d.fecha);
    if (!libres.includes(d.horaInicio)) throw new AppError('Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const codigo = nuevoCodigo();
      if (await tx.reservaWeb.findUnique({ where: { codigo }, select: { id: true } })) continue;
      return tx.reservaWeb.create({
        data: {
          codigo, tokenConsulta: crypto.randomBytes(24).toString('hex'), estado: 'esperando_pago',
          tipoDocumento: 'DNI', numeroDocumento: d.numeroDocumento,
          nombres: d.nombres.trim(), apellidoPaterno: d.apellidoPaterno.trim(), apellidoMaterno: d.apellidoMaterno?.trim() || null,
          telefono: d.telefono, email: d.email.trim().toLowerCase(),
          sedeId: d.sedeId, unidadNegocioId: servicio.unidadNegocioId, servicioId: d.servicioId, subcategoriaId: variante.id,
          fecha: fechaDb(d.fecha), horaInicio: d.horaInicio, duracionMinutos: servicio.duracionMinutos,
          monto, expiraEn: intento ? intento.expiraEn : new Date(ahora.getTime() + MINUTOS_APARTADO() * 60_000),
          ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
    }
    throw new AppError('No se pudo generar el código de reserva, intenta de nuevo', 500, 'CODIGO_RESERVA');
  }, { timeout: 20_000 });
  cacheDias.clear();
  if (intento) {
    await enlazarReserva(intento.id, reserva.id, { sedeId: d.sedeId, servicioId: d.servicioId, subcategoriaId: variante.id, fecha: d.fecha, horaInicio: d.horaInicio });
  }
  void registrarAudit({ accion: 'reserva_web_creada', entidad: 'reserva_web', entidadId: reserva.id, sedeId: reserva.sedeId, ip: meta.ip, userAgent: meta.userAgent,
    despues: { codigo: reserva.codigo, fecha: d.fecha, horaInicio: d.horaInicio, servicio: servicio.nombre, variante: variante.nombre, monto } });
  return reserva;
}

// ─── Consultar / pagar ───────────────────────────────────────────────────────
async function reservaConToken(codigo: string, token: string) {
  const r = await prisma.reservaWeb.findUnique({ where: { codigo } });
  const ok = !!r && r.tokenConsulta.length === token.length && crypto.timingSafeEqual(Buffer.from(r.tokenConsulta), Buffer.from(token));
  if (!r || !ok) throw new AppError('Reserva no encontrada', 404, 'RESERVA_NO_ENCONTRADA');
  return r;
}

export async function estadoReserva(codigo: string, token: string) {
  const r = await reservaConToken(codigo, token);
  const vencida = r.estado === 'esperando_pago' && r.expiraEn <= new Date();
  const [sede, servicio, variante] = await Promise.all([
    prisma.sede.findUnique({ where: { id: r.sedeId }, select: { nombre: true, direccion: true } }),
    prisma.servicio.findUnique({ where: { id: r.servicioId }, select: { nombre: true } }),
    r.subcategoriaId ? prisma.subcategoriaServicio.findUnique({ where: { id: r.subcategoriaId }, select: { nombre: true } }) : Promise.resolve(null),
  ]);
  return {
    codigo: r.codigo, estado: vencida ? 'expirada' : r.estado, nombres: r.nombres,
    fecha: fechaAStr(r.fecha), horaInicio: r.horaInicio, duracionMinutos: r.duracionMinutos,
    sede, servicio: servicio?.nombre ?? null, variante: variante?.nombre ?? null,
    monto: Number(r.monto), moneda: r.moneda, expiraEn: r.expiraEn, pagadoEn: r.pagadoEn,
    pagoPendiente: r.pasarela === 'sin_pago', // reservó sin pagar: paga en la sede
  };
}

export async function iniciarPago(codigo: string, token: string): Promise<DatosCheckout> {
  const r = await reservaConToken(codigo, token);
  if (r.estado !== 'esperando_pago') throw new AppError('Esta reserva ya no está esperando pago', 409, 'RESERVA_NO_PAGABLE');
  if (r.expiraEn <= new Date()) throw new AppError('Se venció el tiempo para pagar. Vuelve a elegir tu horario.', 410, 'RESERVA_VENCIDA');
  const p = pasarelaActiva();
  const servicio = await prisma.servicio.findUnique({ where: { id: r.servicioId }, select: { nombre: true } });
  const checkout = await p.iniciarPago({
    codigo: r.codigo, monto: Number(r.monto), moneda: r.moneda, email: r.email, nombres: r.nombres, apellidoPaterno: r.apellidoPaterno,
    descripcion: `Limablue · ${servicio?.nombre ?? 'Cita'} · ${fechaAStr(r.fecha)} ${r.horaInicio}`,
  });
  await prisma.reservaWeb.update({ where: { id: r.id }, data: { pasarela: p.nombre } });
  return checkout;
}

// ─── Aviso de pago → crear la cita ────────────────────────────────────────────
/** Procesa un aviso de la pasarela. Idempotente: un aviso repetido no crea dos citas. */
export async function procesarAvisoPago(aviso: AvisoPago, pasarela: string) {
  const r = await prisma.reservaWeb.findUnique({ where: { codigo: aviso.codigo } });
  if (!r) { console.warn('[reserva-web] aviso de pago de una reserva que no existe:', aviso.codigo); return { ok: false, motivo: 'no_existe' }; }
  if (r.estado === 'confirmada' || r.estado === 'reembolsar') return { ok: true, estado: r.estado };
  if (!aviso.aprobado) {
    await prisma.reservaWeb.update({ where: { id: r.id }, data: { pagoEstado: aviso.estado, pagoReferencia: aviso.referencia, pagoDetalle: (aviso.detalle ?? null) as never } });
    return { ok: true, estado: r.estado };
  }
  // Solo UNO de dos avisos simultáneos pasa a «pagada» (guarda de estado).
  const u = await prisma.reservaWeb.updateMany({
    where: { id: r.id, estado: { in: ['esperando_pago', 'expirada', 'fallida'] } },
    data: { estado: 'pagada', pasarela, pagoReferencia: aviso.referencia, pagoEstado: aviso.estado, pagoDetalle: (aviso.detalle ?? null) as never, pagadoEn: new Date() },
  });
  if (u.count === 0) return { ok: true, estado: 'en_proceso' };
  void registrarAudit({ accion: 'reserva_web_pagada', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, pasarela, referencia: aviso.referencia, monto: Number(r.monto) } });
  return crearCitaDeReserva(r.id);
}

/** Paciente por DNI (si ya existe NO se cambian sus datos) o nuevo con lo que escribió en la web. */
async function pacienteDeReserva(r: { numeroDocumento: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null; telefono: string; email: string; id: string }) {
  const existente = await prisma.paciente.findFirst({ where: { tipoDocumento: 'DNI', numeroDocumento: r.numeroDocumento, deletedAt: null }, select: { id: true } });
  if (existente) return existente.id;
  const canalWeb = await prisma.canal.findFirst({ where: { valor: 'web', deletedAt: null }, select: { id: true } });
  try {
    const p = await prisma.paciente.create({
      data: {
        nombres: r.nombres, apellidoPaterno: r.apellidoPaterno, apellidoMaterno: r.apellidoMaterno ?? '',
        tipoDocumento: 'DNI', numeroDocumento: r.numeroDocumento, telefono: r.telefono, email: r.email,
        canalId: canalWeb?.id ?? null, requiereActualizacionDatos: true, notas: `Registrado desde la reserva web (${r.id}).`,
      },
      select: { id: true },
    });
    void registrarAudit({ accion: 'crear_paciente', entidad: 'paciente', entidadId: p.id, despues: { origen: 'reserva_web', numeroDocumento: r.numeroDocumento, nombres: r.nombres, apellidoPaterno: r.apellidoPaterno } });
    return p.id;
  } catch {
    // Alta simultánea del mismo DNI: el índice único lo frena; se usa el que quedó.
    const otro = await prisma.paciente.findFirst({ where: { tipoDocumento: 'DNI', numeroDocumento: r.numeroDocumento, deletedAt: null }, select: { id: true } });
    if (!otro) throw new AppError('No se pudo registrar al paciente', 500, 'PACIENTE_WEB');
    return otro.id;
  }
}

/** Crea la cita con el mismo endpoint de la Agenda (POST /citas) usando la llave interna de la reserva web. */
export async function crearCitaDeReserva(reservaId: string) {
  const r = await prisma.reservaWeb.findUniqueOrThrow({ where: { id: reservaId } });
  if (r.estado !== 'pagada') return { ok: true, estado: r.estado };
  const sinPago = r.pasarela === 'sin_pago';
  try {
    const llave = process.env.RESERVA_WEB_API_KEY;
    if (!llave) throw new Error('Falta RESERVA_WEB_API_KEY');
    const pacienteId = r.pacienteId ?? await pacienteDeReserva(r);
    const base = process.env.RESERVA_WEB_API_INTERNA || `http://127.0.0.1:${Number(process.env.PORT) || 3001}`;
    const resp = await fetch(`${base}/api/v1/citas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `ApiKey ${llave}`, 'Idempotency-Key': `reserva-web-${r.id}` },
      body: JSON.stringify({
        pacienteId, sedeId: r.sedeId, unidadNegocioId: r.unidadNegocioId, servicioId: r.servicioId,
        ...(r.subcategoriaId ? { subcategoriaId: r.subcategoriaId } : {}),
        fecha: fechaAStr(r.fecha), horaInicio: r.horaInicio, canal: 'web', estadoPago: sinPago ? 'pendiente' : 'completo',
        comentarioRecepcion: sinPago
          ? `Reserva web ${r.codigo}: reservó por internet sin pagar; paga S/ ${Number(r.monto).toFixed(2)} en la sede.`
          : `Reserva web ${r.codigo}: pagó S/ ${Number(r.monto).toFixed(2)} en línea (${r.pasarela ?? 'pasarela'} ${r.pagoReferencia ?? ''}).`.trim(),
      }),
    });
    const cuerpo = await resp.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
    if (!resp.ok || !cuerpo.id) throw new Error(cuerpo.message || cuerpo.error || `HTTP ${resp.status}`);
    await prisma.reservaWeb.update({ where: { id: r.id }, data: { estado: 'confirmada', citaId: cuerpo.id, pacienteId, error: null } });
    void registrarAudit({ citaId: cuerpo.id, accion: 'reserva_web_confirmada', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, citaId: cuerpo.id } });
    cacheDias.clear();
    return { ok: true, estado: 'confirmada', citaId: cuerpo.id };
  } catch (e) {
    // Pagó pero ya no hay cupo (o falló la Agenda): queda para que administración devuelva el dinero o reubique.
    // Sin pago no hay nada que devolver: la reserva queda «fallida» y el paciente elige otra hora.
    const msg = (e as Error).message.slice(0, 500);
    if (sinPago) {
      await prisma.reservaWeb.update({ where: { id: r.id }, data: { estado: 'fallida', error: msg } });
      console.error(`[reserva-web] ${r.codigo} sin pago, no se pudo crear la cita: ${msg}`);
      return { ok: false, estado: 'fallida', error: msg };
    }
    await prisma.reservaWeb.update({ where: { id: r.id }, data: { estado: 'reembolsar', error: msg } });
    void registrarAudit({ accion: 'reserva_web_sin_cita', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, error: msg } });
    console.error(`[reserva-web] ${r.codigo} pagada pero sin cita: ${msg}`);
    return { ok: false, estado: 'reembolsar', error: msg };
  }
}

/** Mantenimiento cada minuto: vence los apartados sin pago. */
export async function mantenimientoReservasWeb() {
  const u = await prisma.reservaWeb.updateMany({ where: { estado: 'esperando_pago', expiraEn: { lt: new Date() } }, data: { estado: 'expirada' } });
  if (u.count) cacheDias.clear();
  return u.count;
}
