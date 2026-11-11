/**
 * NIUBIZ — Botón de Pago Web (10-nov-2026). Cliente de las cuatro llamadas del flujo, todas de servidor a servidor
 * (las credenciales nunca llegan al navegador):
 *
 *   1. API de Seguridad   GET  /api.security/v1/security                         → token de acceso (texto, 60 min, un solo uso por sesión)
 *   2. Token de sesión    POST /api.ecommerce/v2/ecommerce/token/session/{comercio} → sessionKey (un solo uso)
 *   3. (en el navegador)  checkout.js con el sessionKey; Niubiz devuelve un `transactionToken` a nuestra URL de retorno
 *   4. Autorización       POST /api.authorization/v3/authorization/ecommerce/{comercio}  ← AQUÍ se cobra
 *      Reversa (anulación) POST /api.authorization/v3/reverse/ecommerce/{comercio}
 *
 * Niubiz corta todo el flujo a los 60 s (HTTP 504). Un pedido (`purchaseNumber`) es único por intento de autorización.
 * Apagado por defecto: NIUBIZ_HABILITADO=1. Entorno de pruebas (sandbox) o producción: NIUBIZ_ENTORNO.
 * Las credenciales viven SOLO en agenda.env (NIUBIZ_USUARIO / NIUBIZ_CLAVE), nunca en el repositorio.
 * NIUBIZ_URL_API permite apuntar a un Niubiz simulado (scripts/niubiz-simulado.cjs) para probar los casos difíciles.
 */
import { AppError } from '../../middleware/errorHandler';

export type EntornoNiubiz = 'sandbox' | 'produccion';

export interface ConfigNiubiz {
  entorno: EntornoNiubiz;
  merchantId: string;
  usuario: string;
  clave: string;
  /** true = liquidación automática (`countable: true`); false = manual (exige además la API de Confirmación). */
  liquidacionAutomatica: boolean;
  urlApi: string;
  checkoutJs: string;
}

const SI = (v: string | undefined) => ['1', 'true'].includes((v || '').trim().toLowerCase());

export function niubizHabilitado(): boolean {
  return SI(process.env.NIUBIZ_HABILITADO);
}

/** `opcional`: el paciente elige entre pagar ahora o en la sede. `obligatorio`: la reserva web exige el pago en línea. */
export function modoPago(): 'opcional' | 'obligatorio' {
  return (process.env.RESERVA_WEB_PAGO || '').trim().toLowerCase() === 'obligatorio' ? 'obligatorio' : 'opcional';
}

export function configNiubiz(): ConfigNiubiz {
  const entorno: EntornoNiubiz = (process.env.NIUBIZ_ENTORNO || 'sandbox').trim().toLowerCase() === 'produccion' ? 'produccion' : 'sandbox';
  const merchantId = (process.env.NIUBIZ_MERCHANT_ID || '').trim();
  const usuario = (process.env.NIUBIZ_USUARIO || '').trim();
  const clave = process.env.NIUBIZ_CLAVE || '';
  if (!merchantId || !usuario || !clave) throw new AppError('El pago en línea no está configurado', 503, 'PAGO_NO_CONFIGURADO');
  return {
    entorno, merchantId, usuario, clave,
    liquidacionAutomatica: (process.env.NIUBIZ_LIQUIDACION || 'automatica').trim().toLowerCase() !== 'manual',
    urlApi: (process.env.NIUBIZ_URL_API || (entorno === 'produccion' ? 'https://apiprod.vnforapps.com' : 'https://apisandbox.vnforappstest.com')).replace(/\/$/, ''),
    checkoutJs: process.env.NIUBIZ_CHECKOUT_JS
      || (entorno === 'produccion' ? 'https://static-content.vnforapps.com/v2/js/checkout.js' : 'https://static-content-qas.vnforapps.com/env/sandbox/js/checkout.js'),
  };
}

/**
 * Error de una llamada a Niubiz. `tipo` dice qué se sabe del cobro:
 *  - `rechazo`:  la llamada no llegó a procesarse (credenciales, token vencido…): NO se cobró nada.
 *  - `denegado`: el banco no autorizó el pago: NO se cobró nada.
 *  - `incierto`: se perdió la respuesta (60 s, red, 5xx): puede que SÍ se haya cobrado; hay que verificarlo.
 */
export class NiubizError extends Error {
  constructor(
    mensaje: string,
    public readonly tipo: 'rechazo' | 'denegado' | 'incierto',
    public readonly detalle: { http?: number; codigoAccion?: string; descripcion?: string; estado?: string } = {},
  ) {
    super(mensaje);
    this.name = 'NiubizError';
  }
}

const TIEMPO_MAX_MS = 70_000; // Niubiz corta a los 60 s: se espera su 504 antes de rendirse

interface Respuesta { status: number; texto: string; json: Record<string, any> | null }

async function llamar(cfg: ConfigNiubiz, metodo: 'GET' | 'POST', ruta: string, headers: Record<string, string>, cuerpo?: unknown): Promise<Respuesta> {
  let r: Response;
  try {
    r = await fetch(cfg.urlApi + ruta, {
      method: metodo,
      headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(TIEMPO_MAX_MS),
    });
  } catch {
    // Sin respuesta (red, tiempo agotado): no se sabe si Niubiz llegó a procesar el pedido.
    throw new NiubizError('Niubiz no respondió', 'incierto');
  }
  const texto = await r.text();
  let json: Record<string, any> | null = null;
  try { json = JSON.parse(texto); } catch { /* respuesta de texto plano (token de acceso, "Unauthorized Access"…) */ }
  return { status: r.status, texto, json };
}

/** 1. Token de acceso. Cada sesión necesita el suyo: Niubiz responde «Token has been used before» si se reutiliza. */
export async function tokenAcceso(cfg: ConfigNiubiz): Promise<string> {
  const basic = Buffer.from(`${cfg.usuario}:${cfg.clave}`).toString('base64');
  const r = await llamar(cfg, 'GET', '/api.security/v1/security', { Authorization: `Basic ${basic}` });
  const token = r.texto.trim();
  if ((r.status !== 200 && r.status !== 201) || !token || token.startsWith('{')) {
    throw new NiubizError(`Niubiz rechazó las credenciales (HTTP ${r.status})`, 'rechazo', { http: r.status });
  }
  return token;
}

export interface DatosSesion {
  monto: number;
  ip: string;
  email: string;
  documento: string;
  telefono: string;
}

/** IP del cliente en el formato que pide Niubiz (IPv4 en texto). */
export function ipParaNiubiz(ip?: string | null): string {
  const v = (ip || '').replace(/^::ffff:/, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : '127.0.0.1';
}

/** 2. Token de sesión: lo usa el botón de pago en el navegador. */
export async function tokenSesion(cfg: ConfigNiubiz, acceso: string, d: DatosSesion): Promise<{ sessionKey: string; expirationTime: number }> {
  const r = await llamar(cfg, 'POST', `/api.ecommerce/v2/ecommerce/token/session/${cfg.merchantId}`, { Authorization: acceso }, {
    channel: 'web',
    amount: Number(d.monto.toFixed(2)),
    antifraud: {
      clientIp: ipParaNiubiz(d.ip),
      // Datos antifraude (MDD) acordados con Niubiz. La lista oficial del comercio llega con la afiliación: ajustar aquí.
      merchantDefineData: { MDD4: d.email, MDD32: d.documento, MDD75: 'Invitado', MDD77: '0' },
    },
    dataMap: { cardholderCountry: 'PE', cardholderCity: 'Lima', cardholderPhoneNumber: d.telefono },
  });
  const sessionKey = r.json?.sessionKey;
  if (r.status !== 200 || typeof sessionKey !== 'string') {
    throw new NiubizError(`Niubiz no entregó el token de sesión (HTTP ${r.status}): ${r.json?.errorMessage ?? r.texto.slice(0, 120)}`, r.status >= 500 ? 'incierto' : 'rechazo', { http: r.status });
  }
  return { sessionKey, expirationTime: Number(r.json?.expirationTime) || 0 };
}

export interface Autorizacion {
  transaccionId: string;
  /** yyMMddHHmmss: se necesita para anular el cobro. */
  fechaTransaccion: string;
  codigoAutorizacion: string;
  montoAutorizado: number;
  marca?: string;
  tarjeta?: string;
  firma?: string;
}

/** 4. Autorización: aquí se cobra. Lanza NiubizError `denegado` (no se cobró) o `incierto` (puede haberse cobrado). */
export async function autorizar(cfg: ConfigNiubiz, acceso: string, d: { tokenId: string; numeroCompra: string; monto: number }): Promise<Autorizacion> {
  const r = await llamar(cfg, 'POST', `/api.authorization/v3/authorization/ecommerce/${cfg.merchantId}`, { Authorization: acceso }, {
    channel: 'web',
    captureType: 'manual',
    countable: cfg.liquidacionAutomatica,
    order: { tokenId: d.tokenId, purchaseNumber: d.numeroCompra, amount: Number(d.monto.toFixed(2)), currency: 'PEN' },
  });
  if (r.status === 200 && r.json?.order?.actionCode === '000') {
    const o = r.json.order, m = r.json.dataMap ?? {};
    if (m.STATUS && m.STATUS !== 'Authorized') throw new NiubizError('Niubiz no autorizó el pago', 'denegado', { codigoAccion: o.actionCode, descripcion: m.ACTION_DESCRIPTION, estado: m.STATUS });
    return {
      transaccionId: String(o.transactionId ?? m.TRANSACTION_ID ?? ''),
      fechaTransaccion: String(o.transactionDate ?? m.TRANSACTION_DATE ?? ''),
      codigoAutorizacion: String(o.authorizationCode ?? m.AUTHORIZATION_CODE ?? ''),
      montoAutorizado: Number(o.authorizedAmount ?? m.AMOUNT ?? NaN),
      marca: m.BRAND, tarjeta: m.CARD, firma: r.json.fulfillment?.signature ?? m.SIGNATURE,
    };
  }
  if (r.status === 400 || (r.status === 200 && r.json)) {
    const m = r.json?.data ?? r.json?.dataMap ?? {};
    throw new NiubizError('El banco no autorizó el pago', 'denegado', { http: r.status, codigoAccion: String(m.ACTION_CODE ?? r.json?.order?.actionCode ?? ''), descripcion: m.ACTION_DESCRIPTION, estado: m.STATUS });
  }
  if (r.status === 401 || r.status === 403 || r.status === 406) throw new NiubizError(`Niubiz rechazó la autorización (HTTP ${r.status})`, 'rechazo', { http: r.status });
  throw new NiubizError(`Niubiz respondió HTTP ${r.status} sin un resultado claro`, 'incierto', { http: r.status });
}

/** Anula (extorna) un cobro ya autorizado. Devuelve true si Niubiz confirma la anulación. */
export async function reversar(cfg: ConfigNiubiz, acceso: string, d: { numeroCompra: string; fechaTransaccion: string }): Promise<boolean> {
  const r = await llamar(cfg, 'POST', `/api.authorization/v3/reverse/ecommerce/${cfg.merchantId}`, { Authorization: acceso }, {
    channel: process.env.NIUBIZ_CANAL_REVERSA || 'web',
    order: { purchaseNumber: d.numeroCompra, transactionDate: d.fechaTransaccion },
  });
  return r.status === 200 && (r.json?.order?.actionCode === '400' || r.json?.dataMap?.STATUS === 'Voided');
}
