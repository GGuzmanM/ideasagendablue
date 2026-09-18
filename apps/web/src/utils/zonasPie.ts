// Zonas anatómicas del pie con su posición sobre las FOTOS de la silueta (SiluetaPie.tsx). En las dos, el
// pie de la izquierda de la pantalla es el izquierdo del paciente y el de la derecha, el derecho:
//  · vista 'plantar' → public/Silueta.jpg (caja 744×1843 por pie, dedos ARRIBA, talón abajo; girada otra
//    vez 180° el 17-sep-2026 a pedido del doctor, así que la planta se ve como el dorso: el mismo pie
//    queda del mismo lado en las dos vistas y el dedo gordo, hacia afuera). Esa foto es simétrica: x/y son
//    del pie IZQUIERDO y el derecho se espeja (x → 1 − x).
//  · vista 'dorsal' → public/Silueta-dorsal.jpg (caja 874×1960 por pie, dedos ARRIBA, uñas visibles: el
//    dorso como lo ve el propio paciente mirándose los pies). Esa foto NO es simétrica: cada zona dorsal
//    trae también xd/yd para el pie derecho.
// Coordenadas normalizadas 0..1 dentro de la caja de cada pie. Si se cambia una foto, recalibrar sus zonas
// (y migrar las marcas y dibujos guardados, como hizo la migración `silueta_giro_180`).
// Las usan el monofilamento (sitios plantares fijos) y el dictado de lesiones (→ marca del podograma).
import type { VistaSilueta } from '../api/historiaClinica';

export interface ZonaPie { id: string; etiqueta: string; vista: VistaSilueta; x: number; y: number; xd?: number; yd?: number; alias: string[] }

export const ZONAS_PIE: ZonaPie[] = [
  // ── Planta ──
  { id: 'hallux', etiqueta: 'Hallux', vista: 'plantar', x: 0.21, y: 0.1, alias: ['hallux', 'primer dedo', 'dedo gordo', 'primer ortejo', '1er dedo', 'dedo uno'] },
  { id: 'dedo2', etiqueta: '2º dedo', vista: 'plantar', x: 0.53, y: 0.085, alias: ['segundo dedo', 'segundo ortejo', '2do dedo', 'dedo dos'] },
  { id: 'dedo3', etiqueta: '3er dedo', vista: 'plantar', x: 0.69, y: 0.125, alias: ['tercer dedo', 'tercer ortejo', '3er dedo', 'dedo tres'] },
  { id: 'dedo4', etiqueta: '4º dedo', vista: 'plantar', x: 0.8, y: 0.19, alias: ['cuarto dedo', 'cuarto ortejo', '4to dedo', 'dedo cuatro'] },
  { id: 'dedo5', etiqueta: '5º dedo', vista: 'plantar', x: 0.9, y: 0.26, alias: ['quinto dedo', 'quinto ortejo', '5to dedo', 'dedo cinco', 'dedo meñique', 'dedo pequeño', 'dedo chiquito'] },
  { id: 'meta1', etiqueta: '1er metatarsiano', vista: 'plantar', x: 0.24, y: 0.32, alias: ['primer metatarsiano', 'primera cabeza metatarsal', 'cabeza del primer metatarsiano', 'metatarsiano uno', '1er metatarsiano'] },
  { id: 'meta2', etiqueta: '2º metatarsiano', vista: 'plantar', x: 0.4, y: 0.3, alias: ['segundo metatarsiano', 'metatarsiano dos', '2do metatarsiano'] },
  { id: 'meta3', etiqueta: '3er metatarsiano', vista: 'plantar', x: 0.54, y: 0.31, alias: ['tercer metatarsiano', 'metatarsiano tres', '3er metatarsiano'] },
  { id: 'meta4', etiqueta: '4º metatarsiano', vista: 'plantar', x: 0.67, y: 0.32, alias: ['cuarto metatarsiano', 'metatarsiano cuatro', '4to metatarsiano'] },
  { id: 'meta5', etiqueta: '5º metatarsiano', vista: 'plantar', x: 0.84, y: 0.34, alias: ['quinto metatarsiano', 'metatarsiano cinco', '5to metatarsiano'] },
  { id: 'antepie', etiqueta: 'Antepié', vista: 'plantar', x: 0.53, y: 0.33, alias: ['antepié', 'antepie', 'metatarso', 'cabezas metatarsales', 'zona metatarsal', 'región metatarsal'] },
  { id: 'mediopie', etiqueta: 'Mediopié / arco', vista: 'plantar', x: 0.48, y: 0.6, alias: ['mediopié', 'mediopie', 'arco plantar', 'arco medial', 'arco'] },
  { id: 'borde_lateral_pie', etiqueta: 'Borde lateral del pie', vista: 'plantar', x: 0.83, y: 0.56, alias: ['borde lateral del pie', 'borde externo del pie', 'borde externo'] },
  { id: 'borde_medial_pie', etiqueta: 'Borde medial del pie', vista: 'plantar', x: 0.15, y: 0.6, alias: ['borde medial del pie', 'borde interno del pie', 'borde interno'] },
  { id: 'talon', etiqueta: 'Talón', vista: 'plantar', x: 0.45, y: 0.88, alias: ['talón', 'talon', 'calcáneo', 'calcaneo', 'retropié', 'retropie'] },
  { id: 'planta', etiqueta: 'Planta', vista: 'plantar', x: 0.48, y: 0.47, alias: ['planta del pie', 'región plantar', 'zona plantar', 'planta', 'plantar'] },
  // ── Dorso: uñas (bordes del hallux), dedos por encima, juanete, empeine y tobillo ──
  { id: 'hallux_medial', etiqueta: 'Uña del hallux, borde medial', vista: 'dorsal', x: 0.785, y: 0.075, xd: 0.105, yd: 0.075, alias: ['hallux borde medial', 'primer dedo borde medial', 'dedo gordo borde medial', 'borde medial del hallux', 'borde medial del primer dedo', 'uña borde medial', 'borde medial de la uña', 'borde medial'] },
  { id: 'hallux_lateral', etiqueta: 'Uña del hallux, borde lateral', vista: 'dorsal', x: 0.645, y: 0.075, xd: 0.245, yd: 0.075, alias: ['hallux borde lateral', 'primer dedo borde lateral', 'dedo gordo borde lateral', 'borde lateral del hallux', 'borde lateral del primer dedo', 'uña borde lateral', 'borde lateral de la uña', 'borde lateral'] },
  { id: 'una_hallux', etiqueta: 'Uña del hallux', vista: 'dorsal', x: 0.715, y: 0.075, xd: 0.175, yd: 0.075, alias: ['uña del primer dedo', 'uña del hallux', 'uña del dedo gordo', 'uña hallux', 'uña del 1er dedo'] },
  { id: 'una2', etiqueta: 'Uña del 2º dedo', vista: 'dorsal', x: 0.495, y: 0.045, xd: 0.41, yd: 0.045, alias: ['uña del segundo dedo', 'uña segundo dedo', 'uña del 2do dedo'] },
  { id: 'una3', etiqueta: 'Uña del 3er dedo', vista: 'dorsal', x: 0.345, y: 0.08, xd: 0.56, yd: 0.08, alias: ['uña del tercer dedo', 'uña tercer dedo', 'uña del 3er dedo'] },
  { id: 'una4', etiqueta: 'Uña del 4º dedo', vista: 'dorsal', x: 0.21, y: 0.13, xd: 0.69, yd: 0.13, alias: ['uña del cuarto dedo', 'uña cuarto dedo', 'uña del 4to dedo'] },
  { id: 'una5', etiqueta: 'Uña del 5º dedo', vista: 'dorsal', x: 0.08, y: 0.21, xd: 0.815, yd: 0.2, alias: ['uña del quinto dedo', 'uña quinto dedo', 'uña del 5to dedo', 'uña del dedo meñique', 'uña del meñique'] },
  { id: 'hallux_d', etiqueta: 'Hallux (dorso)', vista: 'dorsal', x: 0.75, y: 0.16, xd: 0.16, yd: 0.16, alias: [] },
  { id: 'dedo2_d', etiqueta: '2º dedo (dorso)', vista: 'dorsal', x: 0.5, y: 0.12, xd: 0.4, yd: 0.12, alias: [] },
  { id: 'dedo3_d', etiqueta: '3er dedo (dorso)', vista: 'dorsal', x: 0.35, y: 0.15, xd: 0.56, yd: 0.15, alias: [] },
  { id: 'dedo4_d', etiqueta: '4º dedo (dorso)', vista: 'dorsal', x: 0.21, y: 0.2, xd: 0.69, yd: 0.2, alias: [] },
  { id: 'dedo5_d', etiqueta: '5º dedo (dorso)', vista: 'dorsal', x: 0.095, y: 0.26, xd: 0.81, yd: 0.26, alias: [] },
  { id: 'juanete', etiqueta: 'Juanete (1ª articulación)', vista: 'dorsal', x: 0.88, y: 0.3, xd: 0.07, yd: 0.3, alias: ['juanete', 'hallux valgus', 'bunion'] },
  { id: 'empeine', etiqueta: 'Empeine / dorso del pie', vista: 'dorsal', x: 0.48, y: 0.48, xd: 0.45, yd: 0.48, alias: ['empeine', 'dorso del pie', 'cara dorsal', 'dorso'] },
  { id: 'tobillo', etiqueta: 'Tobillo', vista: 'dorsal', x: 0.54, y: 0.86, xd: 0.38, yd: 0.86, alias: ['tobillo', 'maléolo', 'maleolo'] },
];

/** Sitios del monofilamento de 10 g (6 por pie, en la PLANTA), en el mismo orden que MF_ETIQUETAS. */
export const SITIOS_MONOFILAMENTO = ['hallux', 'meta1', 'meta3', 'meta5', 'mediopie', 'talon'] as const;

const porId = new Map(ZONAS_PIE.map((z) => [z.id, z]));
export const zonaPorId = (id: string): ZonaPie => porId.get(id) ?? porId.get('planta')!;

/** Coordenada 0..1 de una zona para un pie dado, con la silueta (vista) en la que va. */
export function coordZona(id: string, pie: 'izquierdo' | 'derecho'): { x: number; y: number; vista: VistaSilueta } {
  const z = zonaPorId(id);
  if (pie === 'derecho') return { x: z.xd ?? 1 - z.x, y: z.yd ?? z.y, vista: z.vista };
  return { x: z.x, y: z.y, vista: z.vista };
}

// Un dedo dictado se lleva a su UÑA (dorso) si la lesión es de uña, o a su cara de arriba si se dijo «dorsal».
const UNA_DE: Record<string, string> = { hallux: 'una_hallux', dedo2: 'una2', dedo3: 'una3', dedo4: 'una4', dedo5: 'una5' };
const DORSO_DE: Record<string, string> = { hallux: 'hallux_d', dedo2: 'dedo2_d', dedo3: 'dedo3_d', dedo4: 'dedo4_d', dedo5: 'dedo5_d' };
export function ajustarZonaDictada(z: ZonaPie, ctx: { una: boolean; dorsal: boolean }): ZonaPie {
  if (ctx.una && UNA_DE[z.id]) return zonaPorId(UNA_DE[z.id]!);
  if (ctx.dorsal && DORSO_DE[z.id]) return zonaPorId(DORSO_DE[z.id]!);
  return z;
}

/** Proporción ancho/alto de la caja de un pie en cada foto (la misma que usa SiluetaPie). */
export const ASPECTO_VISTA: Record<VistaSilueta, number> = { plantar: 744 / 1843, dorsal: 874 / 1960 };

/** Zona de una vista más cercana a (x, y) del pie dado (distancia corregida por la proporción de la caja). */
export function zonaMasCercana(vista: VistaSilueta, pie: 'izquierdo' | 'derecho', x: number, y: number): ZonaPie {
  const asp = ASPECTO_VISTA[vista];
  let mejor = ZONAS_PIE[0]!;
  let d = Infinity;
  for (const z of ZONAS_PIE) {
    if (z.vista !== vista) continue;
    const c = coordZona(z.id, pie);
    const dd = Math.hypot(c.x - x, (c.y - y) / asp);
    if (dd < d) { d = dd; mejor = z; }
  }
  return mejor;
}

const normalizarZona = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const TEXTOS_ZONA = ZONAS_PIE
  .flatMap((z) => [z.etiqueta, ...z.alias].map((t) => ({ z, t: normalizarZona(t) })))
  .sort((a, b) => b.t.length - a.t.length);

// Alias COMODÍN: solo valen si el texto no nombra una zona más concreta.
//  · «planta», «plantar», «región plantar»… (zona 'planta') ceden ante CUALQUIER otra zona: «úlcera plantar en el
//    talón» es del talón; «úlcera en la planta» sí es de la planta.
//  · «borde medial» / «borde lateral» (con o sin «uña») sin decir de qué dedo son de la uña del hallux, salvo que se
//    nombre OTRO dedo: «borde lateral del quinto dedo» es del 5º dedo; «hallux borde lateral» sigue siendo del hallux.
const ZONA_COMODIN = 'planta';
const ALIAS_COMODIN_HALLUX = new Set(['borde medial', 'borde lateral', 'uña borde medial', 'uña borde lateral', 'borde medial de la uña', 'borde lateral de la uña'].map(normalizarZona));
const esOtroDedo = (id: string) => /^(?:dedo[2-5]|una[2-5])(?:_d)?$/.test(id);

/** Entre las zonas halladas en un texto (ya en orden de preferencia: alias más largo primero), la que manda según los comodines. */
export function elegirZona(halladas: { zona: ZonaPie; alias: string }[]): ZonaPie | null {
  const concretas = halladas.filter((h) => h.zona.id !== ZONA_COMODIN);
  const otroDedo = concretas.some((h) => esOtroDedo(h.zona.id));
  const firmes = otroDedo ? concretas.filter((h) => !ALIAS_COMODIN_HALLUX.has(normalizarZona(h.alias))) : concretas;
  return (firmes[0] ?? concretas[0] ?? halladas[0])?.zona ?? null;
}

/** Zona a partir de un texto libre ("Talón", "uña del primer dedo", "borde lateral"): el nombre o alias más largo contenido gana, salvo los comodines de arriba. */
export function zonaPorTexto(texto: string | null | undefined): ZonaPie | null {
  const t = texto ? normalizarZona(texto) : '';
  if (!t) return null;
  return elegirZona(TEXTOS_ZONA.filter((x) => t.includes(x.t)).map((x) => ({ zona: x.z, alias: x.t })));
}
