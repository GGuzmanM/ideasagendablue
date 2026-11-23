// Llave de SOLO LECTURA (21-nov-2026): solo GET /api/v1/profesionales y /api/v1/sedes; el resto → 403 SOLO_LECTURA.
import type { Request, Response } from 'express';

const apiKeys = [
  { id: 'lec', keyHash: 'h:lbro_x', scopes: ['profesionales:read'] },
  { id: 'web', keyHash: 'h:lbweb_x', scopes: ['reservas:write'] },
];
jest.mock('../src/db', () => ({
  prisma: { apiKey: { findMany: jest.fn(async () => apiKeys), update: jest.fn(async () => ({})) } },
}));
jest.mock('bcryptjs', () => ({ compare: jest.fn(async (raw: string, hash: string) => hash === `h:${raw}`) }));

import { requireAuth, lecturaPermitida } from '../src/middleware/auth';

const req = (llave: string, method: string, baseUrl: string, path = '/') =>
  ({ headers: { authorization: `ApiKey ${llave}` }, method, baseUrl, path } as unknown as Request);

async function pasar(r: Request): Promise<{ ok: boolean; code?: string; apiKey?: unknown }> {
  try {
    let ok = false;
    await requireAuth(r, {} as Response, () => { ok = true; });
    return { ok, apiKey: (r as Request & { apiKey?: unknown }).apiKey };
  } catch (e) {
    return { ok: false, code: (e as { code?: string }).code };
  }
}

describe('llave de solo lectura', () => {
  it('lecturaPermitida: solo GET de las listas permitidas', () => {
    expect(lecturaPermitida({ method: 'GET', baseUrl: '/api/v1/profesionales', path: '/' })).toBe(true);
    expect(lecturaPermitida({ method: 'GET', baseUrl: '/api/v1/sedes', path: '/' })).toBe(true);
    expect(lecturaPermitida({ method: 'GET', baseUrl: '/api/v1/profesionales', path: '/abc/horario' })).toBe(false);
    expect(lecturaPermitida({ method: 'POST', baseUrl: '/api/v1/profesionales', path: '/' })).toBe(false);
    expect(lecturaPermitida({ method: 'GET', baseUrl: '/api/v1/citas', path: '/' })).toBe(false);
    expect(lecturaPermitida({ method: 'GET', baseUrl: '/api/v1/pacientes', path: '/buscar' })).toBe(false);
  });

  it('pasa en GET /profesionales y /sedes', async () => {
    expect((await pasar(req('lbro_x', 'GET', '/api/v1/profesionales'))).ok).toBe(true);
    expect((await pasar(req('lbro_x', 'GET', '/api/v1/sedes'))).ok).toBe(true);
  });

  it('se frena en cualquier otra ruta o método', async () => {
    for (const r of [
      req('lbro_x', 'GET', '/api/v1/citas'),
      req('lbro_x', 'POST', '/api/v1/citas'),
      req('lbro_x', 'GET', '/api/v1/integraciones/whatsapp', '/catalogo'),
      req('lbro_x', 'POST', '/api/v1/mcp'),
      req('lbro_x', 'PATCH', '/api/v1/profesionales', '/'),
    ]) {
      const res = await pasar(r);
      expect(res).toEqual({ ok: false, code: 'SOLO_LECTURA' });
    }
  });

  it('las demás llaves no cambian', async () => {
    expect((await pasar(req('lbweb_x', 'GET', '/api/v1/citas'))).ok).toBe(true);
  });
});
