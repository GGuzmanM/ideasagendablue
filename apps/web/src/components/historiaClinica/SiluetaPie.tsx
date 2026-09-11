// Silueta PLANTAR del pie (vista pura, SVG) + monofilamento dibujado sobre ella.
// Vista plantar del pie izquierdo: dedo gordo al lado medial (derecha), dedos menores decreciendo
// hacia el lateral, arco medial y talón redondeado. El derecho es el espejo → mostrados lado a lado,
// los dedos gordos quedan hacia el centro, como en una impresión de Baro.
import { SITIOS_MONOFILAMENTO, coordZona, zonaPorId } from '../../utils/zonasPie';

export function SiluetaPie({ espejo }: { espejo?: boolean }) {
  const gid = espejo ? 'piel-der' : 'piel-izq'; // un gradiente por instancia (ids únicos en el DOM)
  const piel = `url(#${gid})`;
  const borde = { stroke: '#c9a58f', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 100 240" className="w-full h-full" style={espejo ? { transform: 'scaleX(-1)' } : undefined} aria-hidden>
      <defs>
        <radialGradient id={gid} cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#fbeee4" />
          <stop offset="100%" stopColor="#f0dac9" />
        </radialGradient>
      </defs>
      {/* Planta: antepié ancho, arco medial cóncavo, talón redondeado */}
      <path d="M16 62 C20 46 36 38 54 40 C68 41 80 46 86 56 C92 68 90 88 84 106 C76 122 72 142 75 166 C77 192 74 220 58 232 C46 240 30 234 24 220 C16 202 12 172 12 142 C12 112 10 82 16 62 Z"
        fill={piel} {...borde} strokeWidth="1.8" strokeLinejoin="round" />
      {/* Zonas de apoyo (antepié y talón), sutiles */}
      <ellipse cx="54" cy="66" rx="30" ry="14" fill="#e3b39c" opacity="0.28" />
      <ellipse cx="48" cy="206" rx="18" ry="20" fill="#e3b39c" opacity="0.28" />
      <path d="M22 96 C30 120 30 150 26 178" fill="none" stroke="#dcb8a3" strokeWidth="1.2" opacity="0.6" />
      {/* Dedos: gordo (medial, grande) → 5º dedo (lateral, pequeño) */}
      <ellipse cx="70" cy="26" rx="12" ry="15" fill={piel} {...borde} />
      <ellipse cx="50" cy="26" rx="6.5" ry="9" fill={piel} {...borde} />
      <ellipse cx="37" cy="29" rx="6" ry="8" fill={piel} {...borde} />
      <ellipse cx="26" cy="37" rx="5.5" ry="7" fill={piel} {...borde} />
      <ellipse cx="17" cy="49" rx="5" ry="6" fill={piel} {...borde} />
    </svg>
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
      <div className="relative aspect-[100/240] select-none">
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
