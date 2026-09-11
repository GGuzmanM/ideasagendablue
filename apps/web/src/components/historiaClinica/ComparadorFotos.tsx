// Antes / después con deslizador (1.9, parte 1): dos fotos de la misma zona superpuestas; el
// deslizador descubre la "después" sobre la "antes". Vista pura, funciona con dedo y mouse.
import { useState } from 'react';

interface Props {
  urlAntes: string | null;
  urlDespues: string | null;
  etiquetaAntes: string;
  etiquetaDespues: string;
}

export function ComparadorFotos({ urlAntes, urlDespues, etiquetaAntes, etiquetaDespues }: Props) {
  const [corte, setCorte] = useState(50); // % del ancho descubierto de la foto "después"
  if (!urlAntes || !urlDespues) {
    return <div className="rounded-xl border border-dashed border-outline-variant/40 p-6 text-center text-sm text-on-surface-variant">Cargando fotos…</div>;
  }
  return (
    <div className="space-y-2">
      <div className="relative w-full max-w-[720px] mx-auto rounded-xl overflow-hidden border border-outline-variant/30 bg-surface-container-low select-none" style={{ aspectRatio: '4 / 3' }}>
        <img src={urlAntes} alt={etiquetaAntes} className="absolute inset-0 w-full h-full object-contain" draggable={false} />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${corte}%` }}>
          <img src={urlDespues} alt={etiquetaDespues} className="w-full h-full object-contain" style={{ width: `${10000 / Math.max(corte, 1)}%`, maxWidth: 'none' }} draggable={false} />
        </div>
        <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)] pointer-events-none" style={{ left: `${corte}%` }} />
        <span className="absolute bottom-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded bg-black/60 text-white">{etiquetaDespues}</span>
        <span className="absolute bottom-2 right-2 text-[11px] font-bold px-2 py-0.5 rounded bg-black/60 text-white">{etiquetaAntes}</span>
        <input
          type="range" min={0} max={100} value={corte} onChange={(e) => setCorte(Number(e.target.value))}
          aria-label="Deslizar para comparar"
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 w-full h-10 opacity-0 cursor-ew-resize"
        />
      </div>
      <p className="text-[11px] text-on-surface-variant text-center">Desliza sobre la imagen: izquierda = {etiquetaDespues}, derecha = {etiquetaAntes}.</p>
    </div>
  );
}
