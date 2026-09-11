// Medir una úlcera sobre una foto clínica (vista con estado local de la herramienta):
//  1) tocar los dos extremos del marcador de referencia que aparece en la foto (regla o sticker de medida
//     conocida) e indicar cuánto mide;
//  2) tocar el borde de la herida punto por punto; se siguen agregando puntos hasta CERRAR el contorno:
//     tocando otra vez el primer punto (el blanco), volviendo a tocar el último, o con «Cerrar contorno».
// Cualquier punto ya puesto (referencia o contorno) se puede ARRASTRAR para ajustarlo. Con el contorno
// cerrado se calculan largo, ancho y área (utils/medicionUlcera.ts) y se entregan para guardarlos como
// medición de úlcera (escala). Los puntos se guardan en píxeles de la imagen original.
import { useRef, useState, type PointerEvent } from 'react';
import { useFotoUrl } from '../../services/historiaClinicaService';
import { distancia, medir, type P } from '../../utils/medicionUlcera';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const BTN = 'min-h-[44px] lg:min-h-0 px-3 py-2 rounded-lg text-sm lg:text-xs font-semibold border border-outline-variant/40 text-on-surface hover:bg-surface-container-high disabled:opacity-40';
/** Radio del "dedo" en px de pantalla: tocar a esta distancia de un punto lo toma (para moverlo o cerrar). */
const TOQUE_PX = 22;
/** Volver a tocar el ÚLTIMO punto cierra el contorno solo si el toque cae justo encima (evita cierres por puntos muy juntos). */
const REPETIR_PX = 10;

export interface MedicionUlceraFoto { largo: number; ancho: number; area: number; profundidad: number | null; referenciaCm: number }
type Lista = 'referencia' | 'contorno';

export function MedidorUlcera({ fotoId, titulo, guardando, onClose, onGuardar }: {
  fotoId: string; titulo: string; guardando?: boolean; onClose: () => void; onGuardar: (m: MedicionUlceraFoto) => void;
}) {
  const { url } = useFotoUrl(fotoId);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [referencia, setReferencia] = useState<P[]>([]);
  const [refCm, setRefCm] = useState('1');
  const [contorno, setContorno] = useState<P[]>([]);
  const [cerrado, setCerrado] = useState(false);
  const [prof, setProf] = useState('');
  // Toque en curso: sobre qué punto empezó (si fue sobre uno) y si ya se movió (= arrastre).
  const toqueRef = useRef<{ lista: Lista | null; i: number; inicio: P; movido: boolean; tol: number } | null>(null);
  const paso: Lista = referencia.length < 2 ? 'referencia' : 'contorno';
  const cm = Number(refCm.replace(',', '.'));
  const res = cerrado ? medir(referencia, cm, contorno) : null;

  const aImagen = (ev: PointerEvent<SVGSVGElement>): P => {
    const r = ev.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * dim!.w, Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) * dim!.h];
  };
  const tolerancia = (ev: PointerEvent<SVGSVGElement>) => (TOQUE_PX / ev.currentTarget.getBoundingClientRect().width) * dim!.w;
  /** Punto ya puesto más cercano dentro de la tolerancia (el contorno tiene prioridad). */
  const puntoBajo = (p: P, tol: number): { lista: Lista; i: number } | null => {
    let mejor: { lista: Lista; i: number } | null = null;
    let d = tol;
    contorno.forEach((q, i) => { const dd = distancia(p, q); if (dd <= d) { d = dd; mejor = { lista: 'contorno', i }; } });
    referencia.forEach((q, i) => { const dd = distancia(p, q); if (dd < d) { d = dd; mejor = { lista: 'referencia', i }; } });
    return mejor;
  };
  const moverPunto = (lista: Lista, i: number, p: P) => (lista === 'referencia' ? setReferencia : setContorno)((xs) => xs.map((q, k) => (k === i ? p : q)));

  const alBajar = (ev: PointerEvent<SVGSVGElement>) => {
    if (!dim) return;
    ev.preventDefault();
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
    const p = aImagen(ev);
    const tol = tolerancia(ev);
    const bajo = puntoBajo(p, tol);
    toqueRef.current = { lista: bajo?.lista ?? null, i: bajo?.i ?? -1, inicio: p, movido: false, tol };
  };
  const alMover = (ev: PointerEvent<SVGSVGElement>) => {
    const t = toqueRef.current;
    if (!t || !t.lista || !dim) return;
    const p = aImagen(ev);
    if (!t.movido && distancia(p, t.inicio) < t.tol / 3) return; // temblor del dedo: todavía es un toque
    t.movido = true;
    moverPunto(t.lista, t.i, p);
  };
  const alSoltar = (ev: PointerEvent<SVGSVGElement>) => {
    const t = toqueRef.current;
    toqueRef.current = null;
    if (!t || !dim || t.movido) return; // fue un arrastre: el punto ya quedó en su nuevo lugar
    const p = aImagen(ev);
    if (paso === 'referencia') {
      if (t.lista !== 'referencia') setReferencia((x) => [...x, p]); // tocar encima de un punto ya puesto no agrega otro
      return;
    }
    if (cerrado) return; // contorno cerrado: los toques sueltos no agregan (se ajusta arrastrando)
    if (t.lista === 'contorno' && contorno.length >= 3) {
      // Cerrar: tocar el primer punto (el blanco) o volver a tocar justo encima del último.
      const pxPantalla = distancia(t.inicio, contorno[t.i]!) * (ev.currentTarget.getBoundingClientRect().width / dim.w);
      if (t.i === 0 || (t.i === contorno.length - 1 && pxPantalla <= REPETIR_PX)) { setCerrado(true); return; }
    }
    setContorno((x) => [...x, p]); // cualquier otro toque (aunque esté cerca de otro punto) agrega uno nuevo
  };
  const deshacer = () => {
    if (cerrado) setCerrado(false);
    else if (contorno.length) setContorno((x) => x.slice(0, -1));
    else setReferencia((x) => x.slice(0, -1));
  };
  const reiniciar = () => { setReferencia([]); setContorno([]); setCerrado(false); };
  const lado = dim ? Math.max(dim.w, dim.h) : 1000;
  const radio = lado / 150;
  const linea = lado / 350;
  const guardar = () => {
    if (!res) return;
    const p = prof.trim() ? Number(prof.replace(',', '.')) : null;
    onGuardar({ largo: res.largo, ancho: res.ancho, area: res.area, profundidad: p != null && Number.isFinite(p) ? p : null, referenciaCm: cm });
  };
  const puntosTxt = contorno.map((p) => `${p[0]},${p[1]}`).join(' ');
  const primero = contorno[0];
  const ultimo = contorno[contorno.length - 1];

  return (
    // Anclado ARRIBA (no centrado): si la columna lateral cambia de alto, un modal centrado se recentra y la
    // foto se desplaza entre un toque y el siguiente.
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-start justify-center p-3 pt-[3vh]" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto p-4 md:p-5" onClick={(e) => e.stopPropagation()} data-testid="medidor-ulcera">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">straighten</span>Medir úlcera sobre la foto</h3>
            <p className="text-xs text-on-surface-variant">{titulo}</p>
          </div>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>
        {/* Las instrucciones y el estado van en la columna lateral: si estuvieran encima de la foto, al cambiar de
            largo moverían la imagen entre un toque y otro (el punto caería corrido bajo el dedo). */}
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 flex justify-center items-start">
            <div className="relative inline-block">
              {url
                ? <img src={url} alt="Foto de la úlcera" draggable={false} onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="block max-h-[62vh] w-auto max-w-full rounded-lg select-none" />
                : <div className="w-80 h-60 bg-surface-container-low rounded-lg animate-pulse" />}
              {dim && (
                <svg viewBox={`0 0 ${dim.w} ${dim.h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full cursor-crosshair" style={{ touchAction: 'none' }}
                  onPointerDown={alBajar} onPointerMove={alMover} onPointerUp={alSoltar} onPointerCancel={() => { toqueRef.current = null; }} data-testid="medidor-lienzo">
                  {referencia.length === 2 && <line x1={referencia[0]![0]} y1={referencia[0]![1]} x2={referencia[1]![0]} y2={referencia[1]![1]} stroke="#facc15" strokeWidth={linea * 1.6} />}
                  {referencia.map((p, i) => <circle key={`r${i}`} cx={p[0]} cy={p[1]} r={radio} fill="#facc15" stroke="#111827" strokeWidth={linea / 2} />)}
                  {contorno.length >= 2 && (cerrado
                    ? <polygon points={puntosTxt} fill="rgba(220,38,38,0.25)" stroke="#dc2626" strokeWidth={linea} strokeLinejoin="round" />
                    : <polyline points={puntosTxt} fill="none" stroke="#dc2626" strokeWidth={linea} strokeLinejoin="round" strokeLinecap="round" />)}
                  {/* Vista previa del cierre: línea punteada del último punto al primero */}
                  {!cerrado && contorno.length >= 3 && primero && ultimo && (
                    <line x1={ultimo[0]} y1={ultimo[1]} x2={primero[0]} y2={primero[1]} stroke="#dc2626" strokeWidth={linea * 0.7} strokeDasharray={`${linea * 3} ${linea * 3}`} opacity={0.6} />
                  )}
                  {contorno.map((p, i) => (
                    <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={i === 0 ? radio * 1.15 : radio * 0.8} fill={i === 0 ? '#ffffff' : '#dc2626'} stroke="#dc2626" strokeWidth={i === 0 ? linea : linea / 2} />
                  ))}
                  {/* Aro que invita a tocar el primer punto para cerrar */}
                  {!cerrado && contorno.length >= 3 && primero && <circle cx={primero[0]} cy={primero[1]} r={radio * 2.2} fill="none" stroke="#dc2626" strokeWidth={linea / 1.5} className="animate-pulse" />}
                </svg>
              )}
            </div>
          </div>
          <div className="lg:w-72 shrink-0 space-y-3">
            <div className="flex gap-2 text-xs font-semibold flex-wrap">
              <span className={`px-2.5 py-1 rounded-full ${paso === 'referencia' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>1 · Referencia {referencia.length === 2 ? '✓' : `(${referencia.length}/2)`}</span>
              <span className={`px-2.5 py-1 rounded-full ${cerrado ? 'bg-emerald-100 text-emerald-700' : paso === 'contorno' ? 'bg-rose-100 text-rose-800' : 'bg-surface-container text-on-surface-variant'}`} data-testid="medidor-estado-contorno">
                2 · Contorno ({contorno.length} puntos){cerrado ? ' · cerrado ✓' : ''}
              </span>
            </div>
            <p className="text-sm text-on-surface">
              {paso === 'referencia'
                ? 'Toca los dos extremos del marcador de referencia de la foto (regla, sticker de 1 cm…) y escribe cuánto mide.'
                : cerrado
                  ? 'Contorno cerrado. Arrastra cualquier punto para ajustarlo; «Deshacer punto» lo vuelve a abrir.'
                  : contorno.length < 3
                    ? 'Ahora toca el borde de la úlcera, punto por punto.'
                    : 'Sigue tocando el borde. Para terminar, toca el primer punto (el blanco), vuelve a tocar el último o usa «Cerrar contorno».'}
              {' '}<span className="text-on-surface-variant">Los puntos ya puestos se pueden arrastrar.</span>
            </p>
            <div><label className={LBL}>Medida del marcador (cm)</label><input type="number" step="0.1" min={0.1} inputMode="decimal" value={refCm} onChange={(e) => setRefCm(e.target.value)} className={INPUT} /></div>
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3 text-sm" data-testid="medidor-resultado">
              {res ? (
                <>
                  <p><span className="text-on-surface-variant">Largo:</span> <b>{res.largo.toFixed(1)} cm</b></p>
                  <p><span className="text-on-surface-variant">Ancho:</span> <b>{res.ancho.toFixed(1)} cm</b></p>
                  <p><span className="text-on-surface-variant">Área:</span> <b className="text-primary">{res.area.toFixed(1)} cm²</b></p>
                </>
              ) : (
                <p className="text-on-surface-variant text-xs">
                  {referencia.length < 2 ? 'Falta marcar la referencia.' : !(cm > 0) ? 'Escribe cuánto mide el marcador.' : contorno.length < 3 ? 'Toca al menos 3 puntos del borde.' : 'Cierra el contorno para calcular.'}
                </p>
              )}
            </div>
            <div><label className={LBL}>Profundidad (cm, opcional)</label><input type="number" step="0.1" min={0} inputMode="decimal" value={prof} onChange={(e) => setProf(e.target.value)} className={INPUT} /></div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setCerrado(true)} disabled={cerrado || contorno.length < 3} className={BTN}>Cerrar contorno</button>
              <button onClick={deshacer} disabled={!referencia.length && !contorno.length} className={BTN}>Deshacer punto</button>
              <button onClick={reiniciar} disabled={!referencia.length && !contorno.length} className={BTN}>Reiniciar</button>
            </div>
            <button onClick={guardar} disabled={!res || guardando} className="w-full min-h-[44px] lg:min-h-0 px-4 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
              <span className="material-symbols-outlined text-base">save</span>{guardando ? 'Guardando…' : 'Guardar medición'}
            </button>
            <p className="text-[11px] text-on-surface-variant">Se guarda en Escalas como «Úlcera (medidas)» y entra en la curva de evolución de esa ubicación.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
