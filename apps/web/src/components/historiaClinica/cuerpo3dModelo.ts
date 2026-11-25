/**
 * Mapa corporal 3D (24-nov-2026, Fisioterapia): hallazgos y ZONAS del cuerpo. Los modelos (piel y músculos de un mismo
 * cuerpo, BodyParts3D) y qué parte es de cada zona los prepara `tools/cuerpo3d/construir.mjs`; aquí solo están los
 * nombres. Las zonas de brazos, piernas, tronco, cuello y cabeza se parten en ANTERIOR y POSTERIOR; el lado es el del
 * PACIENTE. Los ids de zona se guardan en la historia (`dibujos_silueta`, vista «cuerpo3d»): no cambiarlos.
 */

export type TipoMarcaCorporal = 'dolor' | 'inflamacion' | 'edema' | 'sensibilidad' | 'desgarro' | 'tension' | 'punto_gatillo';

/**
 * Un hallazgo en una zona. Sin `puntos` es de TODA la zona; con `puntos` es solo lo pintado con el pincel (como en el podograma):
 * x, y, z, radio en milímetros del modelo, de cuatro en cuatro.
 */
export interface MarcaCorporal {
  zona: string; tipo: TipoMarcaCorporal; intensidad?: number | null; nota?: string | null; puntos?: number[] | null;
  /** Capa del modelo donde se marcó: sin valor = cuerpo con piel; 'musculos' = músculos y huesos (sus `puntos` son de ESE modelo). */
  capa?: 'musculos' | null;
  /** Músculos / huesos que tocó el pincel (solo en la capa de músculos). */
  estructuras?: string[] | null;
}

/** Los dos modelos del mapa: el cuerpo con piel y el de músculos y huesos. */
export type CapaCuerpo = 'piel' | 'musculos';
export const capaDe = (m: Pick<MarcaCorporal, 'capa'>): CapaCuerpo => (m.capa === 'musculos' ? 'musculos' : 'piel');
/** Tope de estructuras que se anotan por hallazgo (lo valida también el API). */
export const MAX_ESTRUCTURAS = 8;

/** Grosores del pincel (radio en mm). */
export const GROSORES = [
  { id: 'fino', label: 'Fino', mm: 9 },
  { id: 'medio', label: 'Medio', mm: 16 },
  { id: 'grueso', label: 'Grueso', mm: 28 },
] as const;
export type GrosorPincel = (typeof GROSORES)[number]['id'];
/** Tope de toques por hallazgo (lo valida también el API). */
export const MAX_TOQUES = 500;

export const TIPOS_MARCA: { id: TipoMarcaCorporal; label: string; color: string }[] = [
  { id: 'dolor', label: 'Dolor', color: '#dc2626' },
  { id: 'inflamacion', label: 'Inflamación', color: '#ea580c' },
  { id: 'edema', label: 'Edema', color: '#2563eb' },
  { id: 'sensibilidad', label: 'Sensibilidad', color: '#9333ea' },
  { id: 'desgarro', label: 'Desgarro', color: '#7c2d12' },
  { id: 'tension', label: 'Tensión', color: '#ca8a04' },
  { id: 'punto_gatillo', label: 'Punto gatillo', color: '#db2777' },
];
export const COLOR_TIPO: Record<TipoMarcaCorporal, string> = Object.fromEntries(TIPOS_MARCA.map((t) => [t.id, t.color])) as Record<TipoMarcaCorporal, string>;
export const LABEL_TIPO: Record<TipoMarcaCorporal, string> = Object.fromEntries(TIPOS_MARCA.map((t) => [t.id, t.label])) as Record<TipoMarcaCorporal, string>;

/**
 * Escala de cada hallazgo (24-nov-2026): en Fisioterapia la escala va POR PUNTO, no una por atención. Es el 0–10 que ya se
 * guardaba en `intensidad`: para el dolor es la EVA; para lo demás, la intensidad del hallazgo.
 */
export const ESCALA_TIPO: Record<TipoMarcaCorporal, { nombre: string; cero: string; diez: string; femenino?: boolean }> = {
  dolor: { nombre: 'EVA', cero: 'Sin dolor', diez: 'El peor dolor' },
  inflamacion: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máxima', femenino: true },
  edema: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máximo' },
  sensibilidad: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máxima', femenino: true },
  desgarro: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máximo' },
  tension: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máxima', femenino: true },
  punto_gatillo: { nombre: 'Intensidad', cero: 'Nada', diez: 'Máximo' },
};
/** Color de cada valor de 0 a 10 (de verde a rojo). */
export const COLOR_ESCALA = ['#16a34a', '#22c55e', '#65a30d', '#84cc16', '#ca8a04', '#d97706', '#ea580c', '#f97316', '#ef4444', '#dc2626', '#b91c1c'] as const;
/** Nivel en palabras: 1–3 leve · 4–6 moderado · 7–9 intenso · 10 máximo. Mismos cortes que el PDF (historiaPdf.ts). */
export function nivelEscala(tipo: TipoMarcaCorporal, n: number): string {
  const e = ESCALA_TIPO[tipo];
  if (n <= 0) return e.cero.toLowerCase();
  const f = e.femenino;
  if (n <= 3) return 'leve';
  if (n <= 6) return f ? 'moderada' : 'moderado';
  if (n <= 9) return f ? 'intensa' : 'intenso';
  return f ? 'máxima' : 'máximo';
}
/** «EVA 7/10 · intenso» */
export const textoEscala = (tipo: TipoMarcaCorporal, n: number) => `${ESCALA_TIPO[tipo].nombre} ${n}/10 · ${nivelEscala(tipo, n)}`;

type Lado = 'izq' | 'der';
const L = (lado: Lado) => (lado === 'izq' ? 'izquierdo' : 'derecho');
const La = (lado: Lado) => (lado === 'izq' ? 'izquierda' : 'derecha');

/** Zonas en orden de cabeza a pies (el selector accesible y la lista de hallazgos usan este orden). */
export const ZONAS_ORDENADAS: { zona: string; label: string }[] = [
  { zona: 'cabeza', label: 'Cabeza / cara' },
  { zona: 'craneo_post', label: 'Cabeza posterior (occipital)' },
  { zona: 'cuello', label: 'Cuello anterior' },
  { zona: 'cervical', label: 'Cervical' },
  { zona: 'pecho', label: 'Pecho' },
  { zona: 'dorsal', label: 'Dorsal (espalda alta)' },
  { zona: 'abdomen', label: 'Abdomen' },
  { zona: 'lumbar', label: 'Lumbar' },
  ...(['izq', 'der'] as Lado[]).flatMap((s) => [
    { zona: `hombro_${s}`, label: `Hombro ${L(s)}` },
    { zona: `brazo_ant_${s}`, label: `Brazo anterior ${L(s)} (bíceps)` },
    { zona: `brazo_post_${s}`, label: `Brazo posterior ${L(s)} (tríceps)` },
    { zona: `codo_${s}`, label: `Pliegue del codo ${L(s)}` },
    { zona: `codo_post_${s}`, label: `Codo ${L(s)} (olécranon)` },
    { zona: `antebrazo_ant_${s}`, label: `Antebrazo anterior ${L(s)}` },
    { zona: `antebrazo_post_${s}`, label: `Antebrazo posterior ${L(s)}` },
    { zona: `mano_${s}`, label: `Muñeca y mano ${La(s)}` },
    { zona: `cadera_${s}`, label: `Cadera / ingle ${La(s)}` },
    { zona: `gluteo_${s}`, label: `Glúteo ${L(s)}` },
    { zona: `muslo_ant_${s}`, label: `Muslo anterior ${L(s)} (cuádriceps)` },
    { zona: `muslo_post_${s}`, label: `Muslo posterior ${L(s)} (isquiotibiales)` },
    { zona: `rodilla_${s}`, label: `Rodilla ${La(s)}` },
    { zona: `popliteo_${s}`, label: `Hueco poplíteo ${L(s)}` },
    { zona: `pierna_ant_${s}`, label: `Pierna anterior ${L(s)} (tibial)` },
    { zona: `pantorrilla_${s}`, label: `Pantorrilla ${La(s)} (gemelos)` },
    { zona: `tobillo_${s}`, label: `Tobillo ${L(s)}` },
    { zona: `pie_${s}`, label: `Pie ${L(s)}` },
  ]),
];
/** id de zona → nombre para mostrar. */
export const LABEL_ZONA: Record<string, string> = Object.fromEntries(ZONAS_ORDENADAS.map((z) => [z.zona, z.label]));
