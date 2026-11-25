import { sugerirSiguienteSesion, numeroDeOpcion, type OpcionServicio } from '../src/services/siguienteSesion';

const ops = (...nombres: string[]): OpcionServicio[] => nombres.map((n, i) => ({ id: `id${i}`, nombre: n }));
const id = (o: OpcionServicio[], nombre: string) => o.find((x) => x.nombre === nombre)!.id;

describe('seguimiento automático de sesiones', () => {
  const laser = ops('Sesion 1', 'Sesion 10', 'Sesion 11', 'Sesion 12', 'Sesion 2', 'Sesion 3', 'Sesion 4', 'Sesion 5', 'Sesion 6', 'Sesion 7', 'Sesion 8', 'Sesion 9');

  test('lee el número aunque tenga tilde o no', () => {
    expect(numeroDeOpcion('Sesión 12')).toEqual({ prefijo: 'sesion', n: 12 });
    expect(numeroDeOpcion('Curación 3')).toEqual({ prefijo: 'curacion', n: 3 });
    expect(numeroDeOpcion('Base')).toBeNull();
  });

  test('sin historial: empieza en la Sesión 1', () => {
    expect(sugerirSiguienteSesion(laser, null)).toEqual({ sugerida: { id: id(laser, 'Sesion 1'), nombre: 'Sesion 1' }, motivo: 'inicio' });
  });

  test('la 1 viva → la 2; la 9 → la 10 (orden numérico, no alfabético)', () => {
    expect(sugerirSiguienteSesion(laser, { subcategoriaId: id(laser, 'Sesion 1') }).sugerida?.nombre).toBe('Sesion 2');
    expect(sugerirSiguienteSesion(laser, { subcategoriaId: id(laser, 'Sesion 9') }).sugerida?.nombre).toBe('Sesion 10');
  });

  test('la última del paquete → no propone nada', () => {
    expect(sugerirSiguienteSesion(laser, { subcategoriaId: id(laser, 'Sesion 12') })).toEqual({ sugerida: null, motivo: 'paquete_completo' });
  });

  test('procedimiento base y luego curaciones (Matrisectomía, Extracción de Uña, VPH BLE)', () => {
    const matri = ops('Base', 'Curación 1', 'Curación 2', 'Curación 10');
    expect(sugerirSiguienteSesion(matri, null)).toEqual({ sugerida: null, motivo: 'sin_serie' }); // la primera la elige recepción
    expect(sugerirSiguienteSesion(matri, { subcategoriaId: id(matri, 'Base') }).sugerida?.nombre).toBe('Curación 1');
    expect(sugerirSiguienteSesion(matri, { subcategoriaId: id(matri, 'Curación 2') }).sugerida?.nombre).toBe('Curación 10');
  });

  test('Curación de Úlceras: 1ra Atención → Consecutiva → Consecutiva', () => {
    const ulc = ops('1ra Atención', 'Consecutiva');
    expect(sugerirSiguienteSesion(ulc, null).sugerida?.nombre).toBe('1ra Atención');
    expect(sugerirSiguienteSesion(ulc, { subcategoriaId: id(ulc, '1ra Atención') }).sugerida?.nombre).toBe('Consecutiva');
    expect(sugerirSiguienteSesion(ulc, { subcategoriaId: id(ulc, 'Consecutiva') }).sugerida?.nombre).toBe('Consecutiva');
  });

  test('servicios sin serie (Limpieza: Regular/Premium) no sugieren nada', () => {
    const limp = ops('Adulto mayor', 'Pie Diabético', 'Premium', 'Regular');
    expect(sugerirSiguienteSesion(limp, null).sugerida).toBeNull();
    expect(sugerirSiguienteSesion(limp, { subcategoriaId: id(limp, 'Regular') }).sugerida).toBeNull();
  });

  test('cita anterior sin opción → no adivina', () => {
    expect(sugerirSiguienteSesion(laser, { subcategoriaId: null })).toEqual({ sugerida: null, motivo: 'sin_dato' });
  });
});
