// Mapa corporal de Fisioterapia en TEXTO (para el PDF de la historia): nombre de cada zona y hallazgo y la escala de cada punto.
// Mismos nombres y mismos cortes que la pantalla (apps/web/src/components/historiaClinica/cuerpo3dModelo.ts): si se cambia uno,
// cambiar el otro. Los ids de zona se guardan en la historia: no cambiarlos.

const LADO = { izq: ['izquierdo', 'izquierda'], der: ['derecho', 'derecha'] } as const;
const CENTRO: Record<string, string> = {
  cabeza: 'Cabeza / cara', craneo_post: 'Cabeza posterior (occipital)', cuello: 'Cuello anterior', cervical: 'Cervical', pecho: 'Pecho',
  dorsal: 'Dorsal (espalda alta)', abdomen: 'Abdomen', lumbar: 'Lumbar',
};
// [nombre, género del lado: 0 = masculino («izquierdo»), 1 = femenino («izquierda»), aclaración]
const POR_LADO: Record<string, [string, 0 | 1, string?]> = {
  hombro: ['Hombro', 0], brazo_ant: ['Brazo anterior', 0, 'bíceps'], brazo_post: ['Brazo posterior', 0, 'tríceps'], codo: ['Pliegue del codo', 0],
  codo_post: ['Codo', 0, 'olécranon'], antebrazo_ant: ['Antebrazo anterior', 0], antebrazo_post: ['Antebrazo posterior', 0], mano: ['Muñeca y mano', 1],
  cadera: ['Cadera / ingle', 1], gluteo: ['Glúteo', 0], muslo_ant: ['Muslo anterior', 0, 'cuádriceps'], muslo_post: ['Muslo posterior', 0, 'isquiotibiales'],
  rodilla: ['Rodilla', 1], popliteo: ['Hueco poplíteo', 0], pierna_ant: ['Pierna anterior', 0, 'tibial'], pantorrilla: ['Pantorrilla', 1, 'gemelos'],
  tobillo: ['Tobillo', 0], pie: ['Pie', 0],
};

/** id de zona → nombre para leer («muslo_ant_izq» → «Muslo anterior izquierdo (cuádriceps)»). Un id desconocido sale tal cual. */
export function nombreZonaCuerpo(zona: string): string {
  if (CENTRO[zona]) return CENTRO[zona];
  const m = /^(.+)_(izq|der)$/.exec(zona);
  const z = m ? POR_LADO[m[1]] : undefined;
  if (!m || !z) return zona;
  return `${z[0]} ${LADO[m[2] as 'izq' | 'der'][z[1]]}${z[2] ? ` (${z[2]})` : ''}`;
}

const TIPO: Record<string, { nombre: string; femenino?: boolean }> = {
  dolor: { nombre: 'Dolor' }, inflamacion: { nombre: 'Inflamación', femenino: true }, edema: { nombre: 'Edema' },
  sensibilidad: { nombre: 'Sensibilidad', femenino: true }, desgarro: { nombre: 'Desgarro' }, tension: { nombre: 'Tensión', femenino: true },
  punto_gatillo: { nombre: 'Punto gatillo' },
};
export const nombreHallazgo = (tipo: string) => TIPO[tipo]?.nombre ?? tipo;

/** «EVA 7/10 (intenso)» para el dolor; «intensidad 4/10 (moderada)» para lo demás. Sin escala → null. */
export function textoEscalaPunto(tipo: string, intensidad: number | null | undefined): string | null {
  if (intensidad == null || !Number.isFinite(intensidad)) return null;
  const n = Math.max(0, Math.min(10, Math.round(intensidad)));
  const f = TIPO[tipo]?.femenino;
  const nivel = n === 0 ? (tipo === 'dolor' ? 'sin dolor' : 'nada')
    : n <= 3 ? 'leve'
    : n <= 6 ? (f ? 'moderada' : 'moderado')
    : n <= 9 ? (f ? 'intensa' : 'intenso')
    : (f ? 'máxima' : 'máximo');
  return `${tipo === 'dolor' ? 'EVA' : 'intensidad'} ${n}/10 (${nivel})`;
}

export interface PuntoMapa { zona: string; tipo: string; intensidad: number | null; nota: string | null; musculos: boolean; estructuras: string[] }

/** Lo guardado en `dibujos_silueta` (vista «cuerpo3d») → lista de puntos limpia. Tolera filas viejas o mal formadas. */
export function puntosDelMapa(anotaciones: unknown): PuntoMapa[] {
  if (!Array.isArray(anotaciones)) return [];
  return anotaciones.flatMap((m) => {
    const x = m as { zona?: unknown; tipo?: unknown; intensidad?: unknown; nota?: unknown; capa?: unknown; estructuras?: unknown } | null;
    if (!x || typeof x.zona !== 'string' || typeof x.tipo !== 'string') return [];
    return [{
      zona: x.zona, tipo: x.tipo, intensidad: typeof x.intensidad === 'number' ? x.intensidad : null,
      nota: typeof x.nota === 'string' && x.nota.trim() ? x.nota.trim() : null, musculos: x.capa === 'musculos',
      estructuras: Array.isArray(x.estructuras) ? x.estructuras.filter((e): e is string => typeof e === 'string') : [],
    }];
  });
}

/** Una línea por punto: «EVA 7/10 (intenso) · Tensor de la fascia lata izq. · nota…» */
export function lineaPunto(p: PuntoMapa): string {
  return [textoEscalaPunto(p.tipo, p.intensidad) ?? 'sin escala', p.estructuras.length ? p.estructuras.join(', ') : null, p.nota].filter(Boolean).join(' · ');
}
