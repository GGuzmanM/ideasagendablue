import { armarSinRetorno, rangoDe } from '../src/services/sinRetornoService';

describe('pacientes sin retorno', () => {
  it('rangos de días', () => {
    expect([0, 1, 7, 8, 14, 15, 21, 22, 31, 32, 90].map(rangoDe)).toEqual([null, '1-7', '1-7', '8-14', '8-14', '15-21', '15-21', '22-31', '22-31', '32+', '32+']);
  });
  it('separa sin retorno, retornaron y recién atendidos', () => {
    const hoy = '2026-11-18';
    const u = (p: string, f: string, s = 'prof') => ({ pacienteId: p, fecha: f, servicioId: s, sedeId: 'one' });
    const r = armarSinRetorno(hoy, [u('a', '2026-11-18'), u('b', '2026-11-15'), u('c', '2026-11-10', 'pisada'), u('d', '2026-11-10'), u('e', '2026-09-01')], new Set(['d']));
    expect(r.recienAtendidos).toBe(1);
    expect(r.porRango['1-7']).toEqual({ sinRetorno: 1, retornaron: 0 });
    expect(r.porRango['8-14']).toEqual({ sinRetorno: 1, retornaron: 1 });
    expect(r.porRango['32+']).toEqual({ sinRetorno: 1, retornaron: 0 });
    expect(r.porServicio.get('prof')?.['1-7']).toBe(1);
    expect(r.porServicio.get('pisada')?.['8-14']).toBe(1);
    expect(r.porSede.get('one')?.['32+']).toBe(1);
  });
});
