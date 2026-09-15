// Recuadro de firma para la tablet (dedo o lápiz). Guarda TRAZOS normalizados 0..1 (no una imagen):
// pesan poco, no dependen del tamaño de pantalla y el PDF los redibuja como vector.
import { useEffect, useRef, useState, type PointerEvent as EventoPuntero } from 'react';
import type { TrazoFirma } from '../../api/historiaClinica';

export const ASPECTO_FIRMA = 3; // ancho / alto del lienzo

export function FirmaPad({ trazos, onChange, deshabilitado }: { trazos: TrazoFirma[]; onChange: (t: TrazoFirma[]) => void; deshabilitado?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actual = useRef<TrazoFirma | null>(null);
  const [ancho, setAncho] = useState(0);

  // El lienzo sigue el ancho del contenedor (rotar la tablet, abrir el panel lateral).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const dibujar = (lista: TrazoFirma[]) => {
    const c = canvasRef.current;
    if (!c || !ancho) return;
    const dpr = window.devicePixelRatio || 1;
    const alto = ancho / ASPECTO_FIRMA;
    if (c.width !== Math.round(ancho * dpr)) { c.width = Math.round(ancho * dpr); c.height = Math.round(alto * dpr); }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, ancho, alto);
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#0B1F44';
    for (const t of lista) {
      if (!t.puntos.length) continue;
      g.lineWidth = t.grosor ?? 3;
      g.beginPath();
      const [x0, y0] = t.puntos[0];
      g.moveTo(x0 * ancho, y0 * alto);
      if (t.puntos.length === 1) g.lineTo(x0 * ancho + 0.5, y0 * alto + 0.5);
      for (const [x, y] of t.puntos.slice(1)) g.lineTo(x * ancho, y * alto);
      g.stroke();
    }
  };
  useEffect(() => { dibujar(trazos); });

  const punto = (e: EventoPuntero<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000];
  };
  const bajar = (e: EventoPuntero<HTMLCanvasElement>) => {
    if (deshabilitado) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    actual.current = { puntos: [punto(e)], grosor: e.pointerType === 'pen' ? 2.5 : 3 };
    dibujar([...trazos, actual.current]);
  };
  const mover = (e: EventoPuntero<HTMLCanvasElement>) => {
    if (!actual.current) return;
    e.preventDefault();
    const p = punto(e);
    const u = actual.current.puntos[actual.current.puntos.length - 1];
    if (Math.abs(p[0] - u[0]) + Math.abs(p[1] - u[1]) < 0.002) return; // no guardar puntos repetidos
    actual.current.puntos.push(p);
    dibujar([...trazos, actual.current]);
  };
  const soltar = () => {
    if (!actual.current) return;
    const t = actual.current;
    actual.current = null;
    onChange([...trazos, t]);
  };

  return (
    <div className="space-y-1.5">
      <div className="relative rounded-xl border-2 border-dashed border-outline-variant bg-white">
        <canvas ref={canvasRef} data-testid="firma-pad"
          onPointerDown={bajar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} onPointerLeave={soltar}
          style={{ width: '100%', aspectRatio: String(ASPECTO_FIRMA), touchAction: 'none', display: 'block' }}
          className={deshabilitado ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'} />
        {!trazos.length && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-on-surface-variant/60">Firme aquí con el dedo o el lápiz</span>}
        <span className="pointer-events-none absolute left-4 right-4 bottom-[22%] border-b border-outline-variant/60" />
      </div>
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => onChange(trazos.slice(0, -1))} disabled={!trazos.length || deshabilitado} className="text-primary font-semibold hover:underline disabled:opacity-40">Deshacer trazo</button>
        <button type="button" onClick={() => onChange([])} disabled={!trazos.length || deshabilitado} className="text-rose-600 font-semibold hover:underline disabled:opacity-40">Borrar firma</button>
      </div>
    </div>
  );
}
