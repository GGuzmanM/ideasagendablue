/**
 * Visor de Pacientes — «Todas las sedes» (23-oct-2026): solo administración y el auditor de médicos pueden pedir el visor
 * (y su Excel) sin sede; el resto debe elegir una sede que pueda operar.
 */
import type { Request } from 'express';
import { filtroSedeVisor, puedeTodasSedesVisor } from '../src/utils/rangoVisor';

jest.mock('../src/db', () => ({ prisma: {} }));

const SEDE_A = '11111111-1111-1111-1111-111111111111';
const SEDE_B = '22222222-2222-2222-2222-222222222222';
const req = (rol: string, sedes: string[] = [SEDE_A]) => ({ user: { userId: 'u1', rol, sedes, permisos: [] } }) as unknown as Request;

describe('Visor: todas las sedes', () => {
  it('administración y el auditor de médicos pueden ver todas las sedes', () => {
    expect(puedeTodasSedesVisor(req('admin'))).toBe(true);
    expect(puedeTodasSedesVisor(req('medico_auditor'))).toBe(true);
    expect(puedeTodasSedesVisor(req('recepcionista'))).toBe(false);
    expect(puedeTodasSedesVisor(req('medico'))).toBe(false);
  });

  it('sin sede: todas (undefined) para admin y auditor; los demás deben elegir una', () => {
    expect(filtroSedeVisor(req('admin'))).toBeUndefined();
    expect(filtroSedeVisor(req('medico_auditor'), null)).toBeUndefined();
    expect(() => filtroSedeVisor(req('medico'))).toThrow(expect.objectContaining({ code: 'SEDE_REQUERIDA', statusCode: 400 }));
  });

  it('con sede: la devuelve si el usuario la puede operar y rechaza otra', () => {
    expect(filtroSedeVisor(req('medico', [SEDE_A]), SEDE_A)).toBe(SEDE_A);
    expect(() => filtroSedeVisor(req('medico', [SEDE_A]), SEDE_B)).toThrow(expect.objectContaining({ code: 'SEDE_NO_AUTORIZADA', statusCode: 403 }));
  });
});
