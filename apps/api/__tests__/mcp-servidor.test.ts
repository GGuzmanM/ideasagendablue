/**
 * Servidor MCP para Ana (17-nov-2026): protocolo (initialize, tools/list, tools/call), llave y canal, límites por herramienta y
 * buscar_cupo. Las funciones de la reserva están simuladas: aquí se comprueba qué se les pide y cómo vuelve la respuesta.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Llave simulada: la cabecera «x-llave» trae «id:scope».
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req: { header: (n: string) => string | undefined; apiKey?: unknown }, _res: unknown, next: () => void) => {
    const v = req.header('x-llave');
    if (v) { const i = v.indexOf(':'); req.apiKey = { id: v.slice(0, i), scopes: [v.slice(i + 1)] }; }
    next();
  },
}));
const mockServicio = {
  catalogo: jest.fn(), horasConCupos: jest.fn(), diasDisponibles: jest.fn(), reservar: jest.fn(), estadoReservaPorCodigo: jest.fn(),
};
jest.mock('../src/services/reservaWeb/reservaWebService', () => mockServicio);
const mockGestion = { citasProximas: jest.fn(), cancelarCompat: jest.fn(), reprogramarCompat: jest.fn() };
jest.mock('../src/services/reservaWeb/gestion', () => mockGestion);
const mockExtras = { infoSedes: jest.fn(), agregarNotaCita: jest.fn(), extenderPago: jest.fn() };
jest.mock('../src/services/reservaWeb/extrasChat', () => mockExtras);

import mcpRouter, { _reiniciarLimites, buscarCupo } from '../src/routes/mcp';
import { errorHandler, AppError } from '../src/middleware/errorHandler';

let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/mcp', mcpRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  jest.clearAllMocks();
  _reiniciarLimites();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

let idRpc = 0;
async function rpc(metodo: string, params: unknown = {}, llave: string | null = 'k1:reservas:whatsapp') {
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(llave ? { 'x-llave': llave } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++idRpc, method: metodo, params }),
  });
  return { status: r.status, cuerpo: await r.json().catch(() => null) as Record<string, any> | null };
}
const llamar = async (nombre: string, args: Record<string, unknown> = {}, llave?: string) => {
  const { cuerpo } = await rpc('tools/call', { name: nombre, arguments: args }, llave);
  const res = cuerpo!.result;
  // Los argumentos que no cumplen el esquema los rechaza el propio SDK con texto plano («MCP error -32602: …»).
  const texto = (t: string) => { try { return JSON.parse(t); } catch { return t; } };
  return { isError: !!res?.isError, datos: res ? texto(res.content[0].text) : cuerpo!.error };
};

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const enDias = (n: number) => { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';
const SV = '44444444-4444-4444-8444-444444444444';

describe('protocolo y llave', () => {
  it('initialize responde con el nombre del servidor', async () => {
    const { status, cuerpo } = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
    expect(status).toBe(200);
    expect(cuerpo!.result.serverInfo.name).toBe('limablue-agenda');
  });

  it('tools/list trae las 12 herramientas con su esquema', async () => {
    const { cuerpo } = await rpc('tools/list');
    const nombres = cuerpo!.result.tools.map((t: { name: string }) => t.name).sort();
    expect(nombres).toEqual([
      'agregar_nota_cita', 'buscar_cupo', 'cancelar_cita', 'consultar_catalogo', 'dias_disponibles', 'estado_reserva',
      'extender_pago', 'horas_del_dia', 'info_sede', 'mis_citas', 'reprogramar_cita', 'reservar_cita',
    ]);
    const reservarCita = cuerpo!.result.tools.find((t: { name: string }) => t.name === 'reservar_cita');
    expect(reservarCita.inputSchema.required).toEqual(expect.arrayContaining(['numeroDocumento', 'sedeId', 'servicioId', 'fecha', 'horaInicio', 'aceptaDatos']));
    expect(reservarCita.inputSchema.properties.canal).toBeUndefined(); // el canal lo fija la llave
  });

  it('sin llave → 401; llave sin permiso de reservas → 403', async () => {
    expect((await rpc('tools/list', {}, null)).status).toBe(401);
    expect((await rpc('tools/list', {}, 'k9:otra:cosa')).status).toBe(403);
  });

  it('GET y DELETE no se permiten (servidor sin sesión)', async () => {
    expect((await fetch(base, { headers: { 'x-llave': 'k1:reservas:whatsapp' } })).status).toBe(405);
    expect((await fetch(base, { method: 'DELETE', headers: { 'x-llave': 'k1:reservas:whatsapp' } })).status).toBe(405);
  });
});

describe('herramientas', () => {
  it('reservar_cita usa el canal de la LLAVE y no devuelve el token', async () => {
    mockServicio.reservar.mockResolvedValue({ codigo: 'LB-111111', token: 'secreto', estado: 'confirmada' });
    const args = {
      tipoDocumento: 'DNI', numeroDocumento: '75921504', nombres: 'Ana', apellidoPaterno: 'Prueba', telefono: '+51 987 654 321',
      sedeId: S1, servicioId: SV, fecha: enDias(2), horaInicio: '10:00', aceptaDatos: true, canal: 'web',
    };
    const r = await llamar('reservar_cita', args);
    expect(r.isError).toBe(false);
    expect(r.datos).toEqual({ codigo: 'LB-111111', estado: 'confirmada' });
    expect(mockServicio.reservar).toHaveBeenCalledWith(
      expect.objectContaining({ numeroDocumento: '75921504', telefono: '987654321' }),
      expect.objectContaining({ canal: 'whatsapp', conLlave: true }),
    );
    // Con la llave de la API web, el canal es «web».
    await llamar('reservar_cita', args, 'k2:reservas:write');
    expect(mockServicio.reservar.mock.calls[1][1].canal).toBe('web');
  });

  it('reservar_cita sin aceptaDatos no llega a reservar', async () => {
    const r = await llamar('reservar_cita', { numeroDocumento: '75921504', nombres: 'Ana', apellidoPaterno: 'P', telefono: '987654321', sedeId: S1, servicioId: SV, fecha: enDias(2), horaInicio: '10:00' });
    expect(r.isError).toBe(true);
    expect(String(r.datos)).toContain('aceptaDatos');
    expect(mockServicio.reservar).not.toHaveBeenCalled();
  });

  it('un error de la Agenda sale con isError y su código (Ana deriva)', async () => {
    mockGestion.cancelarCompat.mockRejectedValue(new AppError('La cita ya tiene un pago: lo resuelve un asesor.', 409, 'REQUIERE_ASESOR'));
    const r = await llamar('cancelar_cita', { codigo: 'C-000123', numeroDocumento: '75921504' });
    expect(r.isError).toBe(true);
    expect(r.datos).toEqual({ error: 'La cita ya tiene un pago: lo resuelve un asesor.', code: 'REQUIERE_ASESOR', status: 409 });
    expect(mockGestion.cancelarCompat).toHaveBeenCalledWith('C-000123', { tipoDocumento: null, numeroDocumento: '75921504' }, 'whatsapp', null, expect.any(Object));
  });

  it('reprogramar_cita y mis_citas pasan el documento normalizado', async () => {
    mockGestion.reprogramarCompat.mockResolvedValue({ codigo: 'LB-123456', repetida: false });
    mockGestion.citasProximas.mockResolvedValue([{ codigo: 'LB-123456' }]);
    expect((await llamar('reprogramar_cita', { codigo: 'LB-123456', numeroDocumento: ' 759-215-04 ', fecha: enDias(3), horaInicio: '11:00' })).isError).toBe(false);
    expect(mockGestion.reprogramarCompat).toHaveBeenCalledWith('LB-123456', { tipoDocumento: null, numeroDocumento: '75921504' }, 'whatsapp', enDias(3), '11:00', expect.any(Object));
    expect((await llamar('mis_citas', { numeroDocumento: '75921504' })).datos).toEqual({ citas: [{ codigo: 'LB-123456' }] });
  });

  it('documento inválido no busca', async () => {
    const r = await llamar('mis_citas', { numeroDocumento: '123' });
    expect(r.isError).toBe(true);
    expect(mockGestion.citasProximas).not.toHaveBeenCalled();
  });

  it('agregar_nota_cita, extender_pago e info_sede llaman a sus funciones', async () => {
    mockExtras.agregarNotaCita.mockResolvedValue({ codigo: 'C-000123', ok: true });
    mockExtras.extenderPago.mockResolvedValue({ codigo: 'LB-123456', estado: 'esperando_pago' });
    mockExtras.infoSedes.mockResolvedValue({ sedes: [] });
    expect((await llamar('agregar_nota_cita', { codigo: 'C-000123', numeroDocumento: '75921504', texto: 'Llegaré 10 minutos tarde' })).datos).toEqual({ codigo: 'C-000123', ok: true });
    expect(mockExtras.agregarNotaCita).toHaveBeenCalledWith('C-000123', { tipoDocumento: null, numeroDocumento: '75921504' }, 'Llegaré 10 minutos tarde', expect.any(Object));
    await llamar('extender_pago', { codigo: 'LB-123456', numeroDocumento: '75921504' });
    expect(mockExtras.extenderPago).toHaveBeenCalledWith('LB-123456', '75921504', 'whatsapp');
    expect((await llamar('info_sede')).datos).toEqual({ sedes: [] });
  });

  it('límites por llave: 20 búsquedas y 10 cambios por minuto', async () => {
    mockGestion.citasProximas.mockResolvedValue([]);
    for (let i = 0; i < 20; i++) expect((await llamar('mis_citas', { numeroDocumento: '75921504' })).isError).toBe(false);
    const r = await llamar('mis_citas', { numeroDocumento: '75921504' });
    expect(r.datos.code).toBe('DEMASIADOS_INTENTOS');
    // Otra llave tiene su propio contador.
    expect((await llamar('mis_citas', { numeroDocumento: '75921504' }, 'k3:reservas:whatsapp')).isError).toBe(false);

    mockGestion.cancelarCompat.mockResolvedValue({ repetida: true });
    for (let i = 0; i < 10; i++) await llamar('cancelar_cita', { codigo: 'C-1', numeroDocumento: '75921504' });
    expect((await llamar('cancelar_cita', { codigo: 'C-1', numeroDocumento: '75921504' })).datos.code).toBe('DEMASIADOS_INTENTOS');
  });
});

describe('buscar_cupo', () => {
  const catalogo = {
    sedes: [{ id: S1, nombre: 'ONE' }, { id: S2, nombre: 'Lince' }, { id: S3, nombre: 'Surco' }],
    servicios: [{ id: SV, nombre: 'Profilaxis', sedes: [S2, S1, S3], variantes: [{ id: null, nombre: 'Profilaxis', precio: 80, precios: { [S1]: 90, [S2]: 87, [S3]: 80 } }] }],
  };
  beforeEach(() => mockServicio.catalogo.mockResolvedValue(catalogo));

  it('lista todas las sedes, la preferida primero, y marca la sin cupo con horas vacías', async () => {
    mockServicio.horasConCupos.mockImplementation(async (sede: string) => (sede === S2 ? [{ hora: '09:00', cupos: 1 }, { hora: '10:30', cupos: 2 }] : []));
    const r = await buscarCupo({ servicioId: SV, fecha: enDias(4), sedeId: S1 });
    expect(r.sedes.map((s) => s.sede)).toEqual(['ONE', 'Lince', 'Surco']);
    expect(r.sedes[0]).toMatchObject({ sede: 'ONE', preferida: true, horas: [], precio: 90 });
    expect(r.sedes[1]).toMatchObject({ sede: 'Lince', horas: ['09:00', '10:30'], cupos: { '09:00': 1, '10:30': 2 }, precio: 87 });
    expect(r.hayCupo).toBe(true);
    expect(r.diaCercano).toBeNull();
    expect(mockServicio.diasDisponibles).not.toHaveBeenCalled();
  });

  it('sin cupo en ninguna sede → diaCercano (el más próximo de todas)', async () => {
    mockServicio.horasConCupos.mockImplementation(async (sede: string, _sv: string, f: string) => (f === enDias(6) && sede === S3 ? [{ hora: '15:00', cupos: 1 }] : []));
    mockServicio.diasDisponibles.mockImplementation(async (sede: string) => (sede === S3 ? [{ fecha: enDias(6), horas: 1 }] : sede === S2 ? [{ fecha: enDias(8), horas: 3 }] : []));
    const r = await buscarCupo({ servicioId: SV, fecha: enDias(4) });
    expect(r.hayCupo).toBe(false);
    expect(r.diaCercano).toEqual({ fecha: enDias(6), sedeId: S3, sede: 'Surco', horas: ['15:00'] });
    expect(mockServicio.diasDisponibles).toHaveBeenCalledWith(S2, SV, enDias(5), enDias(18));
  });

  it('fecha pasada → error para Ana; servicio que no se reserva en línea → SERVICIO_NO_RESERVABLE', async () => {
    mockServicio.horasConCupos.mockRejectedValue(new AppError('Esa fecha ya pasó', 400, 'FECHA_PASADA'));
    await expect(buscarCupo({ servicioId: SV, fecha: enDias(-1) })).rejects.toMatchObject({ code: 'FECHA_PASADA' });
    await expect(buscarCupo({ servicioId: S1, fecha: enDias(2) })).rejects.toMatchObject({ code: 'SERVICIO_NO_RESERVABLE' });
  });

  it('como herramienta MCP devuelve el mismo resultado', async () => {
    mockServicio.horasConCupos.mockResolvedValue([{ hora: '09:00', cupos: 1 }]);
    const r = await llamar('buscar_cupo', { servicioId: SV, fecha: enDias(4), sedeId: S2 });
    expect(r.isError).toBe(false);
    expect(r.datos.sedes[0].sede).toBe('Lince');
  });
});
