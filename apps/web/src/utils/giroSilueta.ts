// Inclinación de la silueta de la PLANTA (17-sep-2026, pedido del doctor): cada pie se abre unos 20°
// hacia afuera para que las dos plantas juntas se vean como una PISADA normal (el ángulo de la marcha).
// El giro es solo de PRESENTACIÓN: las marcas, los trazos y las zonas se siguen guardando en
// coordenadas del pie SIN inclinar (0..1 dentro de su caja), que es lo anatómico y no depende de cómo
// se dibuje. Por eso aquí solo hay dos cosas: el estilo que inclina lo que se ve y la cuenta inversa,
// que traduce el punto TOCADO en pantalla al punto del pie. Cambiar el ángulo es cambiar un número:
// no hay que migrar nada.
import type { VistaSilueta } from '../api/historiaClinica';

/** Cuánto se abre cada pie, en grados. */
export const GIRO_PLANTA = 20;
/**
 * El giro pivota sobre el TALÓN (no sobre el centro): así los talones quedan casi juntos y las puntas
 * se separan, que es como apoya un pie de verdad.
 */
export const ORIGEN_GIRO = { x: 0.5, y: 0.86 };

/** Grados que se inclina la silueta de un pie. El dorso no se inclina (ahí se marcan uñas). */
export function giroSilueta(vista: VistaSilueta, pie: 'izquierdo' | 'derecho'): number {
  if (vista !== 'plantar') return 0;
  // Cada pie abre hacia su lado lateral (el del 5º dedo): en la planta, el izquierdo hacia la derecha
  // de la pantalla y el derecho hacia la izquierda.
  return pie === 'izquierdo' ? GIRO_PLANTA : -GIRO_PLANTA;
}

/** Estilo para inclinar lo que se ve (imagen, trazos y marcas, todo junto). */
export function estiloGiro(grados: number): { transform: string; transformOrigin: string } | undefined {
  if (!grados) return undefined;
  return { transform: `rotate(${grados}deg)`, transformOrigin: `${ORIGEN_GIRO.x * 100}% ${ORIGEN_GIRO.y * 100}%` };
}

/**
 * Gira un punto del pie (0..1) para saber DÓNDE SE VE. `aspecto` = ancho / alto de la caja: hace falta
 * porque la caja no es cuadrada y un giro en píxeles no es el mismo en coordenadas normalizadas.
 */
export function girarPunto(x: number, y: number, grados: number, aspecto: number): [number, number] {
  if (!grados) return [x, y];
  const r = (grados * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = x - ORIGEN_GIRO.x, dy = y - ORIGEN_GIRO.y;
  return [
    ORIGEN_GIRO.x + dx * c - (dy * s) / aspecto,
    ORIGEN_GIRO.y + dx * s * aspecto + dy * c,
  ];
}

/** La cuenta inversa: del punto TOCADO en pantalla al punto del pie (lo que se guarda). */
export function desgirarPunto(x: number, y: number, grados: number, aspecto: number): [number, number] {
  return girarPunto(x, y, -grados, aspecto);
}

/** Igual que `desgirarPunto` pero recortando a la caja (lo que se guarda nunca sale de 0..1). */
export function puntoTocado(x: number, y: number, grados: number, aspecto: number): [number, number] {
  const [px, py] = desgirarPunto(x, y, grados, aspecto);
  const dentro = (v: number) => Math.min(1, Math.max(0, v));
  return [dentro(px), dentro(py)];
}
