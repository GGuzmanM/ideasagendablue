/**
 * Retorno del pago en línea (10-nov-2026): qué pasa con la reserva y con la plata en cada caso difícil.
 * Niubiz y la creación de la cita están simulados; lo que se comprueba es la decisión (estado final, anular o no anular).
 */
const reservaBase = {
  id: 'r1', codigo: 'RW-1', tokenConsulta: 'tok', pasarela: 'niubiz', estado: 'esperando_pago', pagoReferencia: '1000001',
  monto: 80, expiraEn: new Date(Date.now() + 5 * 60_000), pagoDetalle: { retornoUrl: 'http://x/reserva/' },
  tipoDocumento: 'DNI', numeroDocumento: '12345678', nombres: 'A', apellidoPaterno: 'B', apellidoMaterno: null, telefono: '999', email: 'a@b.pe',
  sedeId: 's1', unidadNegocioId: 'u1', servicioId: 'sv1', subcategoriaId: 'sub1', fecha: new Date('2026-11-12T00:00:00Z'), horaInicio: '10:00',
};

const mockPrisma = {
  reservaWeb: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
};
jest.mock('../src/db', () => ({ prisma: mockPrisma }));
jest.mock('../src/services/audit', () => ({ registrarAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/reservaWeb/intentos', () => ({ intentoConToken: jest.fn(), enlazarReserva: jest.fn() }));

const mockServicio = {
  servicioReservable: jest.fn(), horasLibres: jest.fn(), nuevoCodigo: jest.fn(), pacienteDeReserva: jest.fn(),
  crearCitaEnAgenda: jest.fn(), limpiarCacheDias: jest.fn(),
};
jest.mock('../src/services/reservaWeb/reservaWebService', () => mockServicio);

const mockNiubiz = { tokenAcceso: jest.fn(), autorizar: jest.fn(), reversar: jest.fn(), tokenSesion: jest.fn() };
jest.mock('../src/services/reservaWeb/niubiz', () => {
  const real = jest.requireActual('../src/services/reservaWeb/niubiz');
  return { ...real, ...mockNiubiz, configNiubiz: () => ({ entorno: 'sandbox', merchantId: '1', usuario: 'u', clave: 'c', liquidacionAutomatica: true, urlApi: 'x', checkoutJs: 'x' }), niubizHabilitado: () => true };
});

import { procesarRetorno } from '../src/services/reservaWeb/pago';
import { NiubizError } from '../src/services/reservaWeb/niubiz';

const aut = (monto = 80) => ({ transaccionId: 'T1', fechaTransaccion: '261110101010', codigoAutorizacion: '455', montoAutorizado: monto, marca: 'visa', tarjeta: '4551', firma: 'f' });
const form = { transactionToken: 'TK-1', channel: 'web' };
const ultimaActualizacion = () => mockPrisma.reservaWeb.update.mock.calls.at(-1)?.[0]?.data;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockPrisma.reservaWeb.findUnique.mockResolvedValue({ ...reservaBase });
  mockPrisma.reservaWeb.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.reservaWeb.update.mockResolvedValue({});
  mockNiubiz.tokenAcceso.mockResolvedValue('ACC');
  mockNiubiz.autorizar.mockResolvedValue(aut());
  mockNiubiz.reversar.mockResolvedValue(true);
  mockServicio.pacienteDeReserva.mockResolvedValue('p1');
  mockServicio.crearCitaEnAgenda.mockResolvedValue('c1');
});

describe('retorno del pago', () => {
  it('aprobado: crea la cita pagada y confirma', async () => {
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('ok');
    expect(mockServicio.crearCitaEnAgenda).toHaveBeenCalledWith(expect.objectContaining({ pago: { transaccionId: 'T1' }, monto: 80 }), expect.anything(), 'web');
    expect(ultimaActualizacion()).toMatchObject({ estado: 'confirmada', pagoEstado: 'aprobado', citaId: 'c1', pacienteId: 'p1' });
    expect(mockNiubiz.reversar).not.toHaveBeenCalled();
  });

  it('reserva inexistente o de otra pasarela → error, sin cobrar', async () => {
    mockPrisma.reservaWeb.findUnique.mockResolvedValue(null);
    expect((await procesarRetorno('NO', form)).destino).toBe('error');
    mockPrisma.reservaWeb.findUnique.mockResolvedValue({ ...reservaBase, pasarela: null });
    expect((await procesarRetorno('RW-1', form)).destino).toBe('error');
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('refrescar el retorno de una reserva ya confirmada no vuelve a cobrar', async () => {
    mockPrisma.reservaWeb.findUnique.mockResolvedValue({ ...reservaBase, estado: 'confirmada' });
    expect((await procesarRetorno('RW-1', form)).destino).toBe('ok');
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('dos retornos a la vez: solo el que reclama la reserva autoriza', async () => {
    mockPrisma.reservaWeb.updateMany.mockResolvedValue({ count: 0 });
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('incierto');
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('reserva «autorizando» o «reembolsar» → en revisión, sin autorizar de nuevo', async () => {
    for (const estado of ['autorizando', 'reembolsar']) {
      mockPrisma.reservaWeb.findUnique.mockResolvedValue({ ...reservaBase, estado });
      expect((await procesarRetorno('RW-1', form)).destino).toBe('incierto');
    }
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('el apartado venció (más de 1 min de gracia): expira y no cobra', async () => {
    mockPrisma.reservaWeb.findUnique.mockResolvedValue({ ...reservaBase, expiraEn: new Date(Date.now() - 120_000) });
    expect((await procesarRetorno('RW-1', form)).destino).toBe('expirada');
    expect(mockPrisma.reservaWeb.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { estado: 'expirada' } }));
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('PagoEfectivo no se acepta: falla sin cobrar', async () => {
    const r = await procesarRetorno('RW-1', { ...form, channel: 'pagoefectivo' });
    expect(r.destino).toBe('medio_no_soportado');
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('sin transactionToken → error, sin cobrar', async () => {
    expect((await procesarRetorno('RW-1', { channel: 'web' })).destino).toBe('error');
    expect(mockNiubiz.autorizar).not.toHaveBeenCalled();
  });

  it('denegado por el banco: reserva fallida con el motivo, sin cita', async () => {
    mockNiubiz.autorizar.mockRejectedValue(new NiubizError('x', 'denegado', { codigoAccion: '116', descripcion: 'Fondos insuficientes' }));
    const r = await procesarRetorno('RW-1', form);
    expect(r).toMatchObject({ destino: 'denegado', motivo: 'Fondos insuficientes' });
    expect(ultimaActualizacion()).toMatchObject({ estado: 'fallida', pagoEstado: 'denegado' });
    expect(mockServicio.crearCitaEnAgenda).not.toHaveBeenCalled();
  });

  it('credenciales rechazadas: falla sin cita', async () => {
    mockNiubiz.autorizar.mockRejectedValue(new NiubizError('x', 'rechazo', { http: 401 }));
    expect((await procesarRetorno('RW-1', form)).destino).toBe('error');
    expect(ultimaActualizacion()).toMatchObject({ estado: 'fallida', pagoEstado: 'rechazado' });
  });

  it('Niubiz no responde (504): queda «reembolsar» para verificar, sin cita ni anulación automática', async () => {
    mockNiubiz.autorizar.mockRejectedValue(new NiubizError('x', 'incierto'));
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('incierto');
    expect(ultimaActualizacion()).toMatchObject({ estado: 'reembolsar', pagoEstado: 'incierto' });
    expect(mockServicio.crearCitaEnAgenda).not.toHaveBeenCalled();
    expect(mockNiubiz.reversar).not.toHaveBeenCalled();
  });

  it('Niubiz autoriza otro monto: se anula y no hay cita', async () => {
    mockNiubiz.autorizar.mockResolvedValue(aut(81));
    const r = await procesarRetorno('RW-1', form);
    expect(mockNiubiz.reversar).toHaveBeenCalledWith(expect.anything(), 'ACC', { numeroCompra: '1000001', fechaTransaccion: '261110101010' });
    expect(r.destino).toBe('error');
    expect(ultimaActualizacion()).toMatchObject({ estado: 'fallida', pagoEstado: 'anulado' });
    expect(mockServicio.crearCitaEnAgenda).not.toHaveBeenCalled();
  });

  it('otro monto y la anulación falla: queda cobrado_sin_cita para devolver a mano', async () => {
    mockNiubiz.autorizar.mockResolvedValue(aut(81));
    mockNiubiz.reversar.mockResolvedValue(false);
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('incierto');
    expect(ultimaActualizacion()).toMatchObject({ estado: 'reembolsar', pagoEstado: 'cobrado_sin_cita' });
  });

  it('cobró pero la cita no se pudo crear (hora ocupada): se anula el cobro', async () => {
    mockServicio.crearCitaEnAgenda.mockRejectedValue(new Error('Horario no disponible'));
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('sin_horario');
    expect(mockNiubiz.reversar).toHaveBeenCalledTimes(1);
    expect(ultimaActualizacion()).toMatchObject({ estado: 'fallida', pagoEstado: 'anulado' });
  });

  it('cobró, la cita falló y la anulación también: «reembolsar» + cobrado_sin_cita (nunca queda como confirmada)', async () => {
    mockServicio.crearCitaEnAgenda.mockRejectedValue(new Error('Horario no disponible'));
    mockNiubiz.reversar.mockRejectedValue(new Error('500'));
    const r = await procesarRetorno('RW-1', form);
    expect(r.destino).toBe('sin_horario');
    expect(r.motivo).toMatch(/devolveremos/i);
    expect(ultimaActualizacion()).toMatchObject({ estado: 'reembolsar', pagoEstado: 'cobrado_sin_cita' });
  });
});
