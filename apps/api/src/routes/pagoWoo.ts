/**
 * AVISO DE PAGO DE WOOCOMMERCE (13-nov-2026) — POST /api/v1/publico/pagos/woo   (pago previo del chat, services/reservaWeb/pagoPrevio.ts)
 *
 * En la tienda: WooCommerce › Ajustes › Avanzado › Webhooks › «Pedido actualizado», versión API v3,
 *   URL de entrega  https://<dominio de la Agenda>/api/v1/publico/pagos/woo   (SIN secretos en la URL)
 *   Secreto         el mismo valor de WOO_WEBHOOK_SECRET (lo carga «Integraciones (WooCommerce y GHL).bat»)
 *
 * WooCommerce firma cada aviso (cabecera X-WC-Webhook-Signature = HMAC-SHA256 del cuerpo con ese secreto, en base64): sin la
 * firma correcta se responde 401 y no se hace nada. Aun con firma válida, el aviso solo dice «mira este pedido»: la Agenda relee
 * el pedido en la tienda con su llave y recién ahí confirma. Se monta ANTES de express.json() porque la firma va sobre el cuerpo CRUDO.
 * Con la firma correcta siempre responde 200 (WooCommerce desactiva el webhook tras varios errores seguidos).
 */
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../middleware/errorHandler';
import { firmaWooValida, webhookWooConfigurado } from '../services/reservaWeb/woocommerce';
import { procesarPagoWoo } from '../services/reservaWeb/pagoPrevio';

const router = Router();

const limite = rateLimit({
  windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ error: 'DEMASIADOS_INTENTOS', statusCode: 429 }); },
});

router.post('/woo', limite, express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!webhookWooConfigurado()) throw new AppError('No encontrado', 404, 'NOT_FOUND');
  const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

  // Al guardar el webhook, WooCommerce manda una prueba SIN firma («webhook_id=123»): se responde 200 y no se hace nada.
  if (!req.header('x-wc-webhook-signature') && /^webhook_id=\d+$/.test(cuerpo.toString('utf8').trim())) { res.json({ ok: true }); return; }

  if (!firmaWooValida(cuerpo, req.header('x-wc-webhook-signature'))) {
    console.warn(`[pago-woo] aviso con firma inválida desde ${req.ip}`);
    throw new AppError('Firma inválida', 401, 'FIRMA_INVALIDA');
  }
  let id: unknown;
  try { id = (JSON.parse(cuerpo.toString('utf8')) as { id?: unknown }).id; } catch { /* cuerpo no JSON */ }
  if ((typeof id !== 'number' && typeof id !== 'string') || !/^\d{1,12}$/.test(String(id))) { res.json({ ok: true }); return; }
  try {
    const resultado = await procesarPagoWoo(String(id));
    if (resultado !== 'sin_reserva') console.log(`[pago-woo] pedido #${id}: ${resultado}`);
    res.json({ ok: true, resultado });
  } catch (e) {
    // La tienda no respondió al releer: el vencimiento vuelve a revisar el pedido; no se devuelve error a WooCommerce.
    console.error(`[pago-woo] pedido #${id}:`, (e as Error).message);
    res.json({ ok: true, resultado: 'pendiente_de_revisar' });
  }
});

export default router;
