// Zonas anatómicas de la planta del pie con su posición sobre la silueta (SiluetaPie.tsx, viewBox
// 100×240). Coordenadas normalizadas 0..1 para el pie IZQUIERDO tal como se dibuja (dedo gordo a
// la derecha = lado medial); el pie derecho es el espejo (x → 1 − x). Las usan el monofilamento
// (sitios fijos) y el dictado de lesiones ("heloma quinto dedo izquierdo" → marca del podograma).
export interface ZonaPie { id: string; etiqueta: string; x: number; y: number; alias: string[] }

export const ZONAS_PIE: ZonaPie[] = [
  { id: 'hallux_medial', etiqueta: 'Hallux, borde medial', x: 0.8, y: 0.1, alias: ['hallux borde medial', 'primer dedo borde medial', 'dedo gordo borde medial', 'borde medial del hallux', 'borde medial del primer dedo', 'uña borde medial', 'borde medial de la uña', 'borde medial'] },
  { id: 'hallux_lateral', etiqueta: 'Hallux, borde lateral', x: 0.6, y: 0.1, alias: ['hallux borde lateral', 'primer dedo borde lateral', 'dedo gordo borde lateral', 'borde lateral del hallux', 'borde lateral del primer dedo', 'uña borde lateral', 'borde lateral de la uña', 'borde lateral'] },
  { id: 'hallux', etiqueta: 'Hallux', x: 0.7, y: 0.11, alias: ['hallux', 'primer dedo', 'dedo gordo', 'primer ortejo', '1er dedo', 'dedo uno', 'uña del primer dedo', 'uña del hallux'] },
  { id: 'dedo2', etiqueta: '2º dedo', x: 0.5, y: 0.11, alias: ['segundo dedo', 'segundo ortejo', '2do dedo', 'dedo dos'] },
  { id: 'dedo3', etiqueta: '3er dedo', x: 0.37, y: 0.12, alias: ['tercer dedo', 'tercer ortejo', '3er dedo', 'dedo tres'] },
  { id: 'dedo4', etiqueta: '4º dedo', x: 0.26, y: 0.155, alias: ['cuarto dedo', 'cuarto ortejo', '4to dedo', 'dedo cuatro'] },
  { id: 'dedo5', etiqueta: '5º dedo', x: 0.17, y: 0.205, alias: ['quinto dedo', 'quinto ortejo', '5to dedo', 'dedo cinco', 'dedo meñique', 'dedo pequeño', 'dedo chiquito'] },
  { id: 'meta1', etiqueta: '1er metatarsiano', x: 0.72, y: 0.26, alias: ['primer metatarsiano', 'primera cabeza metatarsal', 'cabeza del primer metatarsiano', 'metatarsiano uno', '1er metatarsiano'] },
  { id: 'meta2', etiqueta: '2º metatarsiano', x: 0.6, y: 0.25, alias: ['segundo metatarsiano', 'metatarsiano dos', '2do metatarsiano'] },
  { id: 'meta3', etiqueta: '3er metatarsiano', x: 0.5, y: 0.25, alias: ['tercer metatarsiano', 'metatarsiano tres', '3er metatarsiano'] },
  { id: 'meta4', etiqueta: '4º metatarsiano', x: 0.38, y: 0.26, alias: ['cuarto metatarsiano', 'metatarsiano cuatro', '4to metatarsiano'] },
  { id: 'meta5', etiqueta: '5º metatarsiano', x: 0.26, y: 0.275, alias: ['quinto metatarsiano', 'metatarsiano cinco', '5to metatarsiano'] },
  { id: 'antepie', etiqueta: 'Antepié', x: 0.54, y: 0.28, alias: ['antepié', 'antepie', 'metatarso', 'cabezas metatarsales', 'zona metatarsal', 'región metatarsal'] },
  { id: 'mediopie', etiqueta: 'Mediopié / arco', x: 0.46, y: 0.54, alias: ['mediopié', 'mediopie', 'arco plantar', 'arco medial', 'arco'] },
  { id: 'borde_lateral_pie', etiqueta: 'Borde lateral del pie', x: 0.16, y: 0.55, alias: ['borde lateral del pie', 'borde externo del pie', 'borde externo'] },
  { id: 'borde_medial_pie', etiqueta: 'Borde medial del pie', x: 0.74, y: 0.6, alias: ['borde medial del pie', 'borde interno del pie', 'borde interno'] },
  { id: 'talon', etiqueta: 'Talón', x: 0.48, y: 0.86, alias: ['talón', 'talon', 'calcáneo', 'calcaneo', 'retropié', 'retropie'] },
  { id: 'planta', etiqueta: 'Planta', x: 0.5, y: 0.42, alias: ['planta del pie', 'región plantar', 'zona plantar', 'planta', 'plantar'] },
];

/** Sitios del monofilamento de 10 g (6 por pie), en el mismo orden que MF_ETIQUETAS. */
export const SITIOS_MONOFILAMENTO = ['hallux', 'meta1', 'meta3', 'meta5', 'mediopie', 'talon'] as const;

const porId = new Map(ZONAS_PIE.map((z) => [z.id, z]));
export const zonaPorId = (id: string): ZonaPie => porId.get(id) ?? ZONAS_PIE[ZONAS_PIE.length - 1]!;

/** Coordenada 0..1 de una zona para un pie dado (el derecho es espejo del izquierdo). */
export function coordZona(id: string, pie: 'izquierdo' | 'derecho'): { x: number; y: number } {
  const z = zonaPorId(id);
  return { x: pie === 'derecho' ? 1 - z.x : z.x, y: z.y };
}
