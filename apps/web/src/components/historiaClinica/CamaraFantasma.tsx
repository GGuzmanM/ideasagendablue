// Foto «fantasma» (repetir el encuadre): cámara en vivo con una foto anterior del paciente en
// transparencia encima, para que la nueva salga con el mismo ángulo y distancia y el antes/después se
// compare bien. La referencia sale de las FOTOS CLÍNICAS del paciente (todas sus visitas; por defecto la
// más reciente), no de la silueta del podograma. El fantasma se ve entero (sin recorte) al 80 % y se
// puede achicar, agrandar o arrastrar para calzarlo; la foto que se guarda es solo la de la cámara.
// Cada captura va a «Por guardar» con la zona, lado y tipo de la referencia.
// El pedal o el teclado (Av Pág, flechas, espacio, Enter) también capturan; Esc cierra.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIA_FOTO_LABEL, PIE_LABEL, type FotoPaciente } from '../../api/historiaClinica';
import { useFotoUrl } from '../../services/historiaClinicaService';
import { useCamaraEnVivo } from '../../hooks/useCamaraEnVivo';

const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' });
const TECLAS = ['PageDown', 'PageUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', ' ', 'Enter'];
const ESCALA_INICIAL = 0.8;

export function CamaraFantasma({ referencias, onCapturar, onClose }: {
  referencias: FotoPaciente[]; onCapturar: (archivo: File, ref: FotoPaciente | null) => void; onClose: () => void;
}) {
  // Fotos anteriores del paciente, de la más reciente a la más antigua (la primera es la predeterminada).
  const ordenadas = useMemo(() => [...referencias].sort((a, b) => b.tomadaEn.localeCompare(a.tomadaEn)), [referencias]);
  const [refId, setRefId] = useState<string>(() => ordenadas[0]?.id ?? '');
  const ref = referencias.find((r) => r.id === refId) ?? null;
  const { url } = useFotoUrl(ref?.id);
  const [opacidad, setOpacidad] = useState(0.4);
  // Tamaño y posición del fantasma (la posición en % del recuadro, así no depende del tamaño de pantalla).
  const [escala, setEscala] = useState(ESCALA_INICIAL);
  const [mover, setMover] = useState({ x: 0, y: 0 });
  const arrastreRef = useRef<{ x0: number; y0: number; m0: { x: number; y: number }; w: number; h: number } | null>(null);
  const centrar = () => { setEscala(ESCALA_INICIAL); setMover({ x: 0, y: 0 }); };
  const cam = useCamaraEnVivo(true);
  const [tomadas, setTomadas] = useState(0);
  const [flash, setFlash] = useState(false);

  const capturar = async () => {
    const archivo = await cam.capturar();
    if (!archivo) return;
    onCapturar(archivo, ref);
    setTomadas((n) => n + 1);
    setFlash(true);
    setTimeout(() => setFlash(false), 160);
  };
  // Refs para que el listener de teclado use siempre la versión vigente sin re-suscribirse.
  const capturarRef = useRef(capturar);
  capturarRef.current = capturar;
  const cerrarRef = useRef(onClose);
  cerrarRef.current = onClose;
  useEffect(() => {
    const alPresionar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { cerrarRef.current(); return; }
      if (!TECLAS.includes(ev.key) || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (t?.tagName === 'BUTTON' && (ev.key === ' ' || ev.key === 'Enter')) return; // el botón ya hace su clic
      ev.preventDefault();
      void capturarRef.current();
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, []);

  return (
    <div className="fixed inset-0 z-[130] bg-black/90 flex flex-col" data-testid="camara-fantasma">
      <div className="flex items-center gap-3 flex-wrap px-4 py-3 text-white">
        <span className="font-bold flex items-center gap-2"><span className="material-symbols-outlined">filter_center_focus</span>Foto fantasma</span>
        <label className="flex items-center gap-2 text-xs">Referencia
          <select value={refId} onChange={(ev) => setRefId(ev.target.value)} className="bg-white/10 border border-white/25 rounded-lg px-2 py-1.5 text-sm text-white max-w-[280px]" data-campo="fantasma-referencia">
            {ordenadas.map((r) => (
              <option key={r.id} value={r.id} className="text-black">{fmtFecha(r.tomadaEn)} · {r.zona || CATEGORIA_FOTO_LABEL[r.categoria]}{r.pie ? ` · ${PIE_LABEL[r.pie]}` : ''}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">Transparencia
          <input type="range" min={0} max={0.8} step={0.05} value={opacidad} onChange={(ev) => setOpacidad(Number(ev.target.value))} className="accent-white w-28" />
        </label>
        <label className="flex items-center gap-2 text-xs">Tamaño
          <input type="range" min={0.4} max={1.5} step={0.05} value={escala} onChange={(ev) => setEscala(Number(ev.target.value))} className="accent-white w-28" data-campo="fantasma-tamano" />
          <span className="w-9 tabular-nums">{Math.round(escala * 100)}%</span>
        </label>
        <button onClick={centrar} title="Volver al tamaño y posición iniciales" className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-white/25 hover:bg-white/10">
          <span className="material-symbols-outlined text-base">center_focus_weak</span>Centrar
        </button>
        <button onClick={() => cam.setFrontal((v) => !v)} title="Cambiar de cámara" className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border border-white/25 hover:bg-white/10">
          <span className="material-symbols-outlined text-base">cameraswitch</span>{cam.frontal ? 'Frontal' : 'Trasera'}
        </button>
        <span className="flex-1" />
        <button onClick={onClose} className="material-symbols-outlined text-white/80 hover:text-white">close</button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-3 gap-2">
        {cam.error ? (
          <p className="text-white/90 text-sm max-w-md text-center" data-testid="fantasma-error">{cam.error}</p>
        ) : (
          <>
            {/* Arrastrar dentro del recuadro mueve el fantasma (touch-none: en la tablet no desplaza la página). */}
            <div className="relative inline-block overflow-hidden rounded-lg touch-none cursor-move select-none" data-testid="fantasma-recuadro"
              onPointerDown={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect();
                try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
                arrastreRef.current = { x0: ev.clientX, y0: ev.clientY, m0: mover, w: r.width, h: r.height };
              }}
              onPointerMove={(ev) => {
                const a = arrastreRef.current;
                if (!a) return;
                setMover({ x: a.m0.x + ((ev.clientX - a.x0) / a.w) * 100, y: a.m0.y + ((ev.clientY - a.y0) / a.h) * 100 });
              }}
              onPointerUp={() => { arrastreRef.current = null; }}
              onPointerCancel={() => { arrastreRef.current = null; }}>
              <video ref={cam.videoRef} playsInline muted autoPlay onLoadedMetadata={() => cam.setLista(true)} className="block max-h-[64vh] max-w-full bg-black" />
              {url && cam.lista && (
                <img src={url} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain pointer-events-none" data-testid="fantasma-overlay"
                  style={{ opacity: opacidad, transform: `translate(${mover.x}%, ${mover.y}%) scale(${escala})` }} />
              )}
              {flash && <div className="absolute inset-0 bg-white/70 rounded-lg pointer-events-none" />}
            </div>
            {!cam.lista && <p className="text-white/80 text-sm">Abriendo la cámara…</p>}
          </>
        )}
      </div>

      <div className="flex items-center justify-center gap-6 py-4 text-white">
        <span className="text-xs text-white/80 w-44 text-right" data-testid="fantasma-tomadas">
          {tomadas ? `${tomadas} foto${tomadas === 1 ? '' : 's'} en «Por guardar»` : 'Alinea el pie con la foto anterior (arrástrala o cambia su tamaño)'}
        </span>
        <button onClick={() => void capturar()} disabled={!cam.lista} aria-label="Capturar" title="Capturar (también con el pedal)"
          className="w-16 h-16 rounded-full bg-white border-4 border-white/40 shadow-lg active:scale-95 disabled:opacity-40 transition-transform" data-testid="capturar-fantasma" />
        <button onClick={onClose} className="w-44 text-left text-sm font-semibold underline underline-offset-2">Listo</button>
      </div>
    </div>
  );
}
