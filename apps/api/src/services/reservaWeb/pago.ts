/**
 * PAGO EN LÍNEA de la reserva web con Niubiz (10-nov-2026). Apagado por defecto (NIUBIZ_HABILITADO=1); el chat de WhatsApp
 * sigue reservando sin pago.
 *
 *  iniciarPago     valida, APARTA el horario unos minutos y pide a Niubiz el token de sesión para el botón de pago.
 *                  No se cobra nada: si el paciente cierra la ventana, el apartado vence solo.
 *  procesarRetorno el navegador vuelve de Niubiz con un `transactionToken`: se autoriza el cobro (único momento en que se
 *                  cobra), se compara el monto y se CREA LA CITA con el mismo proceso de la Agenda (pago completo).
 *                  Si se cobró y la cita no se pudo crear, se ANULA el cobro; si no se puede anular, queda «reembolsar».
 *
 * Estados de reservas_web: esperando_pago → autorizando → confirmada | fallida | reembolsar ; esperando_pago → expirada.
 * `pagoEstado`: pendiente · aprobado · denegado · anulado · cobrado_sin_cita · incierto · rechazado · sin_sesion.
 * `pagoReferencia` = número de pedido de Niubiz (secuencia reservas_web_numero_compra_seq, máx. 12 caracteres).
 */
import crypto from 'crypto';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { registrarAudit } from '../audit';
import { fechaDb, fechaAStr } from '../../utils/fechaLima';
import { intentoConToken, enlazarReserva } from './intentos';
import type { TipoDocumentoReserva } from './validaciones';
import {
  servicioReservable, horasLibres, nuevoCodigo, pacienteDeReserva, crearCitaEnAgenda, limpiarCacheDias,
  type NuevaReservaWeb,
} from './reservaWebService';
import {
  configNiubiz, niubizHabilitado, tokenAcceso, tokenSesion, autorizar, reversar, NiubizError, type ConfigNiubiz, type Autorizacion,
} from './niubiz';

const MINUTOS_APARTADO = () => {
  const n = Number(process.env.NIUBIZ_MINUTOS_PAGO);
  return Number.isFinite(n) && n >= 5 && n <= 30 ? n : 10;
};

export interface PagoIniciado {
  codigo: string;
  token: string;
  monto: number;
  moneda: 'PEN';
  numeroCompra: string;
  merchantId: string;
  sessionKey: string;
  minutos: number;
  checkoutJs: string;
  entorno: 'sandbox' | 'produccion';
  /** URL a la que el botón de Niubiz hace POST al terminar. */
  action: string;
  expiraEn: string;
}

export interface OrigenPago {
  ip?: string;
  userAgent?: string;
  intentoId?: string | null;
  intentoToken?: string | null;
  /** Página de la reserva a la que se vuelve después del pago (ya validada). */
  retornoUrl: string;
  /** Dirección pública de la Agenda (https://dominio) para armar la URL de retorno. */
  baseUrl: string;
}

export async function iniciarPago(d: NuevaReservaWeb, o: OrigenPago): Promise<PagoIniciado> {
  if (!niubizHabilitado()) throw new AppError('El pago en línea no está disponible', 404, 'PAGO_NO_DISPONIBLE');
  const cfg = configNiubiz();
  const intento = o.intentoId && o.intentoToken ? await intentoConToken(o.intentoId, o.intentoToken, false) : null;
  const { servicio, variante, monto } = await servicioReservable(d.sedeId, d.servicioId, d.subcategoriaId);

  // Freno de abuso: cada intento pide una sesión a Niubiz. Pocos pagos iniciados (y no confirmados) por documento y por conexión en 1 h.
  const desde = new Date(Date.now() - 3_600_000);
  const [porDoc, porIp] = await Promise.all([
    prisma.reservaWeb.count({ where: { pasarela: 'niubiz', tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento, creadoEn: { gt: desde } } }),
    o.ip ? prisma.reservaWeb.count({ where: { pasarela: 'niubiz', ip: o.ip, creadoEn: { gt: desde } } }) : Promise.resolve(0),
  ]);
  if (porDoc >= 6 || porIp >= 20) throw new AppError('Hiciste varios intentos de pago seguidos. Espera un momento o comunícate con nosotros.', 429, 'DEMASIADOS_PAGOS');

  const minutos = MINUTOS_APARTADO();
  // Un intento nuevo reemplaza los apartados pendientes de la MISMA persona (cerró la ventana de pago y vuelve a intentar): si no,
  // su propio apartado le bloquearía la hora. Nada se cobró (se cobra recién al volver de Niubiz), así que no hay nada que devolver.
  await prisma.reservaWeb.updateMany({
    where: { pasarela: 'niubiz', estado: 'esperando_pago', tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento },
    data: { estado: 'expirada' },
  });
  const codigo = nuevoCodigo();
  const reserva = await prisma.$transaction(async (tx) => {
    // Un solo registro a la vez por sede y día: dos personas no pueden apartar el último cupo al mismo tiempo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reserva-web|${d.sedeId}|${d.fecha}`}))`;
    const libres = await horasLibres(d.sedeId, d.servicioId, d.fecha); // ya descuenta lo apartado por otros pagos
    if (!libres.includes(d.horaInicio)) throw new AppError('Esa hora acaba de ocuparse. Elige otra.', 409, 'HORA_NO_DISPONIBLE');
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('reservas_web_numero_compra_seq') AS n`;
    return tx.reservaWeb.create({
      data: {
        codigo, tokenConsulta: crypto.randomBytes(24).toString('hex'), estado: 'esperando_pago', canal: 'web',
        tipoDocumento: d.tipoDocumento, numeroDocumento: d.numeroDocumento,
        nombres: d.nombres.trim(), apellidoPaterno: d.apellidoPaterno.trim(), apellidoMaterno: d.apellidoMaterno?.trim() || null,
        telefono: d.telefono, email: d.email ?? '',
        sedeId: d.sedeId, unidadNegocioId: servicio.unidadNegocioId, servicioId: d.servicioId, subcategoriaId: variante.id,
        fecha: fechaDb(d.fecha), horaInicio: d.horaInicio, duracionMinutos: servicio.duracionMinutos,
        monto, pasarela: 'niubiz', pagoReferencia: String(n), pagoEstado: 'pendiente',
        pagoDetalle: { retornoUrl: o.retornoUrl, entorno: cfg.entorno },
        expiraEn: new Date(Date.now() + minutos * 60_000),
        ip: o.ip ?? null, userAgent: o.userAgent?.slice(0, 300) ?? null,
      },
    });
  }, { timeout: 30_000, maxWait: 10_000 });
  limpiarCacheDias();
  void registrarAudit({
    accion: 'pago_iniciado', entidad: 'reserva_web', entidadId: reserva.id, sedeId: reserva.sedeId, ip: o.ip, userAgent: o.userAgent,
    despues: { codigo, numeroCompra: reserva.pagoReferencia, monto, entorno: cfg.entorno, fecha: d.fecha, horaInicio: d.horaInicio },
  });
  if (intento) await enlazarReserva(intento.id, reserva.id, { sedeId: d.sedeId, servicioId: d.servicioId, subcategoriaId: variante.id, fecha: d.fecha, horaInicio: d.horaInicio }).catch(() => undefined);

  try {
    const acceso = await tokenAcceso(cfg);
    const sesion = await tokenSesion(cfg, acceso, { monto, ip: o.ip ?? '', email: d.email ?? '', documento: d.numeroDocumento, telefono: d.telefono });
    return {
      codigo, token: reserva.tokenConsulta, monto, moneda: 'PEN', numeroCompra: reserva.pagoReferencia!, merchantId: cfg.merchantId,
      sessionKey: sesion.sessionKey, minutos, checkoutJs: cfg.checkoutJs, entorno: cfg.entorno,
      action: `${o.baseUrl.replace(/\/$/, '')}/api/v1/publico/reservas/pago/retorno/${codigo}`,
      expiraEn: reserva.expiraEn.toISOString(),
    };
  } catch (e) {
    await prisma.reservaWeb.update({ where: { id: reserva.id }, data: { estado: 'fallida', pagoEstado: 'sin_sesion', error: String((e as Error).message).slice(0, 300) } });
    limpiarCacheDias();
    console.error(`[pago] ${codigo}: no se pudo abrir la sesión de pago: ${(e as Error).message}`);
    throw new AppError('No pudimos iniciar el pago. Intenta de nuevo en unos minutos o reserva y paga en la sede.', 502, 'PAGO_NO_DISPONIBLE');
  }
}

// ─── Retorno de Niubiz ────────────────────────────────────────────────────────
export type DestinoPago = 'ok' | 'denegado' | 'sin_horario' | 'incierto' | 'expirada' | 'medio_no_soportado' | 'error';

export interface ResultadoRetorno {
  destino: DestinoPago;
  codigo?: string;
  token?: string;
  retornoUrl?: string;
  /** Texto corto para mostrar al paciente (no técnico). */
  motivo?: string;
}

export interface FormularioRetorno { transactionToken?: string; channel?: string; customerEmail?: string }

type Reserva = NonNullable<Awaited<ReturnType<typeof prisma.reservaWeb.findUnique>>>;

const mezclar = (r: Reserva, extra: Record<string, unknown>) => ({ ...((r.pagoDetalle as Record<string, unknown> | null) ?? {}), ...extra });

/** Anula un cobro ya autorizado con un token de acceso nuevo. true = Niubiz confirmó la anulación. */
async function intentarAnular(cfg: ConfigNiubiz, numeroCompra: string, fechaTransaccion: string): Promise<boolean> {
  try {
    const acceso = await tokenAcceso(cfg);
    return await reversar(cfg, acceso, { numeroCompra, fechaTransaccion });
  } catch (e) {
    console.error(`[pago] no se pudo anular el pedido ${numeroCompra}: ${(e as Error).message}`);
    return false;
  }
}

export async function procesarRetorno(codigo: string, form: FormularioRetorno, ctx: { ip?: string } = {}): Promise<ResultadoRetorno> {
  const r = await prisma.reservaWeb.findUnique({ where: { codigo } });
  if (!r || r.pasarela !== 'niubiz') return { destino: 'error' };
  const base = { codigo: r.codigo, token: r.tokenConsulta, retornoUrl: (r.pagoDetalle as { retornoUrl?: string } | null)?.retornoUrl };

  // Idempotente: refrescar la página de retorno no cobra dos veces ni crea otra cita.
  if (r.estado === 'confirmada') return { destino: 'ok', ...base };
  if (r.estado === 'autorizando') return { destino: 'incierto', ...base, motivo: 'Estamos confirmando tu pago. Revisa tu correo en unos minutos.' };
  if (r.estado === 'reembolsar') return { destino: 'incierto', ...base, motivo: 'Tu pago está en revisión. Te contactaremos.' };
  if (r.estado !== 'esperando_pago') return { destino: r.estado === 'expirada' ? 'expirada' : 'error', ...base };

  if (r.expiraEn.getTime() + 60_000 < Date.now()) {
    await prisma.reservaWeb.updateMany({ where: { id: r.id, estado: 'esperando_pago' }, data: { estado: 'expirada' } });
    limpiarCacheDias();
    return { destino: 'expirada', ...base };
  }
  if (form.channel === 'pagoefectivo') {
    await prisma.reservaWeb.updateMany({ where: { id: r.id, estado: 'esperando_pago' }, data: { estado: 'fallida', pagoEstado: 'medio_no_soportado' } });
    limpiarCacheDias();
    return { destino: 'medio_no_soportado', ...base, motivo: 'Por ahora no aceptamos PagoEfectivo en la reserva en línea. Paga con tarjeta o en la sede.' };
  }
  const transactionToken = (form.transactionToken || '').trim();
  if (!transactionToken || transactionToken.length > 100) return { destino: 'error', ...base };

  // Solo una llamada puede autorizar: la que logra pasar el pedido de «esperando_pago» a «autorizando».
  const reclamo = await prisma.reservaWeb.updateMany({ where: { id: r.id, estado: 'esperando_pago' }, data: { estado: 'autorizando' } });
  if (reclamo.count === 0) return { destino: 'incierto', ...base, motivo: 'Estamos confirmando tu pago. Revisa tu correo en unos minutos.' };

  const cfg = configNiubiz();
  const numeroCompra = r.pagoReferencia!;
  const monto = Number(r.monto);
  const cerrar = (data: Record<string, unknown>, accion: string, extraAudit: Record<string, unknown> = {}) => {
    limpiarCacheDias();
    void registrarAudit({ citaId: (data.citaId as string | undefined), accion, entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, ip: ctx.ip, despues: { codigo, numeroCompra, monto, ...extraAudit } });
    return prisma.reservaWeb.update({ where: { id: r.id }, data: data as never });
  };

  // 1) Autorizar: único momento en que se cobra.
  let aut: Autorizacion;
  try {
    const acceso = await tokenAcceso(cfg);
    aut = await autorizar(cfg, acceso, { tokenId: transactionToken, numeroCompra, monto });
  } catch (e) {
    if (e instanceof NiubizError && e.tipo === 'denegado') {
      await cerrar({ estado: 'fallida', pagoEstado: 'denegado', pagoDetalle: mezclar(r, { codigoAccion: e.detalle.codigoAccion, descripcion: e.detalle.descripcion }), error: e.detalle.descripcion?.slice(0, 300) ?? 'Pago denegado' }, 'pago_denegado', { codigoAccion: e.detalle.codigoAccion });
      return { destino: 'denegado', ...base, motivo: e.detalle.descripcion || 'El banco no autorizó el pago.' };
    }
    if (e instanceof NiubizError && e.tipo === 'rechazo') {
      console.error(`[pago] ${codigo}: Niubiz rechazó la solicitud: ${e.message}`);
      await cerrar({ estado: 'fallida', pagoEstado: 'rechazado', error: e.message.slice(0, 300) }, 'pago_rechazado');
      return { destino: 'error', ...base };
    }
    // Se perdió la respuesta: no se sabe si se cobró. Se deja «reembolsar» para que administración lo verifique en Niubiz.
    console.error(`[pago] ${codigo}: resultado incierto de la autorización: ${(e as Error).message}`);
    await cerrar({ estado: 'reembolsar', pagoEstado: 'incierto', error: 'Niubiz no respondió a la autorización: verifica en Niubiz si se cobró.' }, 'pago_incierto');
    return { destino: 'incierto', ...base, motivo: 'No pudimos confirmar tu pago. Si te lo cobraron, te lo devolveremos; te contactaremos.' };
  }

  // 2) El monto autorizado debe ser el que pedimos.
  if (!Number.isFinite(aut.montoAutorizado) || Math.abs(aut.montoAutorizado - monto) > 0.001) {
    const anulado = await intentarAnular(cfg, numeroCompra, aut.fechaTransaccion);
    await cerrar({ estado: anulado ? 'fallida' : 'reembolsar', pagoEstado: anulado ? 'anulado' : 'cobrado_sin_cita', pagoDetalle: mezclar(r, { transaccionId: aut.transaccionId, fechaTransaccion: aut.fechaTransaccion, montoAutorizado: aut.montoAutorizado }), error: `El monto autorizado (${aut.montoAutorizado}) no coincide con el pedido (${monto}).` }, 'pago_monto_distinto');
    return { destino: anulado ? 'error' : 'incierto', ...base, motivo: anulado ? undefined : 'Tu pago está en revisión. Te contactaremos.' };
  }

  // 3) Crear la cita (mismo proceso que la Agenda). Si falla, se anula el cobro.
  const datos: NuevaReservaWeb = {
    tipoDocumento: r.tipoDocumento as TipoDocumentoReserva, numeroDocumento: r.numeroDocumento, nombres: r.nombres, apellidoPaterno: r.apellidoPaterno,
    apellidoMaterno: r.apellidoMaterno, telefono: r.telefono, email: r.email, sedeId: r.sedeId, servicioId: r.servicioId, subcategoriaId: r.subcategoriaId,
    fecha: fechaAStr(r.fecha), horaInicio: r.horaInicio,
  };
  const detallePago = mezclar(r, {
    transaccionId: aut.transaccionId, fechaTransaccion: aut.fechaTransaccion, codigoAutorizacion: aut.codigoAutorizacion,
    marca: aut.marca, tarjeta: aut.tarjeta, firma: aut.firma, montoAutorizado: aut.montoAutorizado,
  });
  let pacienteId: string, citaId: string;
  try {
    pacienteId = await pacienteDeReserva(datos, 'web', codigo);
    citaId = await crearCitaEnAgenda({
      pacienteId, unidadNegocioId: r.unidadNegocioId, subcategoriaId: r.subcategoriaId, codigo, monto,
      claveIdempotencia: `reserva-web-${codigo}`, pago: { transaccionId: aut.transaccionId },
    }, datos, 'web');
  } catch (e) {
    console.error(`[pago] ${codigo}: cobrado pero la cita no se creó (${(e as Error).message}); se anula el cobro`);
    const anulado = await intentarAnular(cfg, numeroCompra, aut.fechaTransaccion);
    await cerrar(
      { estado: anulado ? 'fallida' : 'reembolsar', pagoEstado: anulado ? 'anulado' : 'cobrado_sin_cita', pagoDetalle: detallePago, error: `No se pudo crear la cita: ${(e as Error).message}`.slice(0, 300) },
      anulado ? 'pago_anulado' : 'pago_cobrado_sin_cita', { transaccionId: aut.transaccionId },
    );
    return {
      destino: 'sin_horario', ...base,
      motivo: anulado ? 'Esa hora se ocupó mientras pagabas. Anulamos el cobro: elige otra hora.' : 'Esa hora se ocupó mientras pagabas. Te devolveremos el dinero; te contactaremos.',
    };
  }

  // 4) Listo.
  await cerrar(
    { estado: 'confirmada', pagoEstado: 'aprobado', pagoDetalle: detallePago, pagadoEn: new Date(), pacienteId, citaId, error: null },
    'pago_aprobado', { transaccionId: aut.transaccionId, citaId },
  );
  return { destino: 'ok', ...base };
}
