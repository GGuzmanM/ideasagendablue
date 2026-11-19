/** Extras del chat para el MCP (17-nov-2026): extender el plazo de pago una sola vez e info de sedes. */
const mockPrisma = {
  reservaWeb: { findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  sede: { findMany: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('../src/db', () => ({ prisma: mockPrisma }));
jest.mock('../src/services/audit', () => ({ registrarAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/citaCompleta', () => ({ crearComentarioEnTx: jest.fn(), getCitaCompleta: jest.fn() }));
jest.mock('../src/socket', () => ({ emitirEventoCita: jest.fn() }));
jest.mock('../src/services/reservaWeb/gestion', () => ({ citaDelPaciente: jest.fn(), evaluarCambio: jest.fn() }));
const mockEstado = jest.fn();
jest.mock('../src/services/reservaWeb/reservaWebService', () => ({ estadoReservaPorCodigo: (...a: unknown[]) => mockEstado(...a), PASARELA_WOO: 'woocommerce' }));
jest.mock('../src/services/reservaWeb/woocommerce', () => ({ MINUTOS_PAGO: 10 }));

import { extenderPago, infoSedes } from '../src/services/reservaWeb/extrasChat';

const reserva = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', codigo: 'LB-123456', canal: 'whatsapp', citaId: 'c1', sedeId: 's1', estado: 'esperando_pago', pasarela: 'woocommerce',
  expiraEn: new Date(Date.now() + 4 * 60_000), pagoDetalle: { url: 'https://tienda/pagar' }, ...extra,
});

beforeEach(() => { jest.clearAllMocks(); mockEstado.mockResolvedValue({ estado: 'esperando_pago' }); });

describe('extenderPago', () => {
  it('suma 10 minutos una vez y lo marca', async () => {
    const r = reserva();
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(r);
    mockPrisma.reservaWeb.updateMany.mockResolvedValue({ count: 1 });
    await extenderPago('lb-123456', ' 759-215-04 ', 'whatsapp');
    expect(mockPrisma.reservaWeb.findFirst).toHaveBeenCalledWith({ where: { codigo: 'LB-123456', canal: 'whatsapp', numeroDocumento: '75921504' } });
    const arg = mockPrisma.reservaWeb.updateMany.mock.calls[0][0];
    expect(arg.data.expiraEn.getTime()).toBe(r.expiraEn.getTime() + 10 * 60_000);
    expect(arg.data.pagoDetalle).toEqual({ url: 'https://tienda/pagar', extendido: true });
    expect(arg.where).toMatchObject({ id: 'r1', estado: 'esperando_pago' });
    expect(mockEstado).toHaveBeenCalledWith('LB-123456', 'whatsapp');
  });

  it('segunda vez → YA_EXTENDIDO; vencida → PAGO_VENCIDO; sin pago → NO_ESPERA_PAGO; ajena → 404', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValueOnce(reserva({ pagoDetalle: { extendido: true } }));
    await expect(extenderPago('LB-123456', '75921504', 'whatsapp')).rejects.toMatchObject({ code: 'YA_EXTENDIDO' });
    mockPrisma.reservaWeb.findFirst.mockResolvedValueOnce(reserva({ expiraEn: new Date(Date.now() - 1000) }));
    await expect(extenderPago('LB-123456', '75921504', 'whatsapp')).rejects.toMatchObject({ code: 'PAGO_VENCIDO' });
    mockPrisma.reservaWeb.findFirst.mockResolvedValueOnce(reserva({ estado: 'confirmada' }));
    await expect(extenderPago('LB-123456', '75921504', 'whatsapp')).rejects.toMatchObject({ code: 'NO_ESPERA_PAGO' });
    mockPrisma.reservaWeb.findFirst.mockResolvedValueOnce(null);
    await expect(extenderPago('LB-123456', '11111111', 'whatsapp')).rejects.toMatchObject({ code: 'RESERVA_NO_ENCONTRADA' });
    expect(mockPrisma.reservaWeb.updateMany).not.toHaveBeenCalled();
  });

  it('si venció justo al extender (carrera con el mantenimiento) → PAGO_VENCIDO', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(reserva());
    mockPrisma.reservaWeb.updateMany.mockResolvedValue({ count: 0 });
    await expect(extenderPago('LB-123456', '75921504', 'whatsapp')).rejects.toMatchObject({ code: 'PAGO_VENCIDO' });
  });
});

describe('infoSedes', () => {
  it('ordena el horario de lunes a domingo y omite los días cerrados', async () => {
    mockPrisma.sede.findMany.mockResolvedValue([{
      id: 's1', nombre: 'Lince', direccion: 'Av. Prueba 123',
      horario: { domingo: { apertura: '09:00', cierre: '13:00' }, lunes: { apertura: '08:00', cierre: '20:00' }, sábado: { apertura: '08:00', cierre: '14:00' }, martes: null },
    }]);
    const r = await infoSedes();
    expect(r.sedes[0].horario.map((h) => h.dia)).toEqual(['lunes', 'sábado', 'domingo']);
    expect(mockPrisma.sede.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { activa: true, deletedAt: null, reservaWeb: true } }));
  });
});
