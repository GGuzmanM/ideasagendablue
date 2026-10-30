/**
 * Horarios del Personal › Ajustes por fecha: quién pertenece a la sede cada día de la semana (30-oct-2026).
 * Regresión: con un movimiento FUTURO la podóloga desaparecía de su sede actual (su asignación queda activa=false) y no
 * aparecía en la nueva en la semana en que llegaba (la pantalla miraba solo la asignación activa de HOY).
 */
import { cubreDia, estadoEnDia, type AsignacionRango } from '../src/services/personalSemana';

const d = (s: string) => new Date(`${s}T12:00:00.000Z`);
const asig = (sedeId: string, ini: string, fin: string | null): AsignacionRango => ({ sedeId, sedeNombre: `Sede ${sedeId}`, fechaInicio: d(ini), fechaFin: fin ? d(fin) : null });

describe('cubreDia', () => {
  it('incluye el primer y el último día del rango', () => {
    const a = asig('A', '2026-10-26', '2026-11-01');
    expect(cubreDia(a, '2026-10-26')).toBe(true);
    expect(cubreDia(a, '2026-11-01')).toBe(true);
    expect(cubreDia(a, '2026-10-25')).toBe(false);
    expect(cubreDia(a, '2026-11-02')).toBe(false);
  });
  it('sin fecha fin es indefinida', () => {
    expect(cubreDia(asig('A', '2026-01-01', null), '2030-05-05')).toBe(true);
  });
});

describe('estadoEnDia — movimiento a mitad de semana', () => {
  // Lunes 26 a miércoles 28 en A; desde el jueves 29 en B (el movimiento dejó la de A con fechaFin = inicio-1).
  const lista = [asig('A', '2026-01-01', '2026-10-28'), asig('B', '2026-10-29', null)];
  const semana = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];

  it('en su sede de origen cuenta solo hasta el día anterior al movimiento', () => {
    expect(semana.map((f) => estadoEnDia(lista, 'A', f).enSede)).toEqual([true, true, true, false, false]);
  });
  it('en la sede nueva cuenta desde el primer día del movimiento', () => {
    expect(semana.map((f) => estadoEnDia(lista, 'B', f).enSede)).toEqual([false, false, false, true, true]);
  });
  it('los días que no es de la sede dice en cuál está', () => {
    expect(estadoEnDia(lista, 'A', '2026-10-29')).toEqual({ enSede: false, sedeOtra: 'Sede B' });
    expect(estadoEnDia(lista, 'B', '2026-10-27')).toEqual({ enSede: false, sedeOtra: 'Sede A' });
  });
});

describe('estadoEnDia — otros casos', () => {
  it('movimiento temporal con retorno: vuelve a su sede al terminar', () => {
    const lista = [asig('A', '2026-01-01', '2026-10-27'), asig('B', '2026-10-28', '2026-10-29'), asig('A', '2026-10-30', null)];
    expect(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((f) => estadoEnDia(lista, 'A', f).enSede)).toEqual([true, false, false, true]);
  });
  it('una cobertura de un día en otra sede cuenta ese día en esa sede', () => {
    const lista = [asig('A', '2026-01-01', null), asig('B', '2026-10-28', '2026-10-28')];
    expect(estadoEnDia(lista, 'B', '2026-10-28').enSede).toBe(true);
    expect(estadoEnDia(lista, 'B', '2026-10-29').enSede).toBe(false);
  });
  it('sin ninguna asignación ese día: no es de la sede y no hay otra', () => {
    expect(estadoEnDia([], 'A', '2026-10-28')).toEqual({ enSede: false, sedeOtra: null });
  });
});
