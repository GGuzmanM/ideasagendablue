// 24-nov-2026: Fisioterapia no pide receta al cerrar (pide el mapa corporal) y la asistente de podóloga cuenta como podología.
import { faltantesDeAtencion } from '../src/services/bloque3Service';
import { esTipoPodologia, TIPOS_PODOLOGIA } from '@limablue/shared';
import { nombreZonaCuerpo, nombreHallazgo, textoEscalaPunto, puntosDelMapa, lineaPunto } from '../src/services/mapaCorporalTexto';
// La pantalla y el servidor repiten los nombres de zonas y niveles: esta prueba los mantiene iguales.
import { ZONAS_ORDENADAS, TIPOS_MARCA, nivelEscala } from '../../web/src/components/historiaClinica/cuerpo3dModelo';

const base = { diagnosticos: [{ principal: true }], notas: [1], procedimientos: [1], marcasPodograma: [], imagenesPodograma: [], recetas: [], motivoConsulta: 'dolor' };

describe('cierre de una atención de Fisioterapia', () => {
  it('podología sigue pidiendo podograma y receta', () => {
    expect(faltantesDeAtencion(base)).toEqual(['Podograma vacío', 'Sin receta ni indicaciones']);
  });
  it('fisioterapia no pide receta ni podograma: pide el mapa corporal', () => {
    expect(faltantesDeAtencion({ ...base, fisio: true })).toEqual(['Mapa corporal sin marcar']);
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujado: true })).toEqual([]);
  });
});

describe('escala por punto del mapa corporal (Fisioterapia)', () => {
  const mapa = (marcas: unknown[]) => [{ vista: 'cuerpo3d', anotaciones: marcas }];
  it('al cerrar avisa de los hallazgos sin escala; a los doctores no les cambia nada', () => {
    const marcas = [{ zona: 'lumbar', tipo: 'dolor', intensidad: 7 }, { zona: 'hombro_izq', tipo: 'tension', intensidad: null }, { zona: 'pie_der', tipo: 'edema' }];
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujosSilueta: mapa(marcas) })).toEqual(['2 hallazgos del mapa corporal sin escala']);
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujosSilueta: mapa(marcas.slice(0, 2)) })).toEqual(['1 hallazgo del mapa corporal sin escala']);
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujosSilueta: mapa(marcas.slice(0, 1)) })).toEqual([]);
    // EVA 0 («sin dolor») SÍ es una escala puesta
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujosSilueta: mapa([{ zona: 'lumbar', tipo: 'dolor', intensidad: 0 }]) })).toEqual([]);
    // La bandeja manda el conteo ya hecho
    expect(faltantesDeAtencion({ ...base, fisio: true, dibujado: true, sinEscala: 3 })).toEqual(['3 hallazgos del mapa corporal sin escala']);
    // Podología: el mapa corporal no cuenta para nada de esto
    expect(faltantesDeAtencion({ ...base, dibujosSilueta: mapa(marcas) })).toEqual(['Sin receta ni indicaciones']);
  });

  it('texto de la escala: EVA para el dolor, intensidad para lo demás', () => {
    expect(textoEscalaPunto('dolor', 0)).toBe('EVA 0/10 (sin dolor)');
    expect(textoEscalaPunto('dolor', 3)).toBe('EVA 3/10 (leve)');
    expect(textoEscalaPunto('dolor', 7)).toBe('EVA 7/10 (intenso)');
    expect(textoEscalaPunto('dolor', 10)).toBe('EVA 10/10 (máximo)');
    expect(textoEscalaPunto('inflamacion', 5)).toBe('intensidad 5/10 (moderada)');
    expect(textoEscalaPunto('edema', 0)).toBe('intensidad 0/10 (nada)');
    expect(textoEscalaPunto('dolor', null)).toBeNull();
  });

  it('los nombres del servidor son los mismos de la pantalla (zonas, hallazgos y niveles)', () => {
    for (const z of ZONAS_ORDENADAS) expect(nombreZonaCuerpo(z.zona)).toBe(z.label);
    for (const t of TIPOS_MARCA) {
      expect(nombreHallazgo(t.id)).toBe(t.label);
      for (let n = 0; n <= 10; n++) expect(textoEscalaPunto(t.id, n)).toContain(`${n}/10 (${nivelEscala(t.id, n)})`);
    }
    expect(nombreZonaCuerpo('zona_nueva')).toBe('zona_nueva');
  });

  it('línea del PDF: escala, estructuras y nota; tolera filas incompletas', () => {
    const puntos = puntosDelMapa([
      { zona: 'muslo_ant_izq', tipo: 'dolor', intensidad: 6, nota: ' al subir escaleras ', capa: 'musculos', estructuras: ['Recto femoral izq.'], puntos: [1, 2, 3, 4] },
      { zona: 'lumbar', tipo: 'tension' },
      { tipo: 'dolor' }, null, 'x',
    ]);
    expect(puntos).toHaveLength(2);
    expect(puntos[0].musculos).toBe(true);
    expect(lineaPunto(puntos[0])).toBe('EVA 6/10 (moderado) · Recto femoral izq. · al subir escaleras');
    expect(lineaPunto(puntos[1])).toBe('sin escala');
    expect(puntosDelMapa(null)).toEqual([]);
  });
});

describe('asistente de podóloga', () => {
  it('cuenta como podología', () => {
    expect(esTipoPodologia('asistente_podologa')).toBe(true);
    expect(esTipoPodologia('podologa')).toBe(true);
    expect(esTipoPodologia('fisioterapeuta')).toBe(false);
    expect([...TIPOS_PODOLOGIA]).toEqual(['podologa', 'asistente_podologa']);
  });
});
