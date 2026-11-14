/**
 * PAGO PREVIO DE SÁBADO Y DOMINGO (13-nov-2026) — solo reservas del chat de WhatsApp (API /integraciones/whatsapp).
 *
 *   POST /  (fin de semana, tienda conectada) → pedido en WooCommerce + cita creada con pago pendiente; reserva «esperando_pago»
 *           con MINUTOS_PAGO para pagar (el enlace va en la respuesta y el chat se lo manda al paciente).
 *   Pagó     → aviso firmado de la tienda (routes/pagoWoo.ts) → se RELEE el pedido → reserva «confirmada», pagoEstado «aprobado»
 *              y la cita pasa a pago «completo» (PATCH /citas/:id/pago, como en la pantalla).
 *   No pagó  → al vencer, el mantenimiento de cada minuto vuelve a mirar el pedido y, si de verdad no se pagó, cancela la cita
 *              (PATCH /citas/:id/estado), libera la hora y cancela el pedido. Reserva «expirada».
 *   Pagó tarde, o la cita ya no existe → reserva «reembolsar»: un asesor devuelve el dinero o reagenda (sale en la agenda,
 *              en «Reservas web»). Devoluciones: siempre a mano en la tienda.
 *
 * Todo cambio a la cita pasa por los MISMOS endpoints de la Agenda con la llave interna (llamarAgenda): auditoría, tiempo real.
 */
import { prisma } from '../../db';
import { registrarAudit } from '../audit';
import { formatoNumeroCita } from '@limablue/shared';
import { PASARELA_WOO, llamarAgenda, limpiarCacheDias } from './reservaWebService';
import { MINUTOS_PAGO, leerPedidoWoo, cancelarPedidoWoo, wooConfigurado, PEDIDO_PAGADO, PEDIDO_NO_PAGADO, type PedidoWoo } from './woocommerce';

const VIVOS = ['agendada', 'confirmada', 'llego', 'en_atencion'];

async function comentar(citaId: string, texto: string) {
  const r = await llamarAgenda('PATCH', `/citas/${citaId}/comentario`, { comentario: texto }).catch(() => null);
  if (!r?.ok) console.error(`[pago-previo] no se pudo dejar el comentario en la cita ${citaId}`);
}

/** Cita «pago completo» con el mismo endpoint de la pantalla. */
async function marcarCitaPagada(citaId: string, codigo: string, p: PedidoWoo) {
  const r = await llamarAgenda('PATCH', `/citas/${citaId}/pago`, { estadoPago: 'completo' }).catch(() => null);
  if (!r?.ok) console.error(`[pago-previo] ${codigo}: el pago se recibió pero no se pudo marcar la cita como pagada (HTTP ${r?.status ?? 'sin respuesta'}). Marcarla a mano.`);
  await comentar(citaId, `Reserva ${codigo}: PAGÓ S/ ${p.total.toFixed(2)} por la tienda en línea (pedido #${p.id}${p.idTransaccion ? `, operación ${p.idTransaccion}` : ''}).`);
}

type Resultado = 'sin_reserva' | 'codigo_distinto' | 'confirmada' | 'ya_procesada' | 'monto_distinto' | 'reembolsar' | 'rechazado' | 'sin_cambio';

/**
 * Revisa un pedido de la tienda y actúa. Lo llama el aviso de WooCommerce y el vencimiento. SIEMPRE relee el pedido en la tienda:
 * el aviso solo dice «mira este pedido». Idempotente (cada cambio de estado es un updateMany condicionado).
 */
export async function procesarPagoWoo(pedidoId: string | number): Promise<Resultado> {
  const p = await leerPedidoWoo(pedidoId);
  const r = await prisma.reservaWeb.findFirst({ where: { pasarela: PASARELA_WOO, pagoReferencia: String(p.id) } });
  if (!r) return 'sin_reserva';
  if (p.codigo && p.codigo !== r.codigo) {
    console.error(`[pago-previo] pedido #${p.id}: su código ${p.codigo} no coincide con la reserva ${r.codigo}. REVISAR.`);
    return 'codigo_distinto';
  }

  if (PEDIDO_PAGADO.has(p.estado)) {
    if (r.pagoEstado === 'aprobado' || r.pagoEstado === 'monto_distinto') return 'ya_procesada';
    const detalle = { ...(r.pagoDetalle as object | null ?? {}), estadoTienda: p.estado, total: p.total, operacion: p.idTransaccion };

    if (Math.abs(p.total - Number(r.monto)) > 0.009) {
      const u = await prisma.reservaWeb.updateMany({
        where: { id: r.id, pagoEstado: { not: 'monto_distinto' } },
        data: { estado: 'reembolsar', pagoEstado: 'monto_distinto', pagadoEn: new Date(), pagoDetalle: detalle, error: `Se pagó S/ ${p.total.toFixed(2)} y la cita vale S/ ${Number(r.monto).toFixed(2)} (pedido #${p.id}). Revisar en la tienda.` },
      });
      if (u.count) {
        console.error(`[pago-previo] ${r.codigo}: pedido #${p.id} pagado por S/ ${p.total} y la cita vale S/ ${Number(r.monto)}. REVISAR.`);
        if (r.citaId) await comentar(r.citaId, `Reserva ${r.codigo}: se pagó S/ ${p.total.toFixed(2)} por la tienda (pedido #${p.id}) y la cita vale S/ ${Number(r.monto).toFixed(2)}. Revisar el pago.`);
      }
      return 'monto_distinto';
    }

    // ¿Sigue viva la cita? (pudieron cancelarla en la agenda o por el chat mientras pagaba).
    const cita = r.citaId ? await prisma.cita.findUnique({ where: { id: r.citaId }, select: { estado: true, deletedAt: true } }) : null;
    const citaViva = !!cita && !cita.deletedAt && VIVOS.includes(cita.estado);

    if (r.estado === 'esperando_pago' && citaViva) {
      const u = await prisma.reservaWeb.updateMany({
        where: { id: r.id, estado: 'esperando_pago' },
        data: { estado: 'confirmada', pagoEstado: 'aprobado', pagadoEn: new Date(), pagoDetalle: detalle },
      });
      if (!u.count) return 'ya_procesada';
      await marcarCitaPagada(r.citaId!, r.codigo, p);
      limpiarCacheDias();
      void registrarAudit({ citaId: r.citaId!, accion: 'reserva_web_pagada', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, pasarela: PASARELA_WOO, pedido: p.id, total: p.total } });
      return 'confirmada';
    }

    // Pagó cuando ya había vencido, o la cita ya no está: el dinero entró pero no hay cita. Lo resuelve un asesor.
    const u = await prisma.reservaWeb.updateMany({
      where: { id: r.id, estado: { in: ['esperando_pago', 'expirada', 'confirmada'] }, pagoEstado: { not: 'aprobado' } },
      data: {
        estado: 'reembolsar', pagoEstado: 'aprobado', pagadoEn: new Date(), pagoDetalle: detalle,
        error: `Pagó S/ ${p.total.toFixed(2)} (pedido #${p.id}) cuando la cita ya no estaba vigente. Devolver el pago en la tienda o reagendar.`,
      },
    });
    if (u.count) {
      console.error(`[pago-previo] PAGO SIN CITA: ${r.codigo} (pedido #${p.id}, S/ ${p.total}). Un asesor debe devolver o reagendar.`);
      void registrarAudit({ citaId: r.citaId ?? undefined, accion: 'reserva_web_pago_tardio', entidad: 'reserva_web', entidadId: r.id, sedeId: r.sedeId, despues: { codigo: r.codigo, pedido: p.id, total: p.total } });
    }
    return 'reembolsar';
  }

  // Pago fallido o pedido cancelado en la tienda: se anota; la cita sigue apartada hasta que venza (con un pago fallido
  // el paciente puede reintentar con el mismo enlace).
  if (PEDIDO_NO_PAGADO.has(p.estado) && r.estado === 'esperando_pago' && r.pagoEstado !== 'rechazado') {
    await prisma.reservaWeb.update({ where: { id: r.id }, data: { pagoEstado: 'rechazado' } });
    return 'rechazado';
  }
  return 'sin_cambio';
}

interface Vencida { id: string; codigo: string; citaId: string | null; pagoReferencia: string | null; expiraEn: Date }

/** Venció el plazo: si de verdad no pagó, se cancela la cita (queda libre la hora) y el pedido. */
async function cerrarVencida(r: Vencida) {
  if (r.pagoReferencia) {
    try {
      const res = await procesarPagoWoo(r.pagoReferencia);
      if (res !== 'sin_cambio' && res !== 'rechazado') return; // pagó a último minuto o ya se resolvió
    } catch (e) {
      // La tienda no respondió: se reintenta el próximo minuto (hasta 30 min; después se cierra igual para no tener la hora tomada).
      if (r.expiraEn.getTime() > Date.now() - 30 * 60_000) { console.error(`[pago-previo] ${r.codigo}: no se pudo revisar el pedido, se reintenta:`, (e as Error).message); return; }
    }
  }
  const u = await prisma.reservaWeb.updateMany({ where: { id: r.id, estado: 'esperando_pago' }, data: { estado: 'expirada' } });
  if (!u.count) return;
  if (r.pagoReferencia) await cancelarPedidoWoo(r.pagoReferencia).catch((e) => console.error(`[pago-previo] ${r.codigo}: no se pudo cancelar el pedido:`, (e as Error).message));
  if (r.citaId) {
    const cita = await prisma.cita.findUnique({ where: { id: r.citaId }, select: { estado: true, deletedAt: true, estadoPago: true, numero: true } });
    if (cita && !cita.deletedAt && ['agendada', 'confirmada'].includes(cita.estado)) {
      const resp = await llamarAgenda('PATCH', `/citas/${r.citaId}/estado`, {
        estado: 'cancelada', motivoCancelacion: `No pagó el pago previo en ${MINUTOS_PAGO} minutos (reserva ${r.codigo})`,
      }).catch(() => null);
      if (!resp?.ok) console.error(`[pago-previo] ${r.codigo}: no se pudo cancelar la cita ${formatoNumeroCita(cita.numero)} (HTTP ${resp?.status ?? 'sin respuesta'}). Cancelarla a mano.`);
    }
  }
  limpiarCacheDias();
  void registrarAudit({ citaId: r.citaId ?? undefined, accion: 'reserva_web_vencida_sin_pago', entidad: 'reserva_web', entidadId: r.id, despues: { codigo: r.codigo, pedido: r.pagoReferencia } });
}

let corriendo = false;
/** Cada minuto (index.ts): cierra los pagos previos vencidos. Sin tienda conectada no hace nada. */
export async function mantenimientoPagoPrevio(): Promise<number> {
  if (corriendo || !wooConfigurado()) return 0;
  corriendo = true;
  try {
    const vencidas = await prisma.reservaWeb.findMany({
      where: { pasarela: PASARELA_WOO, estado: 'esperando_pago', expiraEn: { lt: new Date() } },
      select: { id: true, codigo: true, citaId: true, pagoReferencia: true, expiraEn: true },
      orderBy: { expiraEn: 'asc' }, take: 30,
    });
    for (const r of vencidas) await cerrarVencida(r).catch((e) => console.error(`[pago-previo] ${r.codigo}:`, (e as Error).message));
    return vencidas.length;
  } finally {
    corriendo = false;
  }
}

/**
 * La cita de un pago previo PENDIENTE se canceló por el chat (gestion.ts): la reserva se cierra y el pedido se cancela,
 * para que el enlace ya no sirva. Si igual llega a pagar, procesarPagoWoo la deja en «reembolsar».
 */
export async function cerrarPagoPendienteDeCita(citaId: string): Promise<void> {
  const r = await prisma.reservaWeb.findFirst({ where: { citaId, pasarela: PASARELA_WOO, estado: 'esperando_pago' }, select: { id: true, codigo: true, pagoReferencia: true } });
  if (!r) return;
  const u = await prisma.reservaWeb.updateMany({ where: { id: r.id, estado: 'esperando_pago' }, data: { estado: 'expirada', error: 'La cita se canceló antes de pagar.' } });
  if (u.count && r.pagoReferencia) await cancelarPedidoWoo(r.pagoReferencia).catch((e) => console.error(`[pago-previo] ${r.codigo}: no se pudo cancelar el pedido:`, (e as Error).message));
}
