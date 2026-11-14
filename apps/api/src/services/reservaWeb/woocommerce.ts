/**
 * CLIENTE DE WOOCOMMERCE (13-nov-2026) — pago previo de las citas de SÁBADO y DOMINGO reservadas por el chat de WhatsApp.
 *
 * La Agenda crea un pedido «pendiente de pago» en la tienda de limablue.com (allí ya está la pasarela Niubiz) y usa su enlace de
 * pago (`payment_url`). La lógica de la reserva (cuándo se confirma o se cancela) está en pagoPrevio.ts; aquí solo las llamadas
 * a la API REST de la tienda (/wp-json/wc/v3) y la firma de sus avisos (webhooks).
 *
 * Configuración SOLO en el agenda.env del servidor (la carga «Integraciones (WooCommerce y GHL).bat»; nunca en el repo ni en el paquete):
 *   WOO_URL               https://… de la tienda
 *   WOO_CONSUMER_KEY      ck_…  (WooCommerce › Ajustes › Avanzado › API REST, lectura y escritura)
 *   WOO_CONSUMER_SECRET   cs_…
 *   WOO_WEBHOOK_SECRET    el «Secreto» del webhook «Pedido actualizado» (WooCommerce firma cada aviso con él)
 * Sin las tres primeras, el pago previo está apagado: todo se paga en la sede, como antes.
 */
import crypto from 'crypto';
import { AppError } from '../../middleware/errorHandler';
import { fechaDb } from '../../utils/fechaLima';

/** Minutos que tiene el paciente para pagar; después la cita se cancela sola. */
export const MINUTOS_PAGO = 10;

const url = () => (process.env.WOO_URL || '').trim().replace(/\/+$/, '');
const ck = () => (process.env.WOO_CONSUMER_KEY || '').trim();
const cs = () => (process.env.WOO_CONSUMER_SECRET || '').trim();
const secretoWebhook = () => (process.env.WOO_WEBHOOK_SECRET || '').trim();

export function wooConfigurado(): boolean {
  return !!(url() && ck() && cs());
}
/** Los avisos de pago solo se aceptan con la tienda conectada Y el secreto del webhook cargado. */
export function webhookWooConfigurado(): boolean {
  return wooConfigurado() && !!secretoWebhook();
}

/** Sábado o domingo. `fecha` = «AAAA-MM-DD» (día calendario de Lima). Feriados: todavía no. */
export function esFinDeSemana(fecha: string): boolean {
  const dia = fechaDb(fecha).getUTCDay();
  return dia === 0 || dia === 6;
}

/** ¿Esta reserva del chat se paga por adelantado? Fin de semana Y tienda conectada. */
export function requierePagoPrevio(fecha: string): boolean {
  return wooConfigurado() && esFinDeSemana(fecha);
}

/**
 * Firma de un aviso de WooCommerce: cabecera `X-WC-Webhook-Signature` = base64(HMAC-SHA256(cuerpo crudo, secreto del webhook)).
 * Se compara en tiempo constante. Sin secreto configurado, nada es válido.
 */
export function firmaWooValida(cuerpo: Buffer, firma: string | undefined, secreto = secretoWebhook()): boolean {
  if (!secreto || !firma) return false;
  const esperada = Buffer.from(crypto.createHmac('sha256', secreto).update(cuerpo).digest('base64'));
  const recibida = Buffer.from(firma.trim());
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

export interface PedidoWoo {
  id: number;
  estado: string; // pending | on-hold | processing | completed | cancelled | failed | refunded | …
  total: number;
  url: string; // enlace de pago (payment_url)
  codigo: string | null; // meta «agenda_codigo» = código LB-… de la reserva
  idTransaccion: string | null;
}

interface PedidoRaw {
  id: number; status: string; total: string; payment_url?: string; transaction_id?: string;
  meta_data?: { key: string; value: unknown }[];
}

const aPedido = (p: PedidoRaw): PedidoWoo => ({
  id: Number(p.id), estado: String(p.status ?? ''), total: Number(p.total), url: p.payment_url ?? '',
  codigo: (p.meta_data?.find((m) => m.key === 'agenda_codigo')?.value as string | undefined) ?? null,
  idTransaccion: p.transaction_id || null,
});

const NO_DISPONIBLE = () => new AppError('No pudimos preparar el pago en este momento. Intenta de nuevo o comunícate con un asesor.', 502, 'PAGO_NO_DISPONIBLE');

async function woo(metodo: 'GET' | 'POST' | 'PUT', ruta: string, cuerpo?: unknown): Promise<PedidoRaw> {
  if (!wooConfigurado()) throw new AppError('El pago en línea no está disponible por el momento', 503, 'PAGO_NO_CONFIGURADO');
  let r: Response;
  try {
    r = await fetch(`${url()}/wp-json/wc/v3/${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${ck()}:${cs()}`).toString('base64') },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    console.error(`[woo] ${metodo} ${ruta}: la tienda no respondió:`, (e as Error).message);
    throw NO_DISPONIBLE();
  }
  const j = await r.json().catch(() => ({})) as PedidoRaw & { message?: string };
  if (!r.ok) {
    console.error(`[woo] ${metodo} ${ruta} → HTTP ${r.status}: ${j.message ?? ''}`);
    throw NO_DISPONIBLE();
  }
  return j;
}

export interface NuevoPedido {
  codigo: string; monto: number; descripcion: string;
  nombres: string; apellidos: string; telefono: string; email?: string | null;
}

/** Crea el pedido «pendiente de pago» (sin método fijo: la página de pago de la tienda muestra Niubiz). */
export async function crearPedidoWoo(p: NuevoPedido): Promise<PedidoWoo> {
  const pedido = aPedido(await woo('POST', 'orders', {
    status: 'pending', currency: 'PEN', set_paid: false,
    billing: { first_name: p.nombres, last_name: p.apellidos, phone: p.telefono, ...(p.email ? { email: p.email } : {}) },
    fee_lines: [{ name: p.descripcion.slice(0, 190), total: p.monto.toFixed(2), tax_status: 'none' }],
    meta_data: [{ key: 'agenda_codigo', value: p.codigo }, { key: 'origen', value: 'agenda_whatsapp' }],
  }));
  if (!pedido.url) {
    console.error(`[woo] el pedido #${pedido.id} no devolvió enlace de pago`);
    await cancelarPedidoWoo(pedido.id).catch(() => undefined);
    throw NO_DISPONIBLE();
  }
  return pedido;
}

/** Estado REAL del pedido en la tienda: la fuente de verdad (nunca se confía solo en lo que trae un aviso). */
export async function leerPedidoWoo(id: number | string): Promise<PedidoWoo> {
  return aPedido(await woo('GET', `orders/${encodeURIComponent(String(id))}`));
}

/** Cancela un pedido que no se pagó (venció o la cita no se pudo crear). */
export async function cancelarPedidoWoo(id: number | string): Promise<void> {
  await woo('PUT', `orders/${encodeURIComponent(String(id))}`, { status: 'cancelled' });
}

/** Estados de un pedido ya PAGADO (Niubiz lo deja en «procesando» o «completado»). */
export const PEDIDO_PAGADO = new Set(['processing', 'completed']);
/** Estados de un pedido que ya no se va a pagar. */
export const PEDIDO_NO_PAGADO = new Set(['cancelled', 'failed', 'refunded', 'trash']);
