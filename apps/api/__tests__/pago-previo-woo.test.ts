/**
 * Pago previo de sábado y domingo por WooCommerce (13-nov-2026, chat de WhatsApp): firma de los avisos, qué días se cobra y
 * qué pasa con la reserva y la cita en cada caso (pagó, pagó otro monto, pagó tarde, no pagó). La tienda y la Agenda están simuladas.
 */
import crypto from 'crypto';

const mockPrisma = {
  reservaWeb: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  cita: { findUnique: jest.fn() },
};
jest.mock('../src/db', () => ({ prisma: mockPrisma }));
jest.mock('../src/services/audit', () => ({ registrarAudit: jest.fn().mockResolvedValue(undefined) }));

const mockAgenda = { llamarAgenda: jest.fn(), limpiarCacheDias: jest.fn(), PASARELA_WOO: 'woocommerce' };
jest.mock('../src/services/reservaWeb/reservaWebService', () => mockAgenda);

const mockWoo = { leerPedidoWoo: jest.fn(), cancelarPedidoWoo: jest.fn() };
jest.mock('../src/services/reservaWeb/woocommerce', () => {
  const real = jest.requireActual('../src/services/reservaWeb/woocommerce');
  return { ...real, ...mockWoo, wooConfigurado: () => true };
});

import { firmaWooValida, esFinDeSemana, requierePagoPrevio } from '../src/services/reservaWeb/woocommerce';
import { procesarPagoWoo, mantenimientoPagoPrevio, cerrarPagoPendienteDeCita } from '../src/services/reservaWeb/pagoPrevio';
import { momentoAviso, telefonoE164 } from '../src/services/avisoWhatsappService';

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', codigo: 'LB-111111', pasarela: 'woocommerce', estado: 'esperando_pago', pagoEstado: 'pendiente', pagoReferencia: '501',
  pagoDetalle: { url: 'https://tienda/pagar', pedido: 501 }, monto: 90, citaId: 'c1', sedeId: 's1', expiraEn: new Date(Date.now() + 5 * 60_000), ...extra,
});
const pedido = (extra: Record<string, unknown> = {}) => ({ id: 501, estado: 'processing', total: 90, url: 'https://tienda/pagar', codigo: 'LB-111111', idTransaccion: 'T-9', ...extra });
const rutas = () => mockAgenda.llamarAgenda.mock.calls.map((c) => `${c[0]} ${c[1]}`);
const datosActualizados = () => mockPrisma.reservaWeb.updateMany.mock.calls.at(-1)?.[0]?.data;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockPrisma.reservaWeb.findFirst.mockResolvedValue(reserva());
  mockPrisma.reservaWeb.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.reservaWeb.update.mockResolvedValue({});
  mockPrisma.cita.findUnique.mockResolvedValue({ estado: 'agendada', deletedAt: null, estadoPago: 'pendiente', numero: 77 });
  mockAgenda.llamarAgenda.mockResolvedValue({ ok: true, status: 200 });
  mockWoo.leerPedidoWoo.mockResolvedValue(pedido());
  mockWoo.cancelarPedidoWoo.mockResolvedValue(undefined);
});

describe('firma de los avisos de WooCommerce', () => {
  const cuerpo = Buffer.from('{"id":501,"status":"processing"}');
  const firmar = (s: string) => crypto.createHmac('sha256', s).update(cuerpo).digest('base64');
  it('acepta solo la firma hecha con el mismo secreto y el mismo cuerpo', () => {
    expect(firmaWooValida(cuerpo, firmar('secreto-largo-123'), 'secreto-largo-123')).toBe(true);
    expect(firmaWooValida(cuerpo, firmar('otro-secreto'), 'secreto-largo-123')).toBe(false);
    expect(firmaWooValida(Buffer.from('{"id":502}'), firmar('secreto-largo-123'), 'secreto-largo-123')).toBe(false);
  });
  it('sin firma o sin secreto configurado, nada es válido', () => {
    expect(firmaWooValida(cuerpo, undefined, 'secreto-largo-123')).toBe(false);
    expect(firmaWooValida(cuerpo, firmar(''), '')).toBe(false);
  });
});

describe('qué días se cobra', () => {
  it('sábado y domingo sí; lunes a viernes no', () => {
    expect(esFinDeSemana('2026-11-14')).toBe(true); // sábado
    expect(esFinDeSemana('2026-11-15')).toBe(true); // domingo
    expect(esFinDeSemana('2026-11-13')).toBe(false); // viernes
    expect(esFinDeSemana('2026-11-16')).toBe(false); // lunes
    process.env.WOO_URL = 'https://tienda.test'; process.env.WOO_CONSUMER_KEY = 'ck_x'; process.env.WOO_CONSUMER_SECRET = 'cs_x';
    expect(requierePagoPrevio('2026-11-14')).toBe(true);
    expect(requierePagoPrevio('2026-11-13')).toBe(false);
    delete process.env.WOO_URL; delete process.env.WOO_CONSUMER_KEY; delete process.env.WOO_CONSUMER_SECRET;
    expect(requierePagoPrevio('2026-11-14')).toBe(false); // sin tienda conectada no se cobra
  });
});

describe('aviso de pago', () => {
  it('pagado a tiempo: reserva confirmada y cita con pago completo + comentario', async () => {
    expect(await procesarPagoWoo('501')).toBe('confirmada');
    expect(datosActualizados()).toMatchObject({ estado: 'confirmada', pagoEstado: 'aprobado' });
    expect(rutas()).toEqual(['PATCH /citas/c1/pago', 'PATCH /citas/c1/comentario']);
    expect(mockAgenda.llamarAgenda.mock.calls[0][2]).toEqual({ estadoPago: 'completo' });
  });

  it('un segundo aviso del mismo pago no hace nada', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(reserva({ estado: 'confirmada', pagoEstado: 'aprobado' }));
    expect(await procesarPagoWoo('501')).toBe('ya_procesada');
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });

  it('pagó otro monto: queda para revisar y la cita NO se marca pagada', async () => {
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ total: 1 }));
    expect(await procesarPagoWoo('501')).toBe('monto_distinto');
    expect(datosActualizados()).toMatchObject({ estado: 'reembolsar', pagoEstado: 'monto_distinto' });
    expect(rutas()).toEqual(['PATCH /citas/c1/comentario']);
  });

  it('pagó después de vencer: «reembolsar», sin tocar la cita', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(reserva({ estado: 'expirada' }));
    expect(await procesarPagoWoo('501')).toBe('reembolsar');
    expect(datosActualizados()).toMatchObject({ estado: 'reembolsar', pagoEstado: 'aprobado' });
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });

  it('pagó, pero la cita ya se había cancelado en la agenda: «reembolsar»', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ estado: 'cancelada', deletedAt: null });
    expect(await procesarPagoWoo('501')).toBe('reembolsar');
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });

  it('el código del pedido no es el de la reserva: no se confirma nada', async () => {
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ codigo: 'LB-999999' }));
    expect(await procesarPagoWoo('501')).toBe('codigo_distinto');
    expect(mockPrisma.reservaWeb.updateMany).not.toHaveBeenCalled();
  });

  it('pago fallido: se anota y la cita sigue apartada hasta que venza', async () => {
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ estado: 'failed' }));
    expect(await procesarPagoWoo('501')).toBe('rechazado');
    expect(mockPrisma.reservaWeb.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pagoEstado: 'rechazado' } }));
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });

  it('pedido aún sin pagar: sin cambios', async () => {
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ estado: 'pending' }));
    expect(await procesarPagoWoo('501')).toBe('sin_cambio');
  });
});

describe('vencimiento (cada minuto)', () => {
  const vencida = { id: 'r1', codigo: 'LB-111111', citaId: 'c1', pagoReferencia: '501', expiraEn: new Date(Date.now() - 60_000) };

  it('no pagó: reserva expirada, pedido cancelado y cita cancelada', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([vencida]);
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ estado: 'pending' }));
    expect(await mantenimientoPagoPrevio()).toBe(1);
    expect(datosActualizados()).toEqual({ estado: 'expirada' });
    expect(mockWoo.cancelarPedidoWoo).toHaveBeenCalledWith('501');
    expect(rutas()).toEqual(['PATCH /citas/c1/estado']);
    expect(mockAgenda.llamarAgenda.mock.calls[0][2]).toMatchObject({ estado: 'cancelada' });
  });

  it('pagó al último minuto (el aviso no llegó): se confirma en vez de cancelar', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([vencida]);
    expect(await mantenimientoPagoPrevio()).toBe(1);
    expect(mockWoo.cancelarPedidoWoo).not.toHaveBeenCalled();
    expect(rutas()).toEqual(['PATCH /citas/c1/pago', 'PATCH /citas/c1/comentario']);
  });

  it('la tienda no responde: espera y reintenta (no cancela todavía)', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([vencida]);
    mockWoo.leerPedidoWoo.mockRejectedValue(new Error('timeout'));
    await mantenimientoPagoPrevio();
    expect(mockPrisma.reservaWeb.updateMany).not.toHaveBeenCalled();
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });

  it('la cita ya estaba cancelada: no se vuelve a cancelar', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([vencida]);
    mockWoo.leerPedidoWoo.mockResolvedValue(pedido({ estado: 'pending' }));
    mockPrisma.cita.findUnique.mockResolvedValue({ estado: 'cancelada', deletedAt: null, estadoPago: 'pendiente', numero: 77 });
    await mantenimientoPagoPrevio();
    expect(mockWoo.cancelarPedidoWoo).toHaveBeenCalled();
    expect(mockAgenda.llamarAgenda).not.toHaveBeenCalled();
  });
});

describe('cancelar por el chat antes de pagar', () => {
  it('cierra la reserva y anula el pedido', async () => {
    await cerrarPagoPendienteDeCita('c1');
    expect(datosActualizados()).toMatchObject({ estado: 'expirada' });
    expect(mockWoo.cancelarPedidoWoo).toHaveBeenCalledWith('501');
  });
  it('sin pago pendiente no hace nada', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(null);
    await cerrarPagoPendienteDeCita('c1');
    expect(mockWoo.cancelarPedidoWoo).not.toHaveBeenCalled();
  });
});

describe('aviso de WhatsApp 2 h antes', () => {
  it('avisa entre 2 h y 20 min antes', () => {
    expect(momentoAviso(150)).toBe('esperar');
    expect(momentoAviso(120)).toBe('avisar');
    expect(momentoAviso(25)).toBe('avisar');
    expect(momentoAviso(10)).toBe('tarde');
  });
  it('teléfono en formato internacional', () => {
    expect(telefonoE164('999 888 777')).toBe('+51999888777');
    expect(telefonoE164('+51 999888777')).toBe('+51999888777');
  });
});
