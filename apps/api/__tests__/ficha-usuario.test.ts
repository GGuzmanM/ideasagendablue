/**
 * Alta de usuario con su FICHA en un solo paso (19-sep-2026): reglas puras que deciden si la ficha
 * se crea o se vincula una que ya existía con ese nombre (para no duplicar personas en Movimientos).
 */
jest.mock('../src/db', () => ({ prisma: {} }));

import {
  normalizarNombre, coincideNombre, elegirFicha, partirNombre, partirComoAntes, finDeMes, esRolConFicha, HORARIO_TIPO_PODOLOGA,
} from '../src/services/fichaUsuarioService';

describe('Roles que llevan ficha', () => {
  it('recepcionista, médico y podóloga sí; coordinación, admin y contact center no (manda su rol)', () => {
    expect(['recepcionista', 'medico', 'podologa'].every(esRolConFicha)).toBe(true);
    expect(['admin', 'coordinadora_sedes', 'contact_center', '', undefined].some((r) => esRolConFicha(r))).toBe(false);
  });
});

describe('Comparar el nombre escrito con el de la ficha', () => {
  it('ignora tildes, mayúsculas, signos y espacios de más', () => {
    expect(normalizarNombre('  Mírtha   CHÁVEZ-Vázquez ')).toBe('mirtha chavez vazquez');
    expect(coincideNombre('mirtha chavez vazquez', 'Mirtha Chávez Vázquez')).toBe(true);
  });
  it('acepta el nombre corto contra la ficha completa (todas sus palabras están en la larga)', () => {
    expect(coincideNombre('Mirtha Chavez', 'Mirtha Chavez Vazquez')).toBe(true);
    expect(coincideNombre('Ana María Pérez Soto', 'Ana Pérez')).toBe(true);
  });
  it('una sola palabra no basta, ni un apellido distinto', () => {
    expect(coincideNombre('Mirtha', 'Mirtha Chavez Vazquez')).toBe(false);
    expect(coincideNombre('Mirtha Lopez', 'Mirtha Chavez Vazquez')).toBe(false);
    expect(coincideNombre('', 'Mirtha Chavez')).toBe(false);
  });
});

describe('Crear, vincular o pedir precisión', () => {
  const libres = [{ id: '1', nombre: 'Rosa Puescas Alva' }, { id: '2', nombre: 'Anais Puescas Alva' }, { id: '3', nombre: 'Luz Saldaña' }];
  it('ninguna coincide → se crea', () => expect(elegirFicha('Carmen Ruiz', libres)).toEqual({ tipo: 'crear' }));
  it('una coincide → se vincula esa', () => expect(elegirFicha('Luz Saldaña Mostacero', libres)).toEqual({ tipo: 'vincular', ficha: libres[2] }));
  it('varias coinciden → ambiguo; el nombre exacto desempata', () => {
    expect(elegirFicha('Puescas Alva', libres).tipo).toBe('ambiguo');
    expect(elegirFicha('rosa puescas alva', libres)).toEqual({ tipo: 'vincular', ficha: libres[0] });
  });
});

describe('Datos de la ficha nueva', () => {
  it('parte el nombre completo en nombres y apellidos', () => {
    expect(partirNombre('Ana María Pérez Soto')).toEqual({ nombres: 'Ana María', apellidos: 'Pérez Soto' });
    expect(partirNombre('Ana Pérez Soto')).toEqual({ nombres: 'Ana', apellidos: 'Pérez Soto' });
    expect(partirNombre('Ana Pérez')).toEqual({ nombres: 'Ana', apellidos: 'Pérez' });
    expect(partirNombre(' Ana ')).toEqual({ nombres: 'Ana', apellidos: '-' });
  });
  it('fin de mes, incluidos febrero bisiesto y diciembre', () => {
    expect(finDeMes('2026-09-19')).toBe('2026-09-30');
    expect(finDeMes('2028-02-10')).toBe('2028-02-29');
    expect(finDeMes('2026-12-31')).toBe('2026-12-31');
  });
  it('horario tipo de podóloga: lun–vie 08–20 y sábado 08–15, sin domingo', () => {
    expect(HORARIO_TIPO_PODOLOGA.map((h) => h.diaSemana)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(HORARIO_TIPO_PODOLOGA[5]).toMatchObject({ horaInicio: '08:00', horaFin: '15:00' });
  });
});

describe('Renombrar la ficha cuando cambia el nombre del usuario', () => {
  it('con la misma cantidad de palabras conserva cuántas son nombres y cuántas apellidos', () => {
    expect(partirComoAntes('Libertar Arrasco Galvez', 'Libertar', 'Arrasc Galvez')).toEqual({ nombres: 'Libertar', apellidos: 'Arrasco Galvez' });
    expect(partirComoAntes('Ana Lucía Pérez', 'María José', 'Pérez')).toEqual({ nombres: 'Ana Lucía', apellidos: 'Pérez' });
  });
  it('si cambió la cantidad de palabras usa la regla general', () => {
    expect(partirComoAntes('Angelica Rojas Sanchez', 'Gia', 'Rojas')).toEqual({ nombres: 'Angelica', apellidos: 'Rojas Sanchez' });
    expect(partirComoAntes('Kiara Paredes', 'Kiara Milagros', 'Rodriguez Soto')).toEqual({ nombres: 'Kiara', apellidos: 'Paredes' });
  });
  it('una ficha sin apellido («-») no cuenta como palabra', () => {
    expect(partirComoAntes('Rosa Puescas', 'Rosa', '-')).toEqual({ nombres: 'Rosa', apellidos: 'Puescas' });
  });
});
