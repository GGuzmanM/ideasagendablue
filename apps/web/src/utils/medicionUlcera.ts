// Medición de una úlcera sobre una foto (geometría pura): con un marcador de tamaño conocido en la
// foto (regla, sticker de 1 cm) se obtiene la escala px/cm; con el contorno tocado alrededor de la
// herida se calculan largo, ancho y área reales. Coordenadas en píxeles de la imagen ORIGINAL, así el
// resultado no depende del tamaño en pantalla.
export type P = [number, number];

export const distancia = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Área del polígono (fórmula del cordón), en px². */
export function areaPoligono(pts: P[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

/** Largo = mayor distancia entre dos puntos del contorno; ancho = extensión perpendicular a ese eje (px). */
export function largoAncho(pts: P[]): { largo: number; ancho: number } {
  let largo = 0;
  let a: P = pts[0] ?? [0, 0];
  let b: P = a;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = distancia(pts[i]!, pts[j]!);
      if (d > largo) { largo = d; a = pts[i]!; b = pts[j]!; }
    }
  }
  if (largo === 0) return { largo: 0, ancho: 0 };
  const ux = (b[0] - a[0]) / largo, uy = (b[1] - a[1]) / largo; // dirección del largo
  const perp = pts.map(([x, y]) => -uy * (x - a[0]) + ux * (y - a[1])); // distancia firmada al eje
  return { largo, ancho: Math.max(...perp) - Math.min(...perp) };
}

export interface ResultadoMedicion { largo: number; ancho: number; area: number; pxPorCm: number }

/** Largo y ancho en cm y área en cm² (una decimal); null si falta la referencia o el contorno (≥ 3 puntos). */
export function medir(referencia: P[], referenciaCm: number, contorno: P[]): ResultadoMedicion | null {
  if (referencia.length < 2 || !(referenciaCm > 0) || contorno.length < 3) return null;
  const pxPorCm = distancia(referencia[0]!, referencia[1]!) / referenciaCm;
  if (!(pxPorCm > 0)) return null;
  const { largo, ancho } = largoAncho(contorno);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { largo: r1(largo / pxPorCm), ancho: r1(ancho / pxPorCm), area: r1(areaPoligono(contorno) / (pxPorCm * pxPorCm)), pxPorCm };
}
