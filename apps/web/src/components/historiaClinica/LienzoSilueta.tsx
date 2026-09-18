// Capa de dibujo a mano alzada sobre la silueta de un pie (modo "Pintar" del podograma). Vista PURA:
// un SVG del tamaño exacto de la caja del pie con los trazos guardados/en borrador; emite el trazo
// terminado, el punto a borrar o el punto a "etiquetar" (elegir un trazo para decir qué es). Mouse, dedo
// y lápiz (pointer events; touch-action none solo mientras se pinta, para que el dedo no desplace la
// página). Fuera del modo pintar solo muestra los trazos (con su significado al pasar el mouse).
import { useRef, useState, type PointerEvent, type RefObject } from 'react';
import { TIPO_LESION_LABEL, type AnotacionPodograma } from '../../api/historiaClinica';
import { puntoTocado } from '../../utils/giroSilueta';
import { ESCALA_PINCEL, MAX_PUNTOS_TRAZO_SILUETA } from '../../utils/trazos';

type Punto = [number, number];
const ANCHO = 1000; // unidades del viewBox a lo ancho; el alto sale de la proporción → escala uniforme

interface Props {
  anotaciones: AnotacionPodograma[];
  aspecto: number; // ancho / alto de la caja del pie
  editable: boolean;
  herramienta: 'lapiz' | 'borrador' | 'etiquetar';
  color: string;
  grosor: number;
  onTrazo: (t: AnotacionPodograma) => void;
  onBorrar: (x: number, y: number) => void;
  onSeleccionar?: (x: number, y: number) => void;
  /** Índice del trazo elegido con "Etiquetar" (se resalta con un contorno punteado). */
  seleccionado?: number | null;
  /** Trazos de capas ocultas: no se dibujan (los índices no cambian). */
  oculto?: (a: AnotacionPodograma) => boolean;
  /**
   * Grados que está inclinada la silueta (la planta se dibuja como una pisada). El SVG se inclina con
   * ella, así que un toque se mide sobre `caja` —el marco SIN inclinar— y se des-inclina: lo que se
   * guarda es el punto del PIE, no el de la pantalla.
   */
  giro?: number;
  caja?: RefObject<HTMLElement | null>;
}

export function LienzoSilueta({ anotaciones, aspecto, editable, herramienta, color, grosor, onTrazo, onBorrar, onSeleccionar, seleccionado = null, oculto, giro = 0, caja }: Props) {
  const alto = ANCHO / aspecto;
  const puntosRef = useRef<Punto[] | null>(null);
  const [enCurso, setEnCurso] = useState<Punto[] | null>(null);

  const coord = (ev: PointerEvent<SVGSVGElement>): Punto => {
    // Con la silueta inclinada, el rectángulo del SVG ya viene girado: se mide sobre el marco recto.
    const r = (caja?.current ?? ev.currentTarget).getBoundingClientRect();
    return puntoTocado((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, giro, aspecto);
  };
  const alBajar = (ev: PointerEvent<SVGSVGElement>) => {
    if (!editable) return;
    ev.preventDefault();
    ev.stopPropagation();
    const p = coord(ev);
    if (herramienta === 'etiquetar') { onSeleccionar?.(p[0], p[1]); return; }
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
    puntosRef.current = [p];
    if (herramienta === 'borrador') { onBorrar(p[0], p[1]); return; }
    setEnCurso([p]);
  };
  const alMover = (ev: PointerEvent<SVGSVGElement>) => {
    const pts = puntosRef.current;
    if (!editable || !pts) return;
    const p = coord(ev);
    if (herramienta === 'borrador') { onBorrar(p[0], p[1]); return; }
    const u = pts[pts.length - 1]!;
    if (Math.hypot(p[0] - u[0], (p[1] - u[1]) / aspecto) < 0.006 || pts.length >= MAX_PUNTOS_TRAZO_SILUETA) return;
    pts.push(p);
    setEnCurso([...pts]);
  };
  const alSoltar = () => {
    const pts = puntosRef.current;
    puntosRef.current = null;
    setEnCurso(null);
    if (!pts || !pts.length || herramienta !== 'lapiz') return;
    onTrazo({ tipo: 'trazo', color, grosor, puntos: pts });
  };

  const d = (pts: Punto[]) =>
    pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * ANCHO).toFixed(1)} ${(y * alto).toFixed(1)}`).join(' ') + (pts.length === 1 ? ' l0.1 0' : '');
  const sel = seleccionado != null ? anotaciones[seleccionado] : null;
  const cursor = !editable ? undefined : herramienta === 'lapiz' ? 'crosshair' : herramienta === 'borrador' ? 'cell' : 'pointer';

  return (
    <svg viewBox={`0 0 ${ANCHO} ${alto.toFixed(1)}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full"
      data-testid="lienzo-silueta"
      style={{ touchAction: editable ? 'none' : 'auto', pointerEvents: editable ? 'auto' : 'none', cursor }}
      onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={alSoltar}>
      {/* Grupo semitransparente: los trazos del mismo color no se oscurecen al superponerse (se "pinta" una zona) */}
      <g opacity={0.55} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {anotaciones.map((a, i) => (a.tipo === 'trazo' && !oculto?.(a)
          ? (
            <path key={i} d={d(a.puntos)} stroke={a.color} strokeWidth={a.grosor * ESCALA_PINCEL}>
              <title>{a.tipoLesion ? TIPO_LESION_LABEL[a.tipoLesion] : 'Sin indicar'}{a.nota ? ` · ${a.nota}` : ''}</title>
            </path>
          )
          : null))}
        {enCurso && <path d={d(enCurso)} stroke={color} strokeWidth={grosor * ESCALA_PINCEL} />}
      </g>
      {/* Trazo elegido con "Etiquetar": contorno punteado encima para que se vea cuál es */}
      {sel && sel.tipo === 'trazo' && !oculto?.(sel) && (
        <path d={d(sel.puntos)} fill="none" stroke="#111827" strokeWidth={10} strokeDasharray="28 18" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      )}
    </svg>
  );
}
