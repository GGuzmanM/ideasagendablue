// Posología por defecto de los tratamientos habituales (23-sep-2026): el texto libre del ERP se parte en dosis, vía,
// frecuencia y duración para que la receta salga llena. Casos tomados de la lista real de la clínica.
import { extraerPosologia, unidadesNecesarias } from '../src/services/posologiaDesdeTexto';

describe('extraerPosologia', () => {
  it('tableta por vía oral cada 8 horas por 3 días', () => {
    expect(extraerPosologia('01 tab vía oral c/8h por 3 días')).toEqual({ dosis: '1 tableta', via: 'oral', frecuencia: 'cada 8 horas', duracion: '3 días', indicaciones: null });
  });
  it('con vademécum la dosis queda en número (la unidad la pone la forma del fármaco)', () => {
    expect(extraerPosologia('02 cápsulas vía oral c/12h por 7 días.', true).dosis).toBe('2');
    expect(extraerPosologia('Aplicar 2 puff en zona de dolor', true).dosis).toBe('2 puff'); // puff no es una forma
  });
  it('condicional al dolor se dice claro, y va al final si hay intervalo', () => {
    expect(extraerPosologia('01 tab VO condicional al dolor').frecuencia).toBe('solo si hay dolor');
    expect(extraerPosologia('Tomar condicional al dolor c/8h')).toMatchObject({ frecuencia: 'cada 8 horas, solo si hay dolor', indicaciones: null });
  });
  it('lo que no es posología queda en indicaciones', () => {
    expect(extraerPosologia('01 tab VO c/24h (después del almuerzo) por 1 mes')).toMatchObject({ duracion: '1 mes', indicaciones: 'Después del almuerzo' });
    expect(extraerPosologia('Aplicar en capa fina 01 vez al día por las noches (previo aseo) por 14 días.'))
      .toMatchObject({ frecuencia: '1 vez al día', duracion: '14 días', indicaciones: 'Aplicar en capa fina por las noches (previo aseo)' });
  });
  it('rangos y variantes de escritura', () => {
    expect(extraerPosologia('Aplicar 1- 2 veces al día en zona de lesion por 30 días.').frecuencia).toBe('1 a 2 veces al día');
    expect(extraerPosologia('Aplicar 01 ó 02 veces al día previo aseo.').frecuencia).toBe('1 a 2 veces al día');
    expect(extraerPosologia('Colocar 1 vez al día en zona de lesion por 7-14 días').duracion).toBe('7 a 14 días');
    expect(extraerPosologia('01 tableta vía oral 8am y 4pm por 3 dias').frecuencia).toBe('2 veces al día (8 a. m. y 4 p. m.)');
    expect(extraerPosologia('Aplicar interidiario en uñas').frecuencia).toBe('interdiario (día por medio)');
    expect(extraerPosologia('Tomar una tableta vía oral cada 12 hrs. por 3 días.')).toMatchObject({ dosis: '1 tableta', frecuencia: 'cada 12 horas', duracion: '3 días' });
  });
  it('pulsos: la primera duración es la del pulso; el descanso queda como indicación', () => {
    expect(extraerPosologia('02 cápsulas vía oral c/12h por 7 días y descansar 21 días. Repetir la dosis por 3 meses.', true))
      .toEqual({ dosis: '2', via: 'oral', frecuencia: 'cada 12 horas', duracion: '7 días', indicaciones: 'Descansar 21 días. Repetir la dosis por 3 meses.' });
  });
  it('«30 minutos antes del desayuno» no es una dosis', () => {
    expect(extraerPosologia('Tomar 30 minutos antes del desayuno por 30 días.')).toMatchObject({ dosis: null, frecuencia: '1 vez al día', duracion: '30 días' });
  });
  it('«cambiar cada 24 horas» de un producto no se parte', () => {
    expect(extraerPosologia('Aplicar en zona de lesión y cambiar cada 24 horas.').frecuencia).toBeNull();
  });
  it('los esquemas por semanas quedan enteros', () => {
    const t = 'Aplicación nocturna, previo aseo y piel seca: 1° sem.diario, 2° sem. interdiario y 3° sem. en adelante: 1 vez por sem.';
    expect(extraerPosologia(t)).toEqual({ dosis: null, via: null, frecuencia: null, duracion: null, indicaciones: t });
  });
  it('texto sin posología queda igual', () => {
    expect(extraerPosologia('Cubrir en zona de herida')).toEqual({ dosis: null, via: null, frecuencia: null, duracion: null, indicaciones: 'Cubrir en zona de herida' });
    expect(extraerPosologia(null).indicaciones).toBeNull();
  });
});

describe('unidadesNecesarias', () => {
  it('cuenta tabletas por tratamiento', () => {
    expect(unidadesNecesarias({ dosis: '1 tableta', frecuencia: 'cada 8 horas', duracion: '5 días' })).toBe(15);
    expect(unidadesNecesarias({ dosis: '2', frecuencia: 'cada 12 horas', duracion: '4 días' })).toBe(16);
  });
  it('no compara gotas, puff ni esquemas sin intervalo fijo', () => {
    expect(unidadesNecesarias({ dosis: '2 puff', frecuencia: 'cada 8 horas', duracion: '15 días' })).toBeNull();
    expect(unidadesNecesarias({ dosis: '1', frecuencia: 'solo si hay dolor', duracion: null })).toBeNull();
  });
});
