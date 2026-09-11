// Medir una úlcera sobre una foto clínica (vista con estado local de la herramienta):
//  1) tocar los dos extremos del marcador de referencia que aparece en la foto (regla o sticker de medida
//     conocida) e indicar cuánto mide;  2) tocar alrededor de la herida.
// Calcula largo, ancho y área (cm, cm²) con utils/medicionUlcera.ts y los entrega para guardarlos como
// medición de úlcera (escala). Los puntos se guardan en píxeles de la imagen original.
import { useState, type MouseEvent } from 'react';
import { useFotoUrl } from '../../services/historiaClinicaService';
import { medir, type P } from '../../utils/medicionUlcera';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const BTN = 'min-h-[44px] lg:min-h-0 px-3 py-2 rounded-lg text-sm lg:text-xs font-semibold border border-outline-variant/40 text-on-surface hover:bg-surface-container-high disabled:opacity-40';

export interface MedicionUlceraFoto { largo: number; ancho: number; area: number; profundidad: number | null; referenciaCm: number }

export function MedidorUlcera({ fotoId, titulo, guardando, onClose, onGuardar }: {
  fotoId: string; titulo: string; guardando?: boolean; onClose: () => void; onGuardar: (m: MedicionUlceraFoto) => void;
}) {
  const { url } = useFotoUrl(fotoId);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);
  const [referencia, setReferencia] = useState<P[]>([]);
  const [refCm, setRefCm] = useState('1');
  const [contorno, setContorno] = useState<P[]>([]);
  const [prof, setProf] = useState('');
  const paso: 'referencia' | 'contorno' = referencia.length < 2 ? 'referencia' : 'contorno';
  const cm = Number(refCm.replace(',', '.'));
  const res = medir(referencia, cm, contorno);

  const tocar = (ev: MouseEvent<SVGSVGElement>) => {
    if (!dim) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const p: P = [((ev.clientX - r.left) / r.width) * dim.w, ((ev.clientY - r.top) / r.height) * dim.h];
    if (paso === 'referencia') setReferencia((x) => [...x, p]); else setContorno((x) => [...x, p]);
  };
  const deshacer = () => { if (contorno.length) setContorno((x) => x.slice(0, -1)); else setReferencia((x) => x.slice(0, -1)); };
  const reiniciar = () => { setReferencia([]); setContorno([]); };
  const lado = dim ? Math.max(dim.w, dim.h) : 1000;
  const radio = lado / 150;
  const linea = lado / 350;
  const guardar = () => {
    if (!res) return;
    const p = prof.trim() ? Number(prof.replace(',', '.')) : null;
    onGuardar({ largo: res.largo, ancho: res.ancho, area: res.area, profundidad: p != null && Number.isFinite(p) ? p : null, referenciaCm: cm });
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/60 flex items-center justify-center p-3" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto p-4 md:p-5" onClick={(e) => e.stopPropagation()} data-testid="medidor-ulcera">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">straighten</span>Medir úlcera sobre la foto</h3>
            <p className="text-xs text-on-surface-variant">{titulo}</p>
          </div>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>
        <div className="flex gap-2 mb-3 text-xs font-semibold">
          <span className={`px-2.5 py-1 rounded-full ${paso === 'referencia' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>1 · Referencia {referencia.length === 2 ? '✓' : `(${referencia.length}/2)`}</span>
          <span className={`px-2.5 py-1 rounded-full ${paso === 'contorno' ? 'bg-rose-100 text-rose-800' : 'bg-surface-container text-on-surface-variant'}`}>2 · Contorno ({contorno.length} puntos)</span>
        </div>
        <p className="text-sm text-on-surface mb-3">
          {paso === 'referencia'
            ? 'Toca los dos extremos del marcador de referencia de la foto (regla, sticker de 1 cm…) y escribe cuánto mide.'
            : 'Ahora toca alrededor del borde de la úlcera, punto por punto. Con 3 puntos ya se calcula; más puntos, más exacto.'}
        </p>
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 min-w-0 flex justify-center">
            <div className="relative inline-block">
              {url
                ? <img src={url} alt="Foto de la úlcera" draggable={false} onLoad={(e) => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} className="block max-h-[62vh] w-auto max-w-full rounded-lg select-none" />
                : <div className="w-80 h-60 bg-surface-container-low rounded-lg animate-pulse" />}
              {dim && (
                <svg viewBox={`0 0 ${dim.w} ${dim.h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full cursor-crosshair" style={{ touchAction: 'manipulation' }} onClick={tocar} data-testid="medidor-lienzo">
                  {referencia.length === 2 && <line x1={referencia[0]![0]} y1={referencia[0]![1]} x2={referencia[1]![0]} y2={referencia[1]![1]} stroke="#facc15" strokeWidth={linea * 1.6} />}
                  {referencia.map((p, i) => <circle key={`r${i}`} cx={p[0]} cy={p[1]} r={radio} fill="#facc15" stroke="#111827" strokeWidth={linea / 2} />)}
                  {contorno.length >= 2 && <polygon points={contorno.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="rgba(220,38,38,0.25)" stroke="#dc2626" strokeWidth={linea} strokeLinejoin="round" />}
                  {contorno.map((p, i) => <circle key={`c${i}`} cx={p[0]} cy={p[1]} r={radio * 0.8} fill="#dc2626" stroke="#ffffff" strokeWidth={linea / 2} />)}
                </svg>
              )}
            </div>
          </div>
          <div className="lg:w-64 shrink-0 space-y-3">
            <div><label className={LBL}>Medida del marcador (cm)</label><input type="number" step="0.1" min={0.1} inputMode="decimal" value={refCm} onChange={(e) => setRefCm(e.target.value)} className={INPUT} /></div>
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3 text-sm" data-testid="medidor-resultado">
              {res ? (
                <>
                  <p><span className="text-on-surface-variant">Largo:</span> <b>{res.largo.toFixed(1)} cm</b></p>
                  <p><span className="text-on-surface-variant">Ancho:</span> <b>{res.ancho.toFixed(1)} cm</b></p>
                  <p><span className="text-on-surface-variant">Área:</span> <b className="text-primary">{res.area.toFixed(1)} cm²</b></p>
                </>
              ) : <p className="text-on-surface-variant text-xs">{referencia.length < 2 ? 'Falta marcar la referencia.' : !(cm > 0) ? 'Escribe cuánto mide el marcador.' : 'Toca al menos 3 puntos del borde.'}</p>}
            </div>
            <div><label className={LBL}>Profundidad (cm, opcional)</label><input type="number" step="0.1" min={0} inputMode="decimal" value={prof} onChange={(e) => setProf(e.target.value)} className={INPUT} /></div>
            <div className="flex gap-2 flex-wrap">
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
