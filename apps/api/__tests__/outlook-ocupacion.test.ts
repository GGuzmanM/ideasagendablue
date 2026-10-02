/**
 * Outlook ↔ Agenda (01-oct-2026, caso Yasica Doy): la agenda automática le puso una cita, luego pasó a Doris; el evento
 * «Cita: …» se quedó en su Outlook y la sincronización inversa lo traía como «Ocupado (Outlook)», tapando su agenda.
 * Además, borrarlo en Permisos no servía: la siguiente lectura lo revivía. Reglas blindadas:
 *  - Los eventos que creó la Agenda («Cita: …», «Reunión: …», o con id de cualquier cita) no se importan.
 *  - Un bloqueo importado que se borró a mano no se revive; uno que quitó la propia sincronización sí.
 *  - Si la cita ya no es de esa persona, su evento se quita del Outlook donde quedó.
 */
const m = {
  profFindMany: jest.fn(), citaFindMany: jest.fn(), citaFindUnique: jest.fn(), citaUpdate: jest.fn(),
  bloqFindMany: jest.fn(), bloqFindFirst: jest.fn(), bloqCreate: jest.fn(), bloqUpdate: jest.fn(),
  asigFindFirst: jest.fn(), auditFindFirst: jest.fn(),
};
jest.mock('../src/db', () => ({
  prisma: {
    profesional: { findMany: (...a: unknown[]) => m.profFindMany(...a) },
    cita: { findMany: (...a: unknown[]) => m.citaFindMany(...a), findUnique: (...a: unknown[]) => m.citaFindUnique(...a), update: (...a: unknown[]) => m.citaUpdate(...a) },
    bloqueoAgenda: { findMany: (...a: unknown[]) => m.bloqFindMany(...a), findFirst: (...a: unknown[]) => m.bloqFindFirst(...a), create: (...a: unknown[]) => m.bloqCreate(...a), update: (...a: unknown[]) => m.bloqUpdate(...a) },
    asignacionSede: { findFirst: (...a: unknown[]) => m.asigFindFirst(...a) },
    auditLog: { findFirst: (...a: unknown[]) => m.auditFindFirst(...a) },
  },
}));
jest.mock('../src/redis', () => ({ invalidateDisponibilidadCache: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/agendaGmailProfesional', () => ({ notificarCitaGmailProfesional: jest.fn(), notificarReunionGmailProfesional: jest.fn() }));

process.env.AZURE_TENANT_ID = 't'; process.env.AZURE_CLIENT_ID = 'c'; process.env.AZURE_CLIENT_SECRET = 's';

import { importarOcupacionOutlookTodos, MARCA_MANUAL } from '../src/services/importarOcupacionOutlook';
import { sincronizarCitaOutlook } from '../src/services/outlookCalendarService';

// ── Graph simulado ────────────────────────────────────────────────────────────
type Ev = { id: string; subject: string; showAs: string };
let eventosYasica: Ev[] = [];
let buzones: Record<string, Set<string>> = {};
const llamadas: string[] = [];
const resp = (status: number, body?: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body ?? {}) });
global.fetch = jest.fn(async (url: string, init?: { method?: string }) => {
  const metodo = init?.method ?? 'GET';
  if (url.includes('login.microsoftonline.com')) return resp(200, { access_token: 'tok', expires_in: 3600 });
  const path = decodeURIComponent(url.replace('https://graph.microsoft.com/v1.0', ''));
  llamadas.push(`${metodo} ${path.split('?')[0]}`);
  if (path.includes('/calendarView')) {
    return resp(200, { value: eventosYasica.map((e) => ({ ...e, start: { dateTime: '2026-10-02T14:00:00' }, end: { dateTime: '2026-10-02T15:00:00' }, isAllDay: false })) });
  }
  const mm = path.match(/^\/users\/([^/]+)\/events\/([^?]+)/);
  if (mm) {
    const [, buzon, id] = mm;
    const tiene = buzones[buzon!]?.has(id!);
    if (metodo === 'GET') return tiene ? resp(200, { id }) : resp(404, { error: { code: 'ErrorItemNotFound' } });
    if (metodo === 'DELETE') { buzones[buzon!]?.delete(id!); return resp(204); }
  }
  return resp(200, { id: 'NUEVO' });
}) as unknown as typeof fetch;

const YASICA = { id: 'yas', nombres: 'Yasica', apellidos: 'Doy', emailAgenda: 'yasica@limablue.com' };

beforeEach(() => {
  jest.clearAllMocks();
  llamadas.length = 0;
  eventosYasica = [];
  buzones = { 'yasica@limablue.com': new Set() };
  m.profFindMany.mockResolvedValue([YASICA]);
  m.citaFindMany.mockResolvedValue([]);
  m.bloqFindMany.mockResolvedValue([]);
  m.bloqFindFirst.mockResolvedValue(null);
  m.asigFindFirst.mockResolvedValue({ sedeId: 'one' });
  m.auditFindFirst.mockResolvedValue(null);
});

describe('Lectura de Outlook (ocupación → permiso)', () => {
  it('evento «Cita: …» que creó la Agenda → NO se importa (aunque la cita sea de otra podóloga)', async () => {
    eventosYasica = [{ id: 'EV-SONIA', subject: 'Cita: Sonia Maguiña — Limpieza Clínica del Pie', showAs: 'busy' }];
    await importarOcupacionOutlookTodos();
    expect(m.bloqCreate).not.toHaveBeenCalled();
  });

  it('evento con id de una cita (de cualquier profesional) → NO se importa', async () => {
    eventosYasica = [{ id: 'EV-X', subject: 'Algo renombrado', showAs: 'busy' }];
    m.citaFindMany.mockResolvedValue([{ outlookEventId: 'EV-X' }]);
    await importarOcupacionOutlookTodos();
    expect(m.bloqCreate).not.toHaveBeenCalled();
  });

  it('ocupación real de la doctora → SÍ se importa como permiso', async () => {
    eventosYasica = [{ id: 'EV-MED', subject: 'Junta médica', showAs: 'busy' }];
    await importarOcupacionOutlookTodos();
    expect(m.bloqCreate).toHaveBeenCalledTimes(1);
    expect(m.bloqCreate.mock.calls[0][0].data).toMatchObject({ outlookEventId: 'EV-MED', motivo: 'Ocupado (Outlook): Junta médica' });
  });

  it('borrado A MANO en Permisos → no se revive', async () => {
    eventosYasica = [{ id: 'EV-MED', subject: 'Junta médica', showAs: 'busy' }];
    m.bloqFindFirst.mockResolvedValue({ id: 'b1', deletedAt: new Date(), outlookSyncError: MARCA_MANUAL });
    await importarOcupacionOutlookTodos();
    expect(m.bloqUpdate).not.toHaveBeenCalled();
    expect(m.bloqCreate).not.toHaveBeenCalled();
  });

  it('borrado a mano ANTES de la marca (hay auditoría PERMISO_ELIMINADO) → tampoco se revive', async () => {
    eventosYasica = [{ id: 'EV-MED', subject: 'Junta médica', showAs: 'busy' }];
    m.bloqFindFirst.mockResolvedValue({ id: 'b1', deletedAt: new Date(), outlookSyncError: null });
    m.auditFindFirst.mockResolvedValue({ id: 'a1' });
    await importarOcupacionOutlookTodos();
    expect(m.bloqUpdate).not.toHaveBeenCalled();
  });

  it('quitado por la sincronización (evento volvió a «ocupado») → se repone', async () => {
    eventosYasica = [{ id: 'EV-MED', subject: 'Junta médica', showAs: 'busy' }];
    m.bloqFindFirst.mockResolvedValue({ id: 'b1', deletedAt: new Date(), outlookSyncError: 'sync:evento_libre' });
    await importarOcupacionOutlookTodos();
    expect(m.bloqUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b1' }, data: expect.objectContaining({ deletedAt: null }) }));
  });

  it('los bloqueos ya importados de citas de la Agenda se retiran solos (marca de sincronización)', async () => {
    eventosYasica = [{ id: 'EV-SONIA', subject: 'Cita: Sonia Maguiña — Limpieza', showAs: 'busy' }];
    m.bloqFindMany.mockImplementation(async (args: { where: { esReunion?: boolean; deletedAt?: null } }) =>
      args.where.deletedAt === null ? [{ id: 'viejo', outlookEventId: 'EV-SONIA', sedeId: 'one', fechaInicio: new Date('2026-10-01T09:00:00Z') }] : []);
    await importarOcupacionOutlookTodos();
    expect(m.bloqUpdate).toHaveBeenCalledWith({ where: { id: 'viejo' }, data: expect.objectContaining({ outlookSyncError: 'sync:evento_libre' }) });
  });
});

describe('Escritura en Outlook cuando la cita cambia de persona', () => {
  const citaDe = (prof: { nombres: string; apellidos: string; emailAgenda: string | null }, outlookEventId: string | null) => ({
    id: 'c1', outlookEventId, outlookSyncError: null, fecha: new Date('2026-10-01T00:00:00Z'), horaInicio: '09:00', duracionMinutos: 60,
    profesional: { id: 'p', ...prof }, solicitadoProfesional: null,
    paciente: { nombres: 'Sonia', apellidoPaterno: 'Maguiña' }, sede: { nombre: 'One' }, servicio: { nombre: 'Limpieza' },
  });

  it('pasó de Yasica a Doris (sin Outlook) → se borra el evento del Outlook de Yasica y se olvida el id', async () => {
    buzones['yasica@limablue.com']!.add('EV-SONIA');
    m.citaFindUnique.mockResolvedValueOnce(citaDe({ nombres: 'Doris', apellidos: 'Marquina', emailAgenda: null }, 'EV-SONIA'))
      .mockResolvedValueOnce({ outlookEventId: null });
    await sincronizarCitaOutlook('actualizar', 'c1');
    expect(llamadas).toContain('DELETE /users/yasica@limablue.com/events/EV-SONIA');
    expect(buzones['yasica@limablue.com']!.has('EV-SONIA')).toBe(false);
    expect(m.citaUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { outlookEventId: null } });
  });

  it('sigue siendo de Yasica → no se borra nada (solo se actualiza)', async () => {
    buzones['yasica@limablue.com']!.add('EV-OK');
    m.citaFindUnique.mockResolvedValueOnce(citaDe(YASICA, 'EV-OK')).mockResolvedValueOnce({ outlookEventId: 'EV-OK' });
    await sincronizarCitaOutlook('actualizar', 'c1');
    expect(llamadas.some((l) => l.startsWith('DELETE'))).toBe(false);
    expect(buzones['yasica@limablue.com']!.has('EV-OK')).toBe(true);
  });
});
