/**
 * Médico auditor — todas las sedes (28-oct-2026): ve y opera cualquier sede; el médico común sigue limitado a las suyas.
 */
import type { Request } from 'express';
import { assertSede, puedeTodasLasSedes, sedeAutorizada, type AuthPayload } from '../src/middleware/auth';

jest.mock('../src/db', () => ({ prisma: {} }));

const SEDE_A = '11111111-1111-1111-1111-111111111111';
const SEDE_B = '22222222-2222-2222-2222-222222222222';
const usuario = (rol: string, sedes: string[] = [SEDE_A]) => ({ userId: 'u1', rol, sedes, permisos: [] }) as unknown as AuthPayload;

describe('Acceso a sedes del médico auditor', () => {
  it('el auditor ve todas las sedes aunque tenga solo una asignada', () => {
    expect(puedeTodasLasSedes(usuario('medico_auditor'))).toBe(true);
    expect(sedeAutorizada(usuario('medico_auditor'), SEDE_B)).toBe(true);
    expect(() => assertSede({ user: usuario('medico_auditor') } as unknown as Request, SEDE_B)).not.toThrow();
  });

  it('el médico común sigue limitado a su sede', () => {
    expect(puedeTodasLasSedes(usuario('medico'))).toBe(false);
    expect(sedeAutorizada(usuario('medico'), SEDE_B)).toBe(false);
    expect(() => assertSede({ user: usuario('medico') } as unknown as Request, SEDE_B)).toThrow(expect.objectContaining({ code: 'SEDE_NO_AUTORIZADA', statusCode: 403 }));
  });
});
