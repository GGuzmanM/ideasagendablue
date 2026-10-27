/**
 * Eliminar constancias (26-oct-2026): solo administración, borrado lógico con motivo, queda en la auditoría.
 */
const prismaMock: any = {
  constanciaClinica: { findUnique: jest.fn(), updateMany: jest.fn() },
  $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaMock)),
};
jest.mock('../src/db', () => ({ prisma: prismaMock }));
const auditEnTx = jest.fn();
jest.mock('../src/services/audit', () => ({ auditEnTx: (...a: unknown[]) => auditEnTx(...a) }));
jest.mock('../src/services/recetaService', () => ({ asegurarMedicoPrescriptor: jest.fn(), asegurarFirmanteReceta: jest.fn(), codigoVerificacion: jest.fn() }));
jest.mock('../src/services/historiaClinicaService', () => ({ etiquetaUsuario: jest.fn() }));
jest.mock('../src/services/pdfComun', () => ({ CLINICA: { nombre: 'Limablue' } }));

import { eliminarConstancia } from '../src/services/constanciaService';

const admin: any = { userId: 'u-admin', rol: 'admin', sedes: [], permisos: [] };
const coord: any = { userId: 'u-coord', rol: 'coordinadora_sedes', sedes: [], permisos: ['hc.anular', 'hc.registrar'] };
const CONSTANCIA = {
  id: 'c1', numero: 123, tipo: 'constancia_atencion', estado: 'emitida', sedeId: 's1', fechaEmision: new Date('2026-10-20T15:00:00Z'),
  emisorNombre: 'Dr. Prueba', codigoVerificacion: 'ABCDEFGH23', deletedAt: null, atencion: { citaId: 'cita1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.constanciaClinica.findUnique.mockResolvedValue(CONSTANCIA);
  prismaMock.constanciaClinica.updateMany.mockResolvedValue({ count: 1 });
});

describe('eliminarConstancia', () => {
  it('solo administración: cualquier otro rol (aunque pueda anular) recibe 403 y no toca la base', async () => {
    await expect(eliminarConstancia({ user: coord, id: 'c1', motivo: 'emitida por error', usuarioId: coord.userId })).rejects.toMatchObject({ statusCode: 403, code: 'SIN_PERMISO' });
    expect(prismaMock.constanciaClinica.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.constanciaClinica.updateMany).not.toHaveBeenCalled();
  });

  it('exige un motivo de al menos 5 caracteres', async () => {
    await expect(eliminarConstancia({ user: admin, id: 'c1', motivo: '  no ', usuarioId: admin.userId })).rejects.toMatchObject({ statusCode: 400, code: 'MOTIVO_REQUERIDO' });
    expect(prismaMock.constanciaClinica.updateMany).not.toHaveBeenCalled();
  });

  it('una constancia inexistente o ya eliminada responde 404', async () => {
    prismaMock.constanciaClinica.findUnique.mockResolvedValueOnce(null);
    await expect(eliminarConstancia({ user: admin, id: 'x', motivo: 'emitida por error', usuarioId: admin.userId })).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.constanciaClinica.findUnique.mockResolvedValueOnce({ ...CONSTANCIA, deletedAt: new Date() });
    await expect(eliminarConstancia({ user: admin, id: 'c1', motivo: 'emitida por error', usuarioId: admin.userId })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.constanciaClinica.updateMany).not.toHaveBeenCalled();
  });

  it('administración: borrado lógico (no borra la fila) y deja la auditoría con lo que era', async () => {
    await eliminarConstancia({ user: admin, id: 'c1', motivo: '  Emitida por error  ', usuarioId: admin.userId, ip: '10.0.0.5' });
    const arg = prismaMock.constanciaClinica.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1', deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(arg.data.eliminadaPorUsuarioId).toBe('u-admin');
    expect(arg.data.motivoEliminacion).toBe('Emitida por error');
    expect(auditEnTx).toHaveBeenCalledTimes(1);
    const aud = auditEnTx.mock.calls[0][1];
    expect(aud).toMatchObject({ accion: 'eliminar_constancia', entidad: 'constancia', entidadId: 'c1', sedeId: 's1', citaId: 'cita1', usuarioId: 'u-admin' });
    expect(aud.antes).toMatchObject({ numero: 123, tipo: 'constancia_atencion', estado: 'emitida', codigoVerificacion: 'ABCDEFGH23' });
    expect(aud.despues).toEqual({ eliminada: true, motivo: 'Emitida por error' });
  });

  it('si otra persona la eliminó a la vez (0 filas), no deja auditoría duplicada', async () => {
    prismaMock.constanciaClinica.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(eliminarConstancia({ user: admin, id: 'c1', motivo: 'emitida por error', usuarioId: admin.userId })).rejects.toMatchObject({ statusCode: 404 });
    expect(auditEnTx).not.toHaveBeenCalled();
  });
});
