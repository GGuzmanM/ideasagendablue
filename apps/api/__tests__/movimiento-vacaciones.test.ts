/**
 * Movimientos y vacaciones (19-sep-2026): el arrastre de una podóloga ahora es un cambio de sede SIN
 * fecha de fin (se queda hasta que coordinación lo cambie). Una vacación lejana no debe impedirlo.
 */
jest.mock('../src/db', () => ({ prisma: {} }));

import { finVentanaVacaciones, vacacionesEnRango } from '../src/services/asignacionService';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('Ventana en la que una vacación frena un movimiento', () => {
  it('préstamo con fecha de fin: todo su rango', () => {
    expect(finVentanaVacaciones(d('2026-09-22'), d('2026-09-30'))).toEqual(d('2026-09-30'));
  });
  it('cambio de sede sin fecha de fin: solo el día en que empieza', () => {
    expect(finVentanaVacaciones(d('2026-09-22'), null)).toEqual(d('2026-09-22'));
  });
});

describe('vacacionesEnRango consulta solo esa ventana', () => {
  const dbCon = (filas: { fechaInicio: Date }[]) => {
    const findMany = jest.fn().mockResolvedValue(filas);
    return { db: { bloqueoAgenda: { findMany } } as never, findMany };
  };
  it('sin fecha de fin pregunta únicamente por el día de inicio (una vacación de noviembre no entra)', async () => {
    const { db, findMany } = dbCon([]);
    expect(await vacacionesEnRango(db, 'p1', d('2026-09-22'), null)).toBeNull();
    const w = findMany.mock.calls[0][0].where;
    expect(w.esVacaciones).toBe(true);
    expect(w.fechaInicio.gte.toISOString()).toBe('2026-09-22T00:00:00.000Z');
    expect(w.fechaInicio.lte.toISOString()).toBe('2026-09-22T23:59:59.000Z');
  });
  it('con fecha de fin devuelve el tramo de vacaciones que pisa', async () => {
    const { db, findMany } = dbCon([{ fechaInicio: d('2026-09-24') }, { fechaInicio: d('2026-09-25') }]);
    expect(await vacacionesEnRango(db, 'p1', d('2026-09-22'), d('2026-09-30'))).toEqual({ desde: d('2026-09-24'), hasta: d('2026-09-25'), dias: 2 });
    expect(findMany.mock.calls[0][0].where.fechaInicio.lte.toISOString()).toBe('2026-09-30T23:59:59.000Z');
  });
});
