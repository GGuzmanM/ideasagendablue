// Utilidades de los trazos a mano alzada sobre la silueta (modo "Pintar" del podograma).
// Coordenadas 0..1 dentro de la caja del pie; la caja NO es cuadrada (≈ 0,4 de ancho por 1 de alto),
// así que las distancias se miden en "anchos de caja" corrigiendo el eje vertical con la proporción.
import type { AnotacionPodograma } from '../api/historiaClinica';

/** El grosor guardado usa la escala de la Baro (grosor/1000 del ancho); en la silueta se multiplica para que sirva de pincel. */
export const ESCALA_PINCEL = 3;
/** Máximo de puntos por trazo (el backend acepta más; esto evita trazos gigantes con el dedo quieto). */
export const MAX_PUNTOS_TRAZO_SILUETA = 600;

/**
 * Índice del trazo más reciente que pasa cerca de (x, y), o −1. `aspecto` = ancho/alto de la caja.
 * `saltar` descarta trazos (p. ej. los de una capa oculta): no se pueden borrar ni etiquetar sin verlos.
 */
export function indiceTrazoEn(lista: AnotacionPodograma[], x: number, y: number, aspecto: number, saltar?: (a: AnotacionPodograma) => boolean): number {
  for (let i = lista.length - 1; i >= 0; i--) {
    const a = lista[i]!;
    if (a.tipo !== 'trazo' || saltar?.(a)) continue;
    const tol = 0.03 + (a.grosor * ESCALA_PINCEL) / 2000; // media anchura del pincel + margen para el dedo
    if (a.puntos.some(([px, py]) => Math.hypot(px - x, (py - y) / aspecto) <= tol)) return i;
  }
  return -1;
}
