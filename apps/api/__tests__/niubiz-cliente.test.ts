/**
 * Cliente de Niubiz (10-nov-2026): las cuatro llamadas contra un servidor HTTP falso. Lo que importa es qué se concluye
 * de cada respuesta: «no se cobró» (rechazo / denegado) frente a «quizá se cobró» (incierto).
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { autorizar, reversar, tokenAcceso, tokenSesion, configNiubiz, ipParaNiubiz, NiubizError, type ConfigNiubiz } from '../src/services/reservaWeb/niubiz';

let servidor: http.Server;
let cfg: ConfigNiubiz;
let responder: (req: http.IncomingMessage, cuerpo: any, res: http.ServerResponse) => void;
let recibidos: { url: string; auth?: string; cuerpo: any }[] = [];

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let t = '';
    req.on('data', (c) => (t += c));
    req.on('end', () => {
      let cuerpo: any = {};
      try { cuerpo = JSON.parse(t || '{}'); } catch { /* sin cuerpo */ }
      recibidos.push({ url: req.url || '', auth: req.headers.authorization, cuerpo });
      responder(req, cuerpo, res);
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, ok));
  cfg = {
    entorno: 'sandbox', merchantId: '999', usuario: 'u', clave: 'c', liquidacionAutomatica: true,
    urlApi: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`, checkoutJs: 'x',
  };
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));
beforeEach(() => { recibidos = []; });

const json = (res: http.ServerResponse, st: number, o: unknown) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const texto = (res: http.ServerResponse, st: number, t: string) => { res.writeHead(st, { 'Content-Type': 'text/plain' }); res.end(t); };

const aprobado = (monto: number) => ({
  fulfillment: { signature: 'firma' },
  order: { actionCode: '000', authorizedAmount: monto, authorizationCode: '455', transactionDate: '261110101010', transactionId: '900000000000001' },
  dataMap: { STATUS: 'Authorized', BRAND: 'visa', CARD: '455170******8059' },
});

describe('configuración', () => {
  const guardado = { ...process.env };
  afterEach(() => { process.env = { ...guardado }; });

  it('sin credenciales no arranca el pago (503)', () => {
    delete process.env.NIUBIZ_MERCHANT_ID; delete process.env.NIUBIZ_USUARIO; delete process.env.NIUBIZ_CLAVE;
    expect(() => configNiubiz()).toThrow(expect.objectContaining({ statusCode: 503, code: 'PAGO_NO_CONFIGURADO' }));
  });

  it('sandbox por defecto, liquidación automática salvo que se pida manual', () => {
    Object.assign(process.env, { NIUBIZ_MERCHANT_ID: '1', NIUBIZ_USUARIO: 'u', NIUBIZ_CLAVE: 'c' });
    delete process.env.NIUBIZ_ENTORNO; delete process.env.NIUBIZ_LIQUIDACION; delete process.env.NIUBIZ_URL_API;
    const c = configNiubiz();
    expect(c.entorno).toBe('sandbox');
    expect(c.urlApi).toContain('vnforappstest');
    expect(c.liquidacionAutomatica).toBe(true);
    process.env.NIUBIZ_LIQUIDACION = 'manual';
    expect(configNiubiz().liquidacionAutomatica).toBe(false);
    process.env.NIUBIZ_ENTORNO = 'produccion';
    expect(configNiubiz().urlApi).toContain('apiprod');
  });

  it('IP al formato de Niubiz (IPv4 en texto)', () => {
    expect(ipParaNiubiz('::ffff:10.0.0.5')).toBe('10.0.0.5');
    expect(ipParaNiubiz('2800:200::1')).toBe('127.0.0.1');
    expect(ipParaNiubiz(undefined)).toBe('127.0.0.1');
  });
});

describe('token de acceso', () => {
  it('envía Basic usuario:clave y devuelve el texto', async () => {
    responder = (_r, _c, res) => texto(res, 201, 'TOKEN-ABC');
    expect(await tokenAcceso(cfg)).toBe('TOKEN-ABC');
    expect(recibidos[0].auth).toBe(`Basic ${Buffer.from('u:c').toString('base64')}`);
  });

  it('credenciales malas → rechazo (no se cobró nada)', async () => {
    responder = (_r, _c, res) => texto(res, 401, 'Unauthorized Access');
    await expect(tokenAcceso(cfg)).rejects.toMatchObject({ tipo: 'rechazo' });
  });
});

describe('token de sesión', () => {
  it('manda el monto con dos decimales y los datos antifraude', async () => {
    responder = (_r, _c, res) => json(res, 200, { sessionKey: 'SK', expirationTime: 123 });
    const s = await tokenSesion(cfg, 'ACC', { monto: 80, ip: '::ffff:1.2.3.4', email: 'a@b.pe', documento: '12345678', telefono: '999' });
    expect(s).toEqual({ sessionKey: 'SK', expirationTime: 123 });
    expect(recibidos[0].url).toBe('/api.ecommerce/v2/ecommerce/token/session/999');
    expect(recibidos[0].auth).toBe('ACC');
    expect(recibidos[0].cuerpo).toMatchObject({ channel: 'web', amount: 80, antifraud: { clientIp: '1.2.3.4', merchantDefineData: { MDD4: 'a@b.pe', MDD32: '12345678' } } });
  });

  it('token ya usado → rechazo', async () => {
    responder = (_r, _c, res) => json(res, 400, { errorCode: 400, errorMessage: 'Token has been used before' });
    await expect(tokenSesion(cfg, 'ACC', { monto: 1, ip: '', email: '', documento: '1', telefono: '1' })).rejects.toMatchObject({ tipo: 'rechazo' });
  });
});

describe('autorización (aquí se cobra)', () => {
  const pedido = { tokenId: 'TK', numeroCompra: '1000001', monto: 80 };

  it('aprobada: devuelve transacción, fecha y monto autorizado', async () => {
    responder = (_r, _c, res) => json(res, 200, aprobado(80));
    const a = await autorizar(cfg, 'ACC', pedido);
    expect(a).toMatchObject({ transaccionId: '900000000000001', fechaTransaccion: '261110101010', montoAutorizado: 80, marca: 'visa' });
    expect(recibidos[0].cuerpo).toMatchObject({ countable: true, order: { tokenId: 'TK', purchaseNumber: '1000001', amount: 80, currency: 'PEN' } });
  });

  it('liquidación manual → countable:false', async () => {
    responder = (_r, _c, res) => json(res, 200, aprobado(80));
    await autorizar({ ...cfg, liquidacionAutomatica: false }, 'ACC', pedido);
    expect(recibidos[0].cuerpo.countable).toBe(false);
  });

  it('400 del banco → denegado con el motivo (no se cobró)', async () => {
    responder = (_r, _c, res) => json(res, 400, { errorCode: 400, data: { ACTION_CODE: '116', ACTION_DESCRIPTION: 'Fondos insuficientes', STATUS: 'Not Authorized' } });
    const e = await autorizar(cfg, 'ACC', pedido).catch((x) => x);
    expect(e).toBeInstanceOf(NiubizError);
    expect(e).toMatchObject({ tipo: 'denegado', detalle: { codigoAccion: '116', descripcion: 'Fondos insuficientes' } });
  });

  it('401 → rechazo (credenciales); 504 → incierto (puede haberse cobrado)', async () => {
    responder = (_r, _c, res) => texto(res, 401, 'Unauthorized Access');
    await expect(autorizar(cfg, 'ACC', pedido)).rejects.toMatchObject({ tipo: 'rechazo' });
    responder = (_r, _c, res) => texto(res, 504, 'Gateway Timeout');
    await expect(autorizar(cfg, 'ACC', pedido)).rejects.toMatchObject({ tipo: 'incierto' });
    responder = (_r, _c, res) => texto(res, 500, 'boom');
    await expect(autorizar(cfg, 'ACC', pedido)).rejects.toMatchObject({ tipo: 'incierto' });
  });

  it('sin conexión → incierto', async () => {
    await expect(autorizar({ ...cfg, urlApi: 'http://127.0.0.1:1' }, 'ACC', pedido)).rejects.toMatchObject({ tipo: 'incierto' });
  });
});

describe('anulación', () => {
  const d = { numeroCompra: '1000001', fechaTransaccion: '261110101010' };

  it('manda pedido y fecha; true si Niubiz confirma', async () => {
    responder = (_r, _c, res) => json(res, 200, { order: { actionCode: '400' }, dataMap: { STATUS: 'Voided' } });
    expect(await reversar(cfg, 'ACC', d)).toBe(true);
    expect(recibidos[0].url).toBe('/api.authorization/v3/reverse/ecommerce/999');
    expect(recibidos[0].cuerpo).toMatchObject({ order: { purchaseNumber: '1000001', transactionDate: '261110101010' } });
  });

  it('error de Niubiz → false (no se puede dar por anulado)', async () => {
    responder = (_r, _c, res) => texto(res, 500, 'Internal Server Error');
    expect(await reversar(cfg, 'ACC', d)).toBe(false);
  });
});
