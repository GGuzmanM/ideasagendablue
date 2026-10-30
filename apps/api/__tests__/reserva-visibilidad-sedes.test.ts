/**
 * Reserva web: en qué sedes se ofrece un servicio (30-oct-2026). Es la regla que comparten el catálogo público/chat y la
 * pantalla de administración: sede visible en la web Y servicio no oculto en esa sede.
 */
import { sedesQueOfrecen, claveOculta } from '../src/services/reservaWeb/visibilidad';

const sede = (id: string, reservaWeb = true) => ({ id, reservaWeb });
const ninguna = new Set<string>();

describe('sedesQueOfrecen', () => {
  it('sin nada oculto se ofrece en todas las sedes visibles, en su orden', () => {
    expect(sedesQueOfrecen([sede('A'), sede('B'), sede('C')], ninguna)).toEqual(['A', 'B', 'C']);
  });

  it('una sede apagada en la web no ofrece ningún servicio', () => {
    expect(sedesQueOfrecen([sede('A'), sede('B', false), sede('C')], ninguna)).toEqual(['A', 'C']);
  });

  it('un servicio oculto en una sede no se ofrece ahí, pero sí en las demás', () => {
    expect(sedesQueOfrecen([sede('A'), sede('B'), sede('C')], new Set(['B']))).toEqual(['A', 'C']);
  });

  it('sede apagada + servicio oculto en otra: quedan solo las que cumplen ambas', () => {
    expect(sedesQueOfrecen([sede('A', false), sede('B'), sede('C')], new Set(['C']))).toEqual(['B']);
  });

  it('todas ocultas o apagadas → no se ofrece en ninguna', () => {
    expect(sedesQueOfrecen([sede('A'), sede('B')], new Set(['A', 'B']))).toEqual([]);
    expect(sedesQueOfrecen([sede('A', false)], ninguna)).toEqual([]);
  });

  it('una sede del área que no está en la lista de sedes no se inventa', () => {
    expect(sedesQueOfrecen([], new Set(['A']))).toEqual([]);
  });
});

describe('claveOculta', () => {
  it('distingue el mismo servicio en distintas sedes y viceversa', () => {
    expect(claveOculta('s1', 'A')).not.toBe(claveOculta('s1', 'B'));
    expect(claveOculta('s1', 'A')).not.toBe(claveOculta('s2', 'A'));
  });
});
