/**
 * Caracterización del cambio de estado de una cita (services/estadoCitaService.ts).
 * Fija el comportamiento que tenía la ruta PATCH /citas/:id/estado antes del refactor:
 * máquina de estados, cascada del bloque combinado (salvo soloEsta), anclas de tiempo y efectos
 * por estado; más la escritura con guarda nueva (409 ESTADO_CAMBIADO).
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

import {
  validarTransicion, hermanasQueAcompanan, anclasDeTiempo, cambiarEstadoCita, ActorCambio,
} from '../src/services/estadoCitaService';

const { prisma } = require('../src/db');
const { dispararWebhooks } = require('../src/services/webhooks');
const { sincronizarSesionPaquete } = require('../src/services/paqueteSesionService');
const { sincronizarCitaOutlook } = require('../src/services/outlookCalendarService');
const { cancelarRecordatoriosDeCita } = require('../src/services/recordatorioService');
const { invalidateDisponibilidadCache } = require('../src/redis');
const { assertSinAtencionClinica } = require('../src/services/historiaClinicaService');
const { emitirEventoCita } = require('../src/socket');
const { crearComentarioEnTx } = require('../src/services/citaCompleta');

const FECHA = new Date('2026-09-14T12:00:00.000Z');
function cita(extra: Record<string, unknown> = {}) {
  return {
    id: 'c1', sedeId: 's1', fecha: FECHA, estado: 'llego', slotGrupoId: null, slotRol: null,
    motivoCancelacion: null, ...extra,
  };
}
const actor: ActorCambio = { usuarioId: 'u1', permisos: ['citas.estado'], cambiadoPor: 'u1' };

beforeEach(() => {
  jest.clearAllMocks();
  tx.cita.updateMany.mockResolvedValue({ count: 1 });
  prisma.cita.findMany.mockResolvedValue([]);
});

describe('Máquina de estados', () => {
  it('permite los pasos normales y el mismo estado (solo comentar)', () => {
    expect(() => validarTransicion('agendada', 'llego')).not.toThrow();
    expect(() => validarTransicion('llego', 'en_atencion')).not.toThrow();
    expect(() => validarTransicion('en_atencion', 'completada')).not.toThrow();
    expect(() => validarTransicion('completada', 'completada')).not.toThrow();
  });
  it('rechaza saltos inválidos con TRANSICION_INVALIDA', () => {
    expect(() => validarTransicion('agendada', 'completada')).toThrow(expect.objectContaining({ code: 'TRANSICION_INVALIDA' }));
    expect(() => validarTransicion('cancelada', 'llego')).toThrow(expect.objectContaining({ code: 'TRANSICION_INVALIDA' }));
  });
  it('revertir una atendida exige citas.revertir', () => {
    expect(() => validarTransicion('completada', 'en_atencion', ['citas.estado'])).toThrow(expect.objectContaining({ code: 'REVERSA_NO_PERMITIDA' }));
    expect(() => validarTransicion('completada', 'en_atencion', ['citas.revertir'])).not.toThrow();
  });
});

describe('Cascada del bloque combinado', () => {
  it('no resucita canceladas ni no-show, no salta pasos y al cancelar respeta las finalizadas', () => {
    const hs = [{ id: 'a', estado: 'en_atencion' }, { id: 'b', estado: 'cancelada' }, { id: 'c', estado: 'agendada' }, { id: 'd', estado: 'no_show' }, { id: 'e', estado: 'completada' }];
    expect(hermanasQueAcompanan(hs, 'completada').map((h) => h.id)).toEqual(['a']);
    expect(hermanasQueAcompanan(hs, 'cancelada').map((h) => h.id)).toEqual(['a', 'c']);
  });
  it('revertir el bloque arrastra a la hermana completada (completada → en_atencion es válida)', () => {
    const hs = [{ id: 'a', estado: 'completada' }, { id: 'b', estado: 'no_show' }];
    expect(hermanasQueAcompanan(hs, 'en_atencion').map((h) => h.id)).toEqual(['a']);
  });
});

describe('Anclas de tiempo', () => {
  const h = new Date('2026-09-14T15:30:00.000Z');
  it('sella la hora del evento según el estado destino', () => {
    expect(anclasDeTiempo('confirmada', 'llego', h)).toEqual({ llegoEn: h });
    expect(anclasDeTiempo('llego', 'en_atencion', h)).toEqual({ enAtencionEn: h });
    expect(anclasDeTiempo('en_atencion', 'completada', h)).toEqual({ completadaEn: h });
  });
  it('revertir reinicia llegada y atención y limpia completadaEn; mismo estado no toca nada', () => {
    expect(anclasDeTiempo('completada', 'en_atencion', h)).toEqual({ llegoEn: h, enAtencionEn: h, completadaEn: null });
    expect(anclasDeTiempo('en_atencion', 'en_atencion', h)).toEqual({});
  });
});

describe('cambiarEstadoCita', () => {
  it('completar: escribe con guarda, sincroniza la sesión, emite y dispara el webhook una vez', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'en_atencion' }));
    const hora = new Date('2026-09-14T16:00:00.000Z');
    await cambiarEstadoCita({ citaId: 'c1', estado: 'completada', hora }, actor);
    expect(tx.cita.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', estado: 'en_atencion', deletedAt: null },
      data: expect.objectContaining({ estado: 'completada', completadaEn: hora }),
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(sincronizarSesionPaquete).toHaveBeenCalledWith('c1');
    expect(dispararWebhooks).toHaveBeenCalledTimes(1);
    expect(dispararWebhooks).toHaveBeenCalledWith('appointment.completed', 's1', { id: 'c1' });
    expect(emitirEventoCita).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'cita:estadoCambiado', cambiadoPor: 'u1' }));
  });

  it('si otro actor cambió la cita entre la lectura y la escritura → 409 ESTADO_CAMBIADO y sin efectos', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'en_atencion' }));
    tx.cita.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(cambiarEstadoCita({ citaId: 'c1', estado: 'completada' }, actor))
      .rejects.toMatchObject({ statusCode: 409, code: 'ESTADO_CAMBIADO' });
    expect(sincronizarSesionPaquete).not.toHaveBeenCalled();
    expect(dispararWebhooks).not.toHaveBeenCalled();
  });

  it('re-enviar el mismo estado sin comentario no escribe ni re-dispara webhooks', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'completada' }));
    await cambiarEstadoCita({ citaId: 'c1', estado: 'completada' }, actor);
    expect(tx.cita.updateMany).not.toHaveBeenCalled();
    expect(dispararWebhooks).not.toHaveBeenCalled();
  });

  it('mismo estado con comentario: agrega la entrada al hilo', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'llego' }));
    await cambiarEstadoCita({ citaId: 'c1', estado: 'llego', comentario: '  pasó al baño ' }, actor);
    expect(crearComentarioEnTx).toHaveBeenCalledWith(tx, expect.objectContaining({ texto: 'pasó al baño' }));
    expect(dispararWebhooks).not.toHaveBeenCalled();
  });

  it('bloque combinado: cascadea a la hermana; con soloEsta avanza solo esta cita', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ slotGrupoId: 'g1', slotRol: 'PRINCIPAL' }));
    prisma.cita.findMany.mockResolvedValue([cita({ id: 'c2', slotGrupoId: 'g1', slotRol: 'SECUNDARIO' })]);
    await cambiarEstadoCita({ citaId: 'c1', estado: 'en_atencion' }, actor);
    expect(tx.cita.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.cita.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 'c2', estado: 'llego', deletedAt: null } }));
    expect(sincronizarSesionPaquete).toHaveBeenCalledWith('c2');

    jest.clearAllMocks();
    tx.cita.updateMany.mockResolvedValue({ count: 1 });
    await cambiarEstadoCita({ citaId: 'c1', estado: 'en_atencion', soloEsta: true }, actor);
    expect(prisma.cita.findMany).not.toHaveBeenCalled();
    expect(tx.cita.updateMany).toHaveBeenCalledTimes(1);
  });

  it('una hermana que cambió mientras tanto se deja como está', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ slotGrupoId: 'g1', slotRol: 'PRINCIPAL' }));
    prisma.cita.findMany.mockResolvedValue([cita({ id: 'c2', slotGrupoId: 'g1', slotRol: 'SECUNDARIO' })]);
    tx.cita.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await cambiarEstadoCita({ citaId: 'c1', estado: 'en_atencion' }, actor);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(sincronizarSesionPaquete).not.toHaveBeenCalledWith('c2');
  });

  it('cancelar: consulta la HC, cancela Outlook y recordatorios y libera el horario', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'agendada' }));
    await cambiarEstadoCita({ citaId: 'c1', estado: 'cancelada', motivoCancelacion: 'viaje' }, actor);
    expect(assertSinAtencionClinica).toHaveBeenCalledWith('c1');
    expect(tx.cita.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ motivoCancelacion: 'viaje' }) }));
    expect(sincronizarCitaOutlook).toHaveBeenCalledWith('cancelar', 'c1');
    expect(cancelarRecordatoriosDeCita).toHaveBeenCalledWith('c1');
    expect(invalidateDisponibilidadCache).toHaveBeenCalledWith('s1', '2026-09-14');
    expect(dispararWebhooks).toHaveBeenCalledWith('appointment.cancelled', 's1', { id: 'c1' });
  });

  it('el audit lleva los datos extra del actor (origen del aparato)', async () => {
    prisma.cita.findUnique.mockResolvedValue(cita({ estado: 'llego' }));
    await cambiarEstadoCita({ citaId: 'c1', estado: 'en_atencion' },
      { usuarioId: null, cambiadoPor: 'dispositivo:C3', auditExtra: { origen: 'dispositivo', dispositivo: 'C3' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ despues: { estado: 'en_atencion', origen: 'dispositivo', dispositivo: 'C3' } }) });
    expect(emitirEventoCita).toHaveBeenCalledWith(expect.objectContaining({ cambiadoPor: 'dispositivo:C3' }));
  });
});
