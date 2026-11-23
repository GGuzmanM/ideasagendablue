import { esFeriado, exigePagoPrevio } from '../src/services/reservaWeb/woocommerce';

describe('pago previo en feriados (18-nov-2026)', () => {
  it('feriados fijos, incluidos 7-jun y 23-jul', () => {
    for (const f of ['2026-01-01', '2026-06-07', '2026-07-23', '2026-07-28', '2026-12-09', '2026-12-25']) expect(esFeriado(f)).toBe(true);
    expect(esFeriado('2026-11-19')).toBe(false);
  });
  it('Jueves y Viernes Santo se calculan cada año', () => {
    expect([esFeriado('2026-04-02'), esFeriado('2026-04-03')]).toEqual([true, true]);
    expect([esFeriado('2027-03-25'), esFeriado('2027-03-26')]).toEqual([true, true]);
    expect(esFeriado('2026-04-04')).toBe(false);
  });
  it('exige pago en feriado entre semana, sábado y domingo; no en día normal', () => {
    expect(exigePagoPrevio('2026-12-25')).toBe(true); // viernes feriado
    expect(exigePagoPrevio('2026-11-21')).toBe(true); // sábado
    expect(exigePagoPrevio('2026-11-22')).toBe(true); // domingo
    expect(exigePagoPrevio('2026-11-19')).toBe(false); // jueves normal
  });
  it('FERIADOS_EXTRA del agenda.env', () => {
    process.env.FERIADOS_EXTRA = '2026-11-20, 2026-12-26';
    expect(exigePagoPrevio('2026-11-20')).toBe(true);
    delete process.env.FERIADOS_EXTRA;
    expect(exigePagoPrevio('2026-11-20')).toBe(false);
  });
});
