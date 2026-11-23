import { armarEmbudo } from '../src/services/embudoAnaService';

describe('embudo de Ana por día', () => {
  it('separa Ana de «de afuera» por enlace de cita, no por canal', () => {
    const dias = ['2026-11-18', '2026-11-19'];
    const reservas = [
      { creadoEn: new Date('2026-11-18T15:00:00Z'), estado: 'confirmada', pagoEstado: null },
      { creadoEn: new Date('2026-11-18T16:00:00Z'), estado: 'confirmada', pagoEstado: 'aprobado' },
      { creadoEn: new Date('2026-11-18T17:00:00Z'), estado: 'expirada', pagoEstado: 'pendiente' },
      { creadoEn: new Date('2026-11-19T03:00:00Z'), estado: 'confirmada', pagoEstado: null }, // 22:00 del 18 en Lima
    ];
    const ana = new Set(['a1', 'a2']);
    const citas = [
      { id: 'a1', fecha: '2026-11-19', estado: 'completada', canal: 'web' },
      { id: 'a2', fecha: '2026-11-19', estado: 'no_show', canal: 'web' },
      { id: 'x1', fecha: '2026-11-19', estado: 'completada', canal: 'recepcion' },
      { id: 'x2', fecha: '2026-11-19', estado: 'llego', canal: 'recepcion' },
      { id: 'x3', fecha: '2026-11-19', estado: 'no_show', canal: 'recepcion' },
    ];
    const [d18, d19] = armarEmbudo(dias, reservas, ana, citas);
    expect(d18.agendaronPorAna).toBe(3);
    expect(d18.pagaron).toBe(1);
    expect(d18.noPagaron).toBe(1);
    expect(d19.anaVinieron).toBe(1);
    expect(d19.anaNoVinieron).toBe(1);
    expect(d19.deAfueraVinieron).toBe(2);
    expect(d19.deAfueraNoVinieron).toBe(1);
    expect(d19.deAfueraPorCanal).toEqual({ recepcion: 2 });
  });
});
