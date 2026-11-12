/**
 * Cancelar y reprogramar una reserva desde la API del chat (11-nov-2026). La Agenda (PATCH /citas/:id/estado y /mover) está
 * simulada: se comprueba qué se le pide y qué se rechaza antes de llegar a ella.
 */
const manana = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const pasado = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
const reserva = { id: 'r1', codigo: 'LB-123456', canal: 'whatsapp', estado: 'confirmada', citaId: 'c1', pagoEstado: null };
const citaBase = {
  id: 'c1', estado: 'agendada', deletedAt: null, fecha: new Date(`${manana}T12:00:00Z`), horaInicio: '10:00', duracionMinutos: 30,
  sedeId: 's1', unidadNegocioId: 'u1', servicioId: 'sv1', profesionalId: 'p1',
};

const mockPrisma = {
  reservaWeb: { findFirst: jest.fn(), findMany: jest.fn() },
  cita: { findUnique: jest.fn(), findMany: jest.fn() },
  paciente: { findFirst: jest.fn() },
};
jest.mock('../src/db', () => ({ prisma: mockPrisma }));
jest.mock('../src/services/audit', () => ({ registrarAudit: jest.fn().mockResolvedValue(undefined) }));
const mockProfesional = jest.fn();
jest.mock('../src/services/disponibilidad', () => ({ seleccionarProfesionalOptimo: (...a: unknown[]) => mockProfesional(...a) }));
const mockServicio = {
  estadoReservaPorCodigo: jest.fn(), horasLibres: jest.fn(), limpiarCacheDias: jest.fn(), llamarAgenda: jest.fn(), minutosAhoraLima: () => 12 * 60,
};
jest.mock('../src/services/reservaWeb/reservaWebService', () => mockServicio);

import { cancelarReserva, reprogramarReserva, citasProximas, cancelarCitaPaciente, reprogramarCitaPaciente, leerNumeroCita } from '../src/services/reservaWeb/gestion';

const respuesta = (status: number, cuerpo: unknown = {}) => ({ ok: status < 300, status, json: async () => cuerpo });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockPrisma.reservaWeb.findFirst.mockResolvedValue({ ...reserva });
  mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase });
  mockServicio.estadoReservaPorCodigo.mockResolvedValue({ codigo: 'LB-123456', estado: 'confirmada' });
  mockServicio.horasLibres.mockResolvedValue(['09:00', '15:00']);
  mockServicio.llamarAgenda.mockResolvedValue(respuesta(200));
  mockProfesional.mockResolvedValue('p2');
  mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac1' });
  mockPrisma.cita.findMany.mockResolvedValue([]);
  mockPrisma.reservaWeb.findMany.mockResolvedValue([]);
});

describe('por el paciente (documento + N.º de cita)', () => {
  const citaPaciente = { ...citaBase, numero: 8323, pacienteId: 'pac1' };
  const doc = { tipoDocumento: 'DNI', numeroDocumento: '12345678' };
  beforeEach(() => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaPaciente });
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(null);
    mockPrisma.cita.findMany.mockImplementation(async (q: { select?: { sede?: unknown } }) => (q.select?.sede
      ? [{ id: 'c1', slotGrupoId: null, sede: { nombre: 'Los Olivos', direccion: 'Av. 1' }, servicio: { nombre: 'Evaluación' }, subcategoriaId: null, subcategoria: null }]
      : [{ ...citaPaciente }]));
  });

  it('lee el N.º de cita con o sin «C-» y ceros', () => {
    expect(leerNumeroCita('C-008323')).toBe(8323);
    expect(leerNumeroCita('c8323')).toBe(8323);
    expect(leerNumeroCita('8323')).toBe(8323);
    expect(leerNumeroCita('LB-123456')).toBeNull();
  });

  it('lista las citas próximas agendadas/confirmadas, sin datos del paciente ni del profesional', async () => {
    const r = await citasProximas(doc);
    expect(mockPrisma.paciente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tipoDocumento: 'DNI', numeroDocumento: '12345678' }) }));
    expect(mockPrisma.cita.findMany.mock.calls[0][0].where).toMatchObject({ pacienteId: 'pac1', deletedAt: null, estado: { in: ['agendada', 'confirmada'] } });
    expect(r).toEqual([expect.objectContaining({ numeroCita: 'C-008323', fecha: manana, horaInicio: '10:00', sedeId: 's1', servicioId: 'sv1', codigoReserva: null, pagadoEnLinea: false, enBloque: false })]);
    expect(r[0]).not.toHaveProperty('profesionalId');
    expect(r[0]).not.toHaveProperty('pacienteId');
  });

  it('documento desconocido → lista vacía', async () => {
    mockPrisma.paciente.findFirst.mockResolvedValue(null);
    expect(await citasProximas(doc)).toEqual([]);
  });

  it('una cita de HOY cuya hora ya pasó no aparece', async () => {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    mockPrisma.cita.findMany.mockImplementation(async (q: { select?: { sede?: unknown } }) => (q.select?.sede ? [] : [{ ...citaPaciente, fecha: new Date(`${hoy}T12:00:00Z`), horaInicio: '08:00' }]));
    expect(await citasProximas(doc)).toEqual([]); // minutosAhoraLima simulado = 12:00
  });

  it('la cita es de OTRO paciente → 404 como si no existiera', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaPaciente, pacienteId: 'otro' });
    await expect(cancelarCitaPaciente('C-008323', doc, 'whatsapp', null)).rejects.toMatchObject({ statusCode: 404, code: 'CITA_NO_ENCONTRADA' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('cancela por N.º de cita con el motivo del chat', async () => {
    const r = await cancelarCitaPaciente('C-008323', doc, 'whatsapp', 'Viaje');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/estado', { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente vía whatsapp: Viaje' });
    expect(r).toMatchObject({ numeroCita: 'C-008323', sinCambios: false });
  });

  it('pagada en línea (tiene reserva con pago aprobado) → no se cancela', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue({ id: 'r1' });
    await expect(cancelarCitaPaciente('8323', doc, 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'PAGADA_EN_LINEA' });
  });

  it('reprograma por N.º de cita', async () => {
    await reprogramarCitaPaciente('C-008323', doc, 'whatsapp', pasado, '15:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', { fecha: pasado, horaInicio: '15:00', profesionalId: 'p2' });
  });
});

describe('cancelar', () => {
  it('cancela la cita con el endpoint de la Agenda y deja el motivo', async () => {
    const r = await cancelarReserva('LB-123456', 'whatsapp', 'Viaje');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/estado', { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente vía whatsapp (reserva LB-123456): Viaje' });
    expect(r.sinCambios).toBe(false);
  });

  it('busca la reserva SOLO en su canal', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue(null);
    await expect(cancelarReserva('LB-123456', 'web', null)).rejects.toMatchObject({ statusCode: 404, code: 'RESERVA_NO_ENCONTRADA' });
    expect(mockPrisma.reservaWeb.findFirst).toHaveBeenCalledWith({ where: { codigo: 'LB-123456', canal: 'web' } });
  });

  it('ya cancelada → responde sin tocar nada (reintento del chat)', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase, estado: 'cancelada' });
    const r = await cancelarReserva('LB-123456', 'whatsapp', null);
    expect(r.sinCambios).toBe(true);
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('pagada en línea → no se cancela por aquí', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue({ ...reserva, pagoEstado: 'aprobado' });
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'PAGADA_EN_LINEA' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('el paciente ya llegó → no se cancela', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase, estado: 'llego' });
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'CITA_NO_MODIFICABLE' });
  });

  it('la hora de la cita ya pasó → no se cancela', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase, fecha: new Date('2026-01-05T12:00:00Z') });
    await expect(cancelarReserva('LB-123456', 'whatsapp', null)).rejects.toMatchObject({ statusCode: 409, code: 'CITA_PASADA' });
  });

  it('la cita fue borrada de la agenda → sin cita', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase, deletedAt: new Date() });
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

describe('reprogramar', () => {
  it('mueve la cita a una hora ofrecida, con el especialista que asigna la Agenda', async () => {
    const r = await reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00');
    expect(mockServicio.horasLibres).toHaveBeenCalledWith('s1', 'sv1', pasado);
    expect(mockProfesional).toHaveBeenCalledWith('s1', 'u1', 'sv1', pasado, '15:00', 'p1'); // prefiere al mismo especialista
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', { fecha: pasado, horaInicio: '15:00', profesionalId: 'p2' });
    expect(r.sinCambios).toBe(false);
  });

  it('nadie libre según el selector → se intenta con el mismo especialista (la Agenda decide)', async () => {
    mockProfesional.mockResolvedValue(null);
    await reprogramarReserva('LB-123456', 'whatsapp', pasado, '15:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', expect.objectContaining({ profesionalId: 'p1' }));
  });

  it('hora que no ofrece GET /horas → 409 sin mover', async () => {
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '11:00')).rejects.toMatchObject({ statusCode: 409, code: 'HORA_NO_DISPONIBLE' });
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('mismo día, a una hora que se cruza con ella misma → lo decide la Agenda', async () => {
    await reprogramarReserva('LB-123456', 'whatsapp', manana, '10:15');
    expect(mockServicio.llamarAgenda).toHaveBeenCalledWith('PATCH', '/citas/c1/mover', expect.objectContaining({ fecha: manana, horaInicio: '10:15' }));
  });

  it('misma fecha y hora → sin cambios', async () => {
    const r = await reprogramarReserva('LB-123456', 'whatsapp', manana, '10:00');
    expect(r.sinCambios).toBe(true);
    expect(mockServicio.llamarAgenda).not.toHaveBeenCalled();
  });

  it('pagada en línea → SÍ se puede reprogramar', async () => {
    mockPrisma.reservaWeb.findFirst.mockResolvedValue({ ...reserva, pagoEstado: 'aprobado' });
    await reprogramarReserva('LB-123456', 'whatsapp', pasado, '09:00');
    expect(mockServicio.llamarAgenda).toHaveBeenCalled();
  });

  it('cancelada → no se reprograma', async () => {
    mockPrisma.cita.findUnique.mockResolvedValue({ ...citaBase, estado: 'cancelada' });
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '09:00')).rejects.toMatchObject({ statusCode: 409, code: 'CITA_NO_MODIFICABLE' });
  });

  it('el horario se ocupó justo antes (la Agenda responde 409) → se pasa tal cual', async () => {
    mockServicio.llamarAgenda.mockResolvedValueOnce(respuesta(409, { error: 'SLOT_OCUPADO', message: 'Ese horario ya está ocupado' }));
    await expect(reprogramarReserva('LB-123456', 'whatsapp', pasado, '09:00')).rejects.toMatchObject({ statusCode: 409, code: 'SLOT_OCUPADO' });
  });
});
