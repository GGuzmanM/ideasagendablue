// Reglas de qué servicio puede ir en cada mitad de una cita doble (services/tratamientoBloque.ts, 13-nov-2026).
jest.mock('../src/db', () => ({ prisma: {} }));
import { serviciosPermitidosEnMitad, precioBloque, type FilaCombinacion } from '../src/services/tratamientoBloque';

const PROFI = 'profilaxis', LASER = 'laser', ONICO = 'onico', MASAJE = 'masaje', OTRA_ANCLA = 'evaluacion';

describe('2.º servicio (SECUNDARIO)', () => {
  const filas: FilaCombinacion[] = [
    { servicioAnclaId: PROFI, servicioExtraId: LASER },
    { servicioAnclaId: null, servicioExtraId: ONICO },        // fila antigua: vale para la ancla global
    { servicioAnclaId: OTRA_ANCLA, servicioExtraId: MASAJE }, // de otra ancla: no vale con la profilaxis
  ];

  it('solo los extras permitidos para el ancla de la PRINCIPAL (incluye filas antiguas sin ancla)', () => {
    expect(serviciosPermitidosEnMitad('SECUNDARIO', PROFI, filas, PROFI).sort()).toEqual([LASER, ONICO].sort());
  });

  it('una fila antigua sin ancla NO vale para otra ancla', () => {
    expect(serviciosPermitidosEnMitad('SECUNDARIO', OTRA_ANCLA, filas, PROFI)).toEqual([MASAJE]);
  });

  it('nunca el mismo servicio de la otra mitad', () => {
    expect(serviciosPermitidosEnMitad('SECUNDARIO', PROFI, [...filas, { servicioAnclaId: PROFI, servicioExtraId: PROFI }], PROFI)).not.toContain(PROFI);
  });

  it('sin ancla global, las filas antiguas no aplican', () => {
    expect(serviciosPermitidosEnMitad('SECUNDARIO', PROFI, filas, null)).toEqual([LASER]);
  });
});

describe('1.er servicio (PRINCIPAL)', () => {
  it('con una sola ancla: solo la ancla (en la práctica, cambiar su tipo)', () => {
    const filas: FilaCombinacion[] = [{ servicioAnclaId: PROFI, servicioExtraId: LASER }];
    expect(serviciosPermitidosEnMitad('PRINCIPAL', LASER, filas, PROFI)).toEqual([PROFI]);
  });

  it('con varias anclas: solo las que permiten el 2.º servicio actual', () => {
    const filas: FilaCombinacion[] = [
      { servicioAnclaId: PROFI, servicioExtraId: LASER },
      { servicioAnclaId: OTRA_ANCLA, servicioExtraId: LASER },
      { servicioAnclaId: OTRA_ANCLA, servicioExtraId: MASAJE },
    ];
    expect(serviciosPermitidosEnMitad('PRINCIPAL', LASER, filas, PROFI).sort()).toEqual([OTRA_ANCLA, PROFI].sort());
    expect(serviciosPermitidosEnMitad('PRINCIPAL', MASAJE, filas, PROFI)).toEqual([OTRA_ANCLA]);
  });

  it('si el 2.º servicio ya no está permitido con ninguna ancla, no hay opciones', () => {
    expect(serviciosPermitidosEnMitad('PRINCIPAL', 'otro', [{ servicioAnclaId: PROFI, servicioExtraId: LASER }], PROFI)).toEqual([]);
  });
});

it('el precio del bloque es la suma de las dos mitades', () => {
  expect(precioBloque(80, 120)).toBe(200);
});
