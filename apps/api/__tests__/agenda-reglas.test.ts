/**
 * Auditoría de la Agenda (18-sep-2026): reglas puras que quedaron fijadas al corregir los bugs.
 *  - Estado al mover: el mismo día conserva «Llegó»/«En atención»; otro día vuelve a «Agendada».
 *  - Auditoría del alta: solo campos legibles (nada de id/idempotencyKey/nulos/comprobantes).
 *  - Cambio de estado con acción propia (`cancelar_por_paciente`) y motivo en la auditoría de la
 *    cita y de su hermana del bloque.
 */
const tx = {
  cita: { updateMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
jest.mock('../src/db', () => ({
  prisma: {
    cita: { findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  },
}));
jest.mock('../src/redis', () => ({ invalidateDisponibilidadCache: jest.fn() }));
jest.mock('../src/socket', () => ({ emitirEventoCita: jest.fn() }));
jest.mock('../src/services/webhooks', () => ({ dispararWebhooks: jest.fn() }));
jest.mock('../src/services/agregacion', () => ({ agregarRango: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/outlookCalendarService', () => ({ sincronizarCitaOutlook: jest.fn() }));
jest.mock('../src/services/recordatorioService', () => ({ cancelarRecordatoriosDeCita: jest.fn() }));
jest.mock('../src/services/videoEnvioService', () => ({ cancelarVideosDeCita: jest.fn() }));
jest.mock('../src/services/paqueteSesionService', () => ({ sincronizarSesionPaquete: jest.fn() }));
jest.mock('../src/services/historiaClinicaService', () => ({ assertSinAtencionClinica: jest.fn() }));
jest.mock('../src/services/citaCompleta', () => ({
  getCitaCompleta: jest.fn(async (id: string) => ({ id })),
  crearComentarioEnTx: jest.fn(),
}));

import { estadoAlMover, citaParaAuditoria } from '../src/services/agendaReglas';
import { cambiarEstadoCita } from '../src/services/estadoCitaService';
import { fechaDb } from '../src/utils/fechaLima';

const { prisma } = require('../src/db');

const DIA = fechaDb('2026-09-22');

describe('Estado al mover una cita', () => {
  it('el mismo día conserva «Llegó» y «En atención» (no se pierde la marca de llegada)', () => {
    expect(estadoAlMover({ estado: 'llego', fecha: DIA }, '2026-09-22')).toBe('llego');
    expect(estadoAlMover({ estado: 'en_atencion', fecha: DIA }, '2026-09-22')).toBe('en_atencion');
  });
  it('a otro día vuelve a «Agendada» (la paciente no ha llegado a esa nueva cita)', () => {
    expect(estadoAlMover({ estado: 'llego', fecha: DIA }, '2026-09-23')).toBe('agendada');
    expect(estadoAlMover({ estado: 'agendada', fecha: DIA }, '2026-09-23')).toBe('agendada');
  });
  it('confirmada y completada se conservan siempre (reprogramar una atendida es de coordinación)', () => {
    expect(estadoAlMover({ estado: 'confirmada', fecha: DIA }, '2026-09-23')).toBe('confirmada');
    expect(estadoAlMover({ estado: 'completada', fecha: DIA }, '2026-09-30')).toBe('completada');
  });
});

describe('Auditoría del alta de una cita', () => {
  const fila = {
    id: 'c1', idempotencyKey: 'k', deletedAt: null, comprobanteUrl: '/x.pdf', llegoEn: null,
    pacienteId: 'p1', profesionalId: 'pr1', solicitadoProfesionalId: null, medicoId: null,
    sedeId: 's1', unidadNegocioId: 'u1', servicioId: 'sv1', subcategoriaId: 'sub1',
    fecha: DIA, horaInicio: '10:00', duracionMinutos: 60, estado: 'agendada', canal: 'recepcion',
    origenAsignacion: 'elegida_por_paciente', promocionId: null, paquetePacienteId: 'pp1', sesionNumero: 3,
    slotGrupoId: null, slotRol: null, consultorioNumero: null,
  };
  it('guarda solo lo legible: quién, qué, cuándo, con quién, canal, sesión', () => {
    const a = citaParaAuditoria(fila);
    expect(a).toEqual({
      pacienteId: 'p1', servicioId: 'sv1', subcategoriaId: 'sub1', fecha: '2026-09-22', horaInicio: '10:00',
      duracionMinutos: 60, profesionalId: 'pr1', sedeId: 's1', unidadNegocioId: 'u1', estado: 'agendada',
      canal: 'recepcion', origenAsignacion: 'elegida_por_paciente', paquetePacienteId: 'pp1', sesionNumero: 3,
    });
    expect(a).not.toHaveProperty('id');
    expect(a).not.toHaveProperty('idempotencyKey');
    expect(a).not.toHaveProperty('comprobanteUrl');
  });
  it('en un bloque combinado agrega el bloque y el rol', () => {
    const a = citaParaAuditoria({ ...fila, slotGrupoId: 'g1', slotRol: 'SECUNDARIO', paquetePacienteId: null, subcategoriaId: null });
    expect(a).toMatchObject({ slotGrupoId: 'g1', slotRol: 'SECUNDARIO' });
    expect(a).not.toHaveProperty('paquetePacienteId');
    expect(a).not.toHaveProperty('subcategoriaId');
  });
});

describe('Cambio de estado con acción propia (cancelación del paciente desde el correo)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tx.cita.updateMany.mockResolvedValue({ count: 1 });
  });
  it('audita la cita y su hermana con la acción del actor y el motivo de cancelación', async () => {
    prisma.cita.findUnique.mockResolvedValue({ id: 'c1', sedeId: 's1', fecha: DIA, estado: 'agendada', slotGrupoId: 'g1', motivoCancelacion: null });
    prisma.cita.findMany.mockResolvedValue([{ id: 'c2', sedeId: 's1', fecha: DIA, estado: 'confirmada', slotGrupoId: 'g1', motivoCancelacion: null }]);
    await cambiarEstadoCita(
      { citaId: 'c1', estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente desde el correo' },
      { cambiadoPor: 'paciente', accion: 'cancelar_por_paciente', auditExtra: { origen: 'correo_paciente' } },
    );
    const audits = tx.auditLog.create.mock.calls.map((c) => c[0].data);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ accion: 'cancelar_por_paciente', entidadId: 'c1', usuarioId: undefined, despues: { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente desde el correo', origen: 'correo_paciente' } });
    expect(audits[1]).toMatchObject({ accion: 'cancelar_por_paciente', entidadId: 'c2', despues: { estado: 'cancelada', motivoCancelacion: 'Cancelada por el paciente desde el correo', cascada: true } });
    // La cita y la hermana se escriben con el motivo.
    expect(tx.cita.updateMany.mock.calls[0][0].data.motivoCancelacion).toBe('Cancelada por el paciente desde el correo');
    expect(tx.cita.updateMany.mock.calls[1][0].data.motivoCancelacion).toBe('Cancelada por el paciente desde el correo');
  });
  it('sin acción propia sigue auditando como cambiar_estado', async () => {
    prisma.cita.findUnique.mockResolvedValue({ id: 'c1', sedeId: 's1', fecha: DIA, estado: 'agendada', slotGrupoId: null, motivoCancelacion: null });
    await cambiarEstadoCita({ citaId: 'c1', estado: 'confirmada' }, { usuarioId: 'u1', cambiadoPor: 'u1' });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ accion: 'cambiar_estado', usuarioId: 'u1', antes: { estado: 'agendada' }, despues: { estado: 'confirmada' } });
  });
});
