/**
 * Reserva web: precio por SEDE (30-oct-2026). El orden de precedencia es el contrato que comparten el catálogo, la reserva
 * (monto que se cobra en la sede) y la pantalla de administración.
 */
import { precioWebEnSede } from '../src/services/reservaWeb/precios';

const servicio = { servicioWeb: null, servicioReferencial: null, servicioSede: null };

describe('Precio web por sede', () => {
  it('servicio sin tipos: sede > web general > referencial', () => {
    expect(precioWebEnSede({ servicioWeb: 80, servicioReferencial: 100, servicioSede: 70 })).toBe(70);
    expect(precioWebEnSede({ servicioWeb: 80, servicioReferencial: 100, servicioSede: null })).toBe(80);
    expect(precioWebEnSede({ servicioWeb: null, servicioReferencial: 100, servicioSede: null })).toBe(100);
  });

  it('sin ningún precio no se ofrece (null)', () => {
    expect(precioWebEnSede(servicio)).toBeNull();
    expect(precioWebEnSede({ ...servicio, servicioWeb: 0 })).toBeNull();
  });

  it('tipo: el precio de la sede para ese tipo gana a todo lo demás', () => {
    const s = { servicioWeb: 50, servicioReferencial: 60, servicioSede: 55 };
    expect(precioWebEnSede(s, { tipoWeb: 90, tipoReferencial: 95, tipoSede: 85 })).toBe(85);
    expect(precioWebEnSede(s, { tipoWeb: 90, tipoReferencial: 95, tipoSede: null })).toBe(90);
    expect(precioWebEnSede(s, { tipoWeb: null, tipoReferencial: 95, tipoSede: null })).toBe(95);
  });

  it('tipo sin precio propio cae al precio del servicio (primero el de la sede)', () => {
    const tipo = { tipoWeb: null, tipoReferencial: null, tipoSede: null };
    expect(precioWebEnSede({ servicioWeb: 50, servicioReferencial: 60, servicioSede: 55 }, tipo)).toBe(55);
    expect(precioWebEnSede({ servicioWeb: 50, servicioReferencial: 60, servicioSede: null }, tipo)).toBe(50);
    expect(precioWebEnSede({ servicioWeb: null, servicioReferencial: 60, servicioSede: null }, tipo)).toBe(60);
  });

  it('un precio en 0 o negativo cuenta como «no hay»', () => {
    expect(precioWebEnSede({ servicioWeb: 80, servicioReferencial: 100, servicioSede: 0 })).toBe(80);
    expect(precioWebEnSede({ servicioWeb: 80, servicioReferencial: 100, servicioSede: -5 })).toBe(80);
  });
});
