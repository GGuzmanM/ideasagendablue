// Silueta del pie (vista pura) + monofilamento dibujado sobre ella. Son FOTOS reales de ambos pies:
//  · plantar (public/Silueta.jpg): las plantas, dedos arriba; cada pie en una caja de 744×1843.
//  · dorsal  (public/Silueta-dorsal.jpg): el dorso visto desde arriba, dedos abajo y uñas visibles;
//    cada pie en una caja de 874×1960. Sirve para marcar uñas (onicocriptosis, onicomicosis…) y empeine.
// En ambas el pie izquierdo va a la izquierda y el derecho a la derecha, con los dedos gordos hacia el
// centro. Un solo archivo por vista sirve para los dos pies recortando con background-size/position.
// Las zonas de cada vista (y su calibración) viven en utils/zonasPie.ts.
import type { VistaSilueta } from '../../api/historiaClinica';
import { SITIOS_MONOFILAMENTO, coordZona, zonaPorId } from '../../utils/zonasPie';

// Geometría de cada foto (misma unidad que el recorte original): ancho total y ancho de la caja de un pie.
const FOTOS: Record<VistaSilueta, { url: string; anchoImagen: number; anchoPie: number; aspecto: string }> = {
  plantar: { url: '/Silueta.jpg', anchoImagen: 1544, anchoPie: 744, aspecto: '744 / 1843' },
  dorsal: { url: '/Silueta-dorsal.jpg', anchoImagen: 1748, anchoPie: 874, aspecto: '874 / 1960' },
};
/** Proporción ancho/alto de la caja de un pie (usar como `aspectRatio` del contenedor). */
export const aspectoSilueta = (vista: VistaSilueta = 'plantar') => FOTOS[vista].aspecto;
export const ASPECTO_SILUETA = FOTOS.plantar.aspecto;
/** Lo mismo como número (ancho / alto), para la capa de dibujo. */
export const proporcionSilueta = (vista: VistaSilueta = 'plantar') => { const [a, b] = FOTOS[vista].aspecto.split('/').map(Number); return a! / b!; };

export function SiluetaPie({ espejo, vista = 'plantar' }: { espejo?: boolean; vista?: VistaSilueta }) {
  const f = FOTOS[vista];
  return (
    <div aria-hidden className="w-full h-full bg-no-repeat"
      style={{
        backgroundImage: `url(${f.url})`,
        backgroundSize: `${(f.anchoImagen / f.anchoPie) * 100}% 100%`,
        backgroundPosition: espejo ? '100% 0%' : '0% 0%', // derecho = mitad derecha de la foto
        mixBlendMode: 'multiply', // el fondo casi blanco de la foto se funde con la tarjeta (sin recuadro)
      }} />
  );
}

/**
 * Monofilamento sobre la silueta (2.5): 6 sitios por pie, verde = percibe, rojo = NO percibe.
 * `anterior` = resultado de la visita previa: los sitios que cambiaron llevan un anillo ámbar.
 * Sin `onToggle` es solo lectura (para el listado y la comparación).
 */
export function MonofilamentoPie({ pie, valores, anterior, onToggle, titulo, compacto }: {
  pie: 'izquierdo' | 'derecho'; valores: boolean[]; anterior?: boolean[] | null; onToggle?: (i: number) => void; titulo?: string; compacto?: boolean;
}) {
  const tam = compacto ? 'w-4 h-4 text-[8px] border' : 'w-9 h-9 lg:w-7 lg:h-7 text-[11px] lg:text-[10px] border-2';
  return (
    <div className={compacto ? 'w-[52px]' : 'flex-1 min-w-[120px] max-w-[190px]'}>
      {!compacto && <p className="text-center text-xs font-bold text-on-surface-variant mb-1">{titulo ?? (pie === 'izquierdo' ? 'Izquierdo' : 'Derecho')}</p>}
      <div className="relative select-none" style={{ aspectRatio: ASPECTO_SILUETA }}>
        <SiluetaPie espejo={pie === 'derecho'} />
        {SITIOS_MONOFILAMENTO.map((zid, i) => {
          const z = zonaPorId(zid);
          const c = coordZona(zid, pie);
          const v = valores[i] ?? true;
          const prev = anterior?.[i];
          const cambio = prev != null && prev !== v;
          return (
            <button key={zid} type="button" disabled={!onToggle} onClick={() => onToggle?.(i)}
              title={`${z.etiqueta}: ${v ? 'percibe' : 'NO percibe'}${prev != null ? ` · visita anterior: ${prev ? 'percibía' : 'no percibía'}` : ''}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center font-bold text-white border-white shadow transition-colors disabled:cursor-default ${tam} ${v ? 'bg-emerald-500' : 'bg-rose-500'} ${cambio ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
              style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
              {v ? '✓' : '✕'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
