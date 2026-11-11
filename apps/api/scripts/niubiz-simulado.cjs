// Niubiz SIMULADO (solo desarrollo): imita las 4 llamadas del Botón de Pago para probar los casos difíciles sin tocar Niubiz.
//   node scripts/niubiz-simulado.cjs [puerto=4010]
// y arrancar el API con  NIUBIZ_URL_API=http://localhost:4010  (y NIUBIZ_HABILITADO=1, NIUBIZ_MERCHANT_ID, NIUBIZ_USUARIO, NIUBIZ_CLAVE).
// El resultado de la autorización lo decide el PREFIJO del transactionToken que llega al retorno:
//   OK…       aprobado               NO…       denegado (fondos insuficientes)      MONTO…  aprobado por OTRO monto (hay que anular)
//   TIMEOUT…  responde 504           SINREV…   aprobado, pero la anulación falla    ERROR…  401 (credenciales)
// GET /_estado muestra lo recibido (autorizaciones y anulaciones). POST /_reset lo borra.
const http = require('http');

const puerto = Number(process.argv[2]) || 4010;
const estado = { accesos: {}, autorizaciones: [], reversas: [], sesiones: 0 };
let n = 0;
const ahora = () => { const d = new Date(Date.now() - 5 * 3600_000); const p = (x) => String(x).padStart(2, '0'); return `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`; };

function leerCuerpo(req) {
  return new Promise((ok) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch { ok({}); } }); });
}
const json = (res, codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/_estado') return json(res, 200, estado);
  if (url === '/_reset') { estado.accesos = {}; estado.autorizaciones = []; estado.reversas = []; estado.sesiones = 0; return json(res, 200, { ok: true }); }

  if (url === '/api.security/v1/security' && req.method === 'GET') {
    if (!String(req.headers.authorization || '').startsWith('Basic ')) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized Access'); }
    const token = `ACCESO-${++n}-${Math.random().toString(36).slice(2)}`;
    estado.accesos[token] = { usado: false };
    res.writeHead(201, { 'Content-Type': 'text/plain' });
    return res.end(token);
  }

  const cuerpo = await leerCuerpo(req);
  const acceso = String(req.headers.authorization || '');
  if (!estado.accesos[acceso]) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized Access'); }

  if (url.startsWith('/api.ecommerce/v2/ecommerce/token/session/')) {
    if (estado.accesos[acceso].usado) return json(res, 400, { errorCode: 400, errorMessage: 'Token has been used before', data: {} });
    estado.accesos[acceso].usado = true;
    estado.sesiones++;
    return json(res, 200, { sessionKey: `SESION-${++n}-${Math.random().toString(36).slice(2)}`, expirationTime: Date.now() + 20 * 60_000, recibido: cuerpo.amount });
  }

  if (url.startsWith('/api.authorization/v3/authorization/ecommerce/')) {
    const o = cuerpo.order || {};
    const tk = String(o.tokenId || '');
    const registro = { purchaseNumber: o.purchaseNumber, amount: o.amount, tokenId: tk, countable: cuerpo.countable, resultado: '' };
    estado.autorizaciones.push(registro);
    if (tk.startsWith('ERROR')) { registro.resultado = '401'; res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Unauthorized Access'); }
    if (tk.startsWith('TIMEOUT')) { registro.resultado = '504'; await new Promise((r) => setTimeout(r, 1500)); res.writeHead(504, { 'Content-Type': 'text/plain' }); return res.end('Gateway Timeout'); }
    if (tk.startsWith('NO')) {
      registro.resultado = 'denegado';
      return json(res, 400, { errorCode: 400, errorMessage: 'Not Authorized', data: { ACTION_CODE: '116', ACTION_DESCRIPTION: 'Operacion denegada. Fondos insuficientes', STATUS: 'Not Authorized', CARD: '455170******8059' } });
    }
    const monto = tk.startsWith('MONTO') ? Number(o.amount) + 1 : Number(o.amount);
    const fecha = ahora();
    const trx = `9${String(++n).padStart(14, '0')}`;
    registro.resultado = 'aprobado'; registro.transactionDate = fecha; registro.transactionId = trx;
    return json(res, 200, {
      header: { ecoreTransactionUUID: `u-${n}`, ecoreTransactionDate: Date.now(), millis: 800 },
      fulfillment: { channel: 'web', merchantId: '456879852', captureType: 'manual', countable: cuerpo.countable, signature: `sig-${n}` },
      order: { tokenId: tk, purchaseNumber: String(o.purchaseNumber), amount: o.amount, currency: 'PEN', authorizedAmount: monto, authorizationCode: '455', actionCode: '000', traceNumber: '455', transactionDate: fecha, transactionId: trx },
      dataMap: { STATUS: 'Authorized', ACTION_CODE: '000', ACTION_DESCRIPTION: 'Aprobado y completado con exito', BRAND: 'visa', CARD: '455170******8059', AMOUNT: String(monto), TRANSACTION_ID: trx, TRANSACTION_DATE: fecha },
    });
  }

  if (url.startsWith('/api.authorization/v3/reverse/ecommerce/')) {
    const o = cuerpo.order || {};
    const aut = estado.autorizaciones.find((a) => String(a.purchaseNumber) === String(o.purchaseNumber) && a.transactionDate === o.transactionDate && a.resultado === 'aprobado');
    estado.reversas.push({ purchaseNumber: o.purchaseNumber, transactionDate: o.transactionDate, encontrada: !!aut, canal: cuerpo.channel });
    if (!aut || String(aut.tokenId).startsWith('SINREV')) { res.writeHead(500, { 'Content-Type': 'text/plain' }); return res.end('Internal Server Error'); }
    aut.resultado = 'anulado';
    return json(res, 200, { order: { actionCode: '400', transactionDate: ahora(), transactionId: aut.transactionId }, dataMap: { STATUS: 'Voided', ACTION_CODE: '400' } });
  }

  json(res, 404, { error: 'no existe en el simulado', url });
}).listen(puerto, () => console.log(`Niubiz simulado en http://localhost:${puerto}`));
