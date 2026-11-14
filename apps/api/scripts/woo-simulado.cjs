// WooCommerce SIMULADO (solo desarrollo): imita la API REST de pedidos y el aviso firmado para probar el pago previo del chat
// (sábado y domingo) sin tocar la tienda real.
//   node scripts/woo-simulado.cjs [puerto=4020]
// y arrancar el API con  WOO_URL=http://localhost:4020  WOO_CONSUMER_KEY=ck_prueba  WOO_CONSUMER_SECRET=cs_prueba
//                        WOO_WEBHOOK_SECRET=<el mismo de WOO_SIM_SECRETO>  (y opcional GHL_AVISO_WEBHOOK_URL=http://localhost:4020/_ghl)
// Variables del simulador: WOO_SIM_SECRETO (secreto con el que firma), WOO_SIM_AVISO (URL del aviso de la Agenda,
//   por defecto http://localhost:3002/api/v1/publico/pagos/woo).
//   POST /_pagar/:id[?total=]   marca el pedido como pagado («processing») y manda el aviso firmado a la Agenda
//   POST /_fallar/:id           pago rechazado («failed») + aviso
//   GET  /_estado               pedidos y avisos de GHL recibidos        POST /_reset  lo borra
const http = require('http');
const crypto = require('crypto');

const puerto = Number(process.argv[2]) || 4020;
const SECRETO = process.env.WOO_SIM_SECRETO || 'secreto-de-prueba-123456';
const AVISO = process.env.WOO_SIM_AVISO || 'http://localhost:3002/api/v1/publico/pagos/woo';
const estado = { pedidos: {}, ghl: [], avisos: [] };
let n = 500;

const leer = (req) => new Promise((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch { ok({}); } }); });
const json = (res, codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const autorizado = (req) => String(req.headers.authorization || '') === 'Basic ' + Buffer.from('ck_prueba:cs_prueba').toString('base64');

async function avisar(p) {
  const cuerpo = JSON.stringify(p);
  const firma = crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('base64');
  try {
    const r = await fetch(AVISO, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WC-Webhook-Topic': 'order.updated', 'X-WC-Webhook-Signature': firma }, body: cuerpo });
    const j = await r.json().catch(() => ({}));
    estado.avisos.push({ pedido: p.id, status: r.status, respuesta: j });
    return { status: r.status, respuesta: j };
  } catch (e) { return { error: e.message }; }
}

http.createServer(async (req, res) => {
  const [ruta, qs] = req.url.split('?');
  const q = new URLSearchParams(qs || '');
  if (ruta === '/_estado') return json(res, 200, estado);
  if (ruta === '/_reset') { estado.pedidos = {}; estado.ghl = []; estado.avisos = []; return json(res, 200, { ok: true }); }
  if (ruta === '/_ghl' && req.method === 'POST') { estado.ghl.push(await leer(req)); return json(res, 200, { ok: true }); }
  let m;
  if ((m = /^\/_(pagar|fallar)\/(\d+)$/.exec(ruta)) && req.method === 'POST') {
    const p = estado.pedidos[m[2]];
    if (!p) return json(res, 404, { message: 'no existe' });
    p.status = m[1] === 'pagar' ? 'processing' : 'failed';
    if (m[1] === 'pagar') { p.transaction_id = `SIM-${p.id}`; if (q.get('total')) p.total = Number(q.get('total')).toFixed(2); }
    return json(res, 200, await avisar(p));
  }

  if (!ruta.startsWith('/wp-json/wc/v3/orders')) return json(res, 404, { message: 'ruta' });
  if (!autorizado(req)) return json(res, 401, { code: 'woocommerce_rest_cannot_view', message: 'Clave inválida' });
  if (ruta === '/wp-json/wc/v3/orders' && req.method === 'GET') return json(res, 200, Object.values(estado.pedidos).slice(0, Number(q.get('per_page') || 10)));
  if (ruta === '/wp-json/wc/v3/orders' && req.method === 'POST') {
    const b = await leer(req);
    const id = ++n;
    const total = (b.fee_lines || []).reduce((a, f) => a + Number(f.total), 0).toFixed(2);
    estado.pedidos[id] = { id, status: b.status || 'pending', total, currency: b.currency, billing: b.billing, meta_data: b.meta_data || [], fee_lines: b.fee_lines, payment_url: `http://localhost:${puerto}/pagar/${id}` };
    return json(res, 201, estado.pedidos[id]);
  }
  if ((m = /^\/wp-json\/wc\/v3\/orders\/(\d+)$/.exec(ruta))) {
    const p = estado.pedidos[m[1]];
    if (!p) return json(res, 404, { code: 'woocommerce_rest_shop_order_invalid_id', message: 'ID no válido.' });
    if (req.method === 'PUT') Object.assign(p, await leer(req));
    return json(res, 200, p);
  }
  return json(res, 404, { message: 'ruta' });
}).listen(puerto, () => console.log(`WooCommerce simulado en http://localhost:${puerto} (aviso → ${AVISO})`));
