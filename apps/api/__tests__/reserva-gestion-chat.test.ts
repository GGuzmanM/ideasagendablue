/**
 * Cancelar y reprogramar desde las APIs del chat (11-nov-2026; reglas del equipo del chat desde el 16-nov-2026). La Agenda
 * (PATCH /citas/:id/estado y /mover) está simulada: se comprueba qué se le pide y qué se rechaza antes de llegar a ella.
 */
/** Día HÁBIL (lunes a viernes) a partir de `n` días desde hoy: reprogramar a fin de semana tiene su propia regla. */
function diaHabil(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function proximo(diaSemana: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((diaSemana - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
const manana = diaHabil(2);
/** El día hábil siguiente a `manana`. */
const pasado = (() => {
  const d = new Date(`${manana}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
})();
const hoyLima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());

const reserva = { id: 'r1', codigo: 'LB-123456', canal: 'whatsapp', estado: 'confirmada', citaId: 'c1', pagoEstado: null };
const citaBase = {
  id: 'c1', numero: 8323, estado: 'agendada', deletedAt: null, fecha: new Date(`${manana}T12:00:00Z`), horaInicio: '10:00', duracionMinutos: 30,
  sedeId: 's1', unidadNegocioId: 'u1', servicioId: 'sv1', subcategoriaId: null, profesionalId: 'p1', pacienteId: 'pac1',
  estadoPago: 'pendiente', pagada: false, paquetePacienteId: null, slotGrupoId: null, solicitadoProfesionalId: null,
  paciente: { tipoDocumento: 'DNI' },
};

const mockPrisma = {
  reservaWeb: { findFirst: jest.fn(), findMany: jest.fn() },
  cita: { findUnique: jest.fn(), findMany: jest.fn() },
  paciente: { findFirst: jest.fn() },
};
jest.mock('../src/db', () => ({ prisma: mockPrisma }));
jest.mock('../src/services/audit', () => ({ registrarAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/reservaWeb/pagoPrevio', () => ({ cerrarPagoPendienteDeCita: jest.fn().mockResolvedValue(undefined) }));
const mockProfesional = jest.fn();
jest.mock('../src/services/disponibilidad', () => ({ seleccionarProfesionalOptimo: (...a: unknown[]) => mockProfesional(...a) }));
const mockServicio = {
  estadoReservaPorCodigo: jest.fn(), horasLibres: jest.fn(), limpiarCacheDias: jest.fn(), llamarAgenda: jest.fn(), minutosAhoraLima: () => 12 * 60,
  servicioReservable: jest.fn(), PASARELA_WOO: 'woocommerce',
};
jest.mock('../src/services/reservaWeb/reservaWebService', () => mockServicio);

import { AppError } from '../src/middleware/errorHandler';
import {
  cancelarReserva, reprogramarReserva, citasProximas, cancelarCitaPaciente, reprogramarCitaPaciente, leerNumeroCita,
  cancelarCompat, reprogramarCompat, evaluarCambio,
} from '../src/services/reservaWeb/gestion';

const respuesta = (status: number, cuerpo: unknown = {}) => ({ ok: status < 300, status, json: async () => cuerpo });
const cita = (extra: Record<string, unknown> = {}) => ({ ...citaBase, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  delete process.env.RESERVA_CHAT_CAMBIO_ANTICIPACION_MIN;
  mockPrisma.reservaWeb.findFirst.mockResolvedValue({ ...reserva });
  mockPrisma.reservaWeb.findMany.mockResolvedValue([]);
  mockPrisma.cita.findUnique.mockResolvedValue(cita());
  mockPrisma.cita.findMany.mockResolvedValue([]);
  mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac1' });
  mockServicio.estadoReservaPorCodigo.mockResolvedValue({ codigo: 'LB-123456', estado: 'confirmada' });
  mockServicio.horasLibres.mockResolvedValue(['09:00', '15:00']);
  mockServicio.llamarAgenda.mockResolvedValue(respuesta(200));
  mockServicio.servicioReservable.mockResolvedValue({});
  mockProfesional.mockResolvedValue('p2');
});

describe('reglas (evaluarCambio)', () => {
  const ev = (extra: Record<string, unknown> = {}, reservas: Record<string, unknown>[] = []) => evaluarCambio(cita(extra) as never, reservas as never);

  it('cita normal, con tiempo: se puede', () => expect(ev()).toEqual({ yaCancelada: false, bloqueo: null }));
  it('cancelada, reprogramada o borrada: ya no está vigente', () => {
    expect(ev({ estado: 'cancelada' }).yaCancelada).toBe(true);
    expect(ev({ estado: 'reprogramada' }).yaCancelada).toBe(true);
    expect(ev({ deletedAt: new Date() }).yaCancelada).toBe(true);
  });
  it('en curso o atendida → NO_SE_PUEDE_CANCELAR', () => {
    for (const estado of ['llego', 'en_atencion', 'completada', 'no_show']) expect(ev({ estado }).bloqueo?.codigo).toBe('NO_SE_PUEDE_CANCELAR');
  });
  it('esperando el pago previo → ESPERANDO_PAGO', () => {
    expect(ev({}, [{ pasarela: 'woocommerce', estado: 'esperando_pago', pagoEstado: 'pendiente' }]).bloqueo?.codigo).toBe('ESPERANDO_PAGO');
  });
  it('con cualquier pago (en línea, en la sede o parcial) → REQUIERE_ASESOR', () => {
    expect(ev({}, [{ pasarela: 'niubiz', estado: 'confirmada', pagoEstado: 'aprobado' }]).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
    expect(ev({ pagada: true }).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
    expect(ev({ estadoPago: 'incompleto' }).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
  });
  it('de paquete, de visita doble o con profesional pedido → REQUIERE_ASESOR', () => {
    expect(ev({ paquetePacienteId: 'pq' }).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
    expect(ev({ slotGrupoId: 'g' }).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
    expect(ev({ solicitadoProfesionalId: 'pr' }).bloqueo?.codigo).toBe('REQUIERE_ASESOR');
  });
  it('faltan menos de 2 h (o ya pasó) → FUERA_DE_PLAZO; el plazo se puede cambiar', () => {
    const hoy = new Date(`${hoyLima}T12:00:00Z`); // minutosAhoraLima simulado = 12:00
    expect(ev({ fecha: hoy, horaInicio: '13:30' }).bloqueo?.codigo).toBe('FUERA_DE_PLAZO');
    expect(ev({ fecha: hoy, horaInicio: '14:00' }).bloqueo).toBeNull();
    expect(ev({ fecha: new Date('2026-01-05T12:00:00Z') }).bloqueo?.codigo).toBe('FUERA_DE_PLAZO');
    process.env.RESERVA_CHAT_CAMBIO_ANTICIPACION_MIN = '30';
    expect(ev({ fecha: hoy, horaInicio: '13:00' }).bloqueo).toBeNull();
  });
});

describe('cancelar (por código LB del canal)', () => {
  it('cancela con el endpoint de la Agenda y deja el motivo', async () => {
    const r = await cancelarReserva('LB-123456', 'whatsapp', 'Viaje');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/estado', { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente vía whatsapp (reserva LB-123456): Viaje' });
    expect(r.sinCambios).toBe(false);
  });

  it('busca la reserva SOLO en su canal', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(null);
    await expect(cancelarReserva('LB-123456', 'web', null)).rejects.toMatchObject({ statusCode: 404, code: 'RESERVA_NO_ENCONTRADA' });
    expect(mockPrisma.reservaWeb.findFirst).toHaveBeenCalledWith({ where: { codigo: 'LB-123456', canal: 'web' } });
  });

  it('ya cancelada → responde sin tocar nada (reintento)', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ estado: 'cancelada' }));
    expect((await cancelarReserva('LB-123456', 'whatsapp', null)).sinCambios).toBe(true);
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('una regla lo impide → 409 con su código y sin tocar la Agenda', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([{ pagoEstado: 'aprobado', pasarela: 'niubiz', estado: 'confirmada' }]);
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ estado: 'llego' }));
    mockPrisma.reservaWeb.findMany.mockResolvedValue([]);
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'NO_SE_PUEDE_CANCELAR' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('la reserva no tiene cita → SIN_CITA', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue({ ...reserva, citaId: null });
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'SIN_CITA' });
  });

  it('la Agenda rechaza → mismo código y mensaje; 5xx → error del servidor', async () => {
    mockServicio.llamarAgenda.mockResolvedValueOnce(respuesta(400, { error: 'TRANSICION_INVALIDA', message: 'No se puede' }));
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 400, code: 'TRANSICION_INVALIDA', message: 'No se puede' });
    mockServicio.llamarAgenda.mockResolvedValueOnce(respuesta(500));
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 502, code: 'AGENDA_ERROR' });
    mockServicio.llamarAgenda.mockResolvedValueOnce(respuesta(403));
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 503, code: 'RESERVA_NO_CONFIGURADA' });
  });
});

describe('reprogramar (por código LB del canal)', () => {
  it('mueve la misma cita a una hora ofrecida, con el especialista que asigna la Agenda', async () => {
    const r = await reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00');
    expect(mockServicio.horasLibres).toHaveBeenCalledWith('s1', 'sv1', pasado);
    expect(mockProfesional).toHaveBeenCalledWith('s1', 'u1', 'sv1', pasado, '15:00', 'p1');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', { fecha: pasado, horaInicio: '15:00', profesionalId: 'p2' });
    expect(r.sinCambios).toBe(false);
  });

  it('nadie libre según el selector → se intenta con el mismo especialista (la Agenda decide)', async () => {
    mockProfesional.mockResolvedValue(null);
    await reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', expect.objectContaining({ profesionalId: 'p1' }));
  });

  it('hora que no ofrece GET /horas → 409 HORA_NO_DISPONIBLE sin mover', async () => {
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '11:00')).rejects.toMatchObject({ statusCode: 409, code: 'HORA_NO_DISPONIBLE' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('mismo día, a una hora que se cruza con ella misma → lo decide la Agenda', async () => {
    await reprogramarReserva('LB-123456', 'whatsapp', manana, '10:15');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', expect.objectContaining({ fecha: manana, horaInicio: '10:15' }));
  });

  it('misma fecha y hora → sin cambios (reintento)', async () => {
    const r = await reprogramarReserva('LB-123456', 'whatsapp', manana, '10:00');
    expect(r.sinCambios).toBe(true);
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('a sábado o domingo → REQUIERE_ASESOR (en cualquier API)', async () => {
    for (const f of [proximo(6), proximo(0)]) {
      await expect(reprogramarReserva('LB-123456', 'whatsapp', f, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
      await expect(reprogramarReserva('LB-123456', 'web', f, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
    }
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('servicio que no se reserva en línea en esa sede → REQUIERE_ASESOR', async () => {
    mockServicio.servicioReservable.mockRejectedValue(new AppError('no', 400, 'SERVICIO_NO_RESERVABLE'));
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
  });

  it('paciente con otro documento (pasaporte) → REQUIERE_ASESOR', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ paciente: { tipoDocumento: 'PASAPORTE' } }));
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
  });

  it('con pago → REQUIERE_ASESOR; esperando el pago previo → ESPERANDO_PAGO', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([{ pagoEstado: 'aprobado', pasarela: 'niubiz', estado: 'confirmada' }]);
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'REQUIERE_ASESOR' });
    mockPrisma.reservaWeb.findMany.mockResolvedValue([{ pagoEstado: 'pendiente', pasarela: 'woocommerce', estado: 'esperando_pago' }]);
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00')).rejects.toMatchObject({ statusCode: 409, code: 'ESPERANDO_PAGO' });
  });

  it('cancelada → NO_VIGENTE', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ estado: 'cancelada' }));
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '09:00')).rejects.toMatchObject({ statusCode: 409, code: 'NO_VIGENTE' });
  });

  it('el horario se ocupó justo antes (la Agenda responde 409) → se pasa tal cual', async () => {
    mockServicio.llamarAgenda.mockResolvedValueOnce(respuesta(409, { error: 'SLOT_OCUPADO', message: 'Ese horario ya está ocupado' }));
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '09:00')).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_OCUPADO' });
  });
});

describe('por el paciente (documento + N.º de cita, id o LB)', () => {
  const doc = { tipoDocumento: 'DNI', numeroDocumento: '12345678' };
  const docSinTipo = { numeroDocumento: '12345678' };
  const ID_CITA = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(null);
    mockPrisma.cita.findMany.mockImplementation(async (q: { select?: { sede?: unknown } }) => (q.select?.sede
      ? [{ id: 'c1', slotGrupoId: null, sede: { nombre: 'Los Olivos', direccion: 'Av. 1' }, servicio: { nombre: 'Evaluación' }, subcategoriaId: null, subcategoria: null }]
      : [cita()]));
  });

  it('lee el N.º de cita con o sin «C-» y ceros', () => {
    expect(leerNumeroCita('C-008323')).toBe(8323);
    expect(leerNumeroCita('c8323')).toBe(8323);
    expect(leerNumeroCita('8323')).toBe(8323);
    expect(leerNumeroCita('LB-123456')).toBeNull();
  });

  it('lista las citas próximas con codigo, estadoCita y puedeCambiar, sin datos del paciente ni del profesional', async () => {
    const r = await citasProximas(doc);
    expect(mockPrisma.paciente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tipoDocumento: 'DNI', numeroDocumento: '12345678' }) }));
    expect(r).toEqual([expect.objectContaining({ numeroCita: 'C-008323', codigo: 'c1', estadoCita: 'agendada', puedeCambiar: true, fecha: manana, sedeId: 's1', servicioId: 'sv1' })]);
    expect(r[0]).not.toHaveProperty('motivo');
    expect(r[0]).not.toHaveProperty('profesionalId');
    expect(r[0]).not.toHaveProperty('pacienteId');
  });

  it('documento SIN tipo: busca solo por el número', async () => {
    await citasProximas(docSinTipo);
    expect(mockPrisma.paciente.findFirst.mock.calls[0][0].where).not.toHaveProperty('tipoDocumento');
  });

  it('una cita bloqueada sale con puedeCambiar: false y su motivo; con reserva, su codigo es el LB', async () => {
    mockPrisma.reservaWeb.findMany.mockResolvedValue([{ citaId: 'c1', codigo: 'LB-654321', canal: 'web', pagoEstado: 'aprobado', pasarela: 'niubiz', estado: 'confirmada' }]);
    const [c] = await citasProximas(docSinTipo);
    expect(c).toMatchObject({ codigo: 'LB-654321', puedeCambiar: false, motivo: 'REQUIERE_ASESOR' });
  });

  it('documento desconocido → lista vacía; la cita de hoy cuya hora ya pasó no aparece', async () => {
    mockPrisma.paciente.findFirst.mockResolvedValueOnce(null);
    expect(await citasProximas(doc)).toEqual([]);
    mockPrisma.cita.findMany.mockImplementation(async (q: { select?: { sede?: unknown } }) => (q.select?.sede ? [] : [cita({ fecha: new Date(`${hoyLima}T12:00:00Z`), horaInicio: '08:00' })]));
    expect(await citasProximas(doc)).toEqual([]);
  });

  it('cita de OTRO paciente → 404 como si no existiera', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ pacienteId: 'otro' }));
    await expect(cancelarCitaPaciente('C-008323', doc, 'whatsapp', null)).rejects.toMatchObject({ statusCode: 404, code: 'CITA_NO_ENCONTRADA' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('cancela y reprograma por N.º de cita', async () => {
    const r = await cancelarCitaPaciente('C-008323', doc, 'whatsapp', 'Viaje');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/estado', { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente vía whatsapp: Viaje' });
    expect(r).toMatchObject({ numeroCita: 'C-008323', sinCambios: false });
    await reprogramarCitaPaciente('C-008323', doc, 'whatsapp', pasado, '15:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', { fecha: pasado, horaInicio: '15:00', profesionalId: 'p2' });
  });

  // ─── Contrato de la nota de Ana ───
  it('cancelar con su contrato: codigo = id de la cita → { codigo, estado: "cancelada", repetida }', async () => {
    const r = await cancelarCompat(ID_CITA, docSinTipo, 'whatsapp', 'Viaje');
    expect(mockPrisma.cita.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID_CITA } }));
    expect(r).toMatchObject({ codigo: ID_CITA, estado: 'cancelada', repetida: false });
  });

  it('cancelar con su contrato: codigo LB de OTRO canal vale si el documento es del dueño', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValueOnce({ citaId: 'c1' });
    const r = await cancelarCompat('LB-654321', docSinTipo, 'whatsapp', null);
    expect(mockPrisma.reservaWeb.findFirst.mock.calls[0][0]).toEqual({ where: { codigo: 'LB-654321' }, select: { citaId: true } });
    expect(r).toMatchObject({ codigo: 'LB-654321', estado: 'cancelada', repetida: false });
  });

  it('con su contrato: documento de otra persona → 404 RESERVA_NO_ENCONTRADA', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue(cita({ pacienteId: 'otro' }));
    await expect(cancelarCompat(ID_CITA, docSinTipo, 'whatsapp', null)).rejects.toMatchObject({ statusCode: 404, code: 'RESERVA_NO_ENCONTRADA' });
    await expect(reprogramarCompat(ID_CITA, docSinTipo, 'whatsapp', pasado, '15:00')).rejects.toMatchObject({ statusCode: 404, code: 'RESERVA_NO_ENCONTRADA' });
  });

  it('reprogramar con su contrato: MUEVE la misma cita y responde con codigoAnterior', async () => {
    const r = await reprogramarCompat(ID_CITA, docSinTipo, 'whatsapp', pasado, '15:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', { fecha: pasado, horaInicio: '15:00', profesionalId: 'p2' });
    expect(r).toMatchObject({ codigo: ID_CITA, codigoAnterior: ID_CITA, estado: 'confirmada', citaId: 'c1', repetida: false, moneda: 'PEN' });
  });
});
