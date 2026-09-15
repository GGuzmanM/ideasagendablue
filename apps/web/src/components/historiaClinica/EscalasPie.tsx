// Formularios de las escalas del pie (vista pura; la lógica vive en useEscalas): ITB y pulsos (2.4),
// OSI de onicomicosis (2.6), Manchester de hallux valgus (2.7) y examen del pie (1.5) con la guía de
// desgaste de la suela. Los cálculos están en utils/escalasPie.ts (mismas reglas que el backend).
import type { ReactNode } from 'react';
import type { useEscalas } from '../../services/historiaClinicaService';
import {
  GRUPOS_EXAMEN, CALZADO_TIPOS, CALZADO_PROBLEMAS, ZONAS_DESGASTE, MANCHESTER, OSI_UNAS, OSI_AREA, OSI_PROXIMIDAD, PULSO_LABEL,
  interpretarItb, severidadOsi, lecturaDesgaste, type EstadoPulso, type NivelItb, type ZonaDesgaste, type CamposItb, type PulsosPie,
} from '../../utils/escalasPie';

type E = ReturnType<typeof useEscalas>;

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const CHIP = (on: boolean) => `min-h-[40px] lg:min-h-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-40 ${on ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'}`;
/** Fecha "AAAA-MM-DD…" → "DD/MM/AAAA" sin corrimiento de zona horaria (las fechas de atención son de día). */
const fmtFecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

function Casilla({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={`flex items-center gap-2 text-sm text-on-surface min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border ${checked ? 'border-primary bg-primary/5' : 'border-outline-variant/40'}`}>
      <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="accent-primary w-4 h-4" />{children}
    </label>
  );
}

function SiNo({ valor, onCambio, campo }: { valor: boolean | null; onCambio: (v: boolean | null) => void; campo: string }) {
  return (
    <div className="flex gap-1.5" data-campo={campo}>
      {([true, false] as const).map((v) => (
        <button key={String(v)} type="button" onClick={() => onCambio(valor === v ? null : v)} className={CHIP(valor === v)}>{v ? 'Sí' : 'No'}</button>
      ))}
    </div>
  );
}

// ── ITB y pulsos ─────────────────────────────────────────────────────────────
const COLOR_ITB: Record<NivelItb, string> = {
  normal: 'bg-emerald-100 text-emerald-800', limite: 'bg-yellow-100 text-yellow-800', leve: 'bg-amber-100 text-amber-800',
  moderada: 'bg-orange-100 text-orange-800', grave: 'bg-rose-100 text-rose-800', no_compresible: 'bg-violet-100 text-violet-800',
};

function ChipItb({ v }: { v: number | null }) {
  if (v == null) return <span className="text-on-surface-variant">—</span>;
  const i = interpretarItb(v);
  return <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${COLOR_ITB[i.nivel]}`}>{v.toFixed(2)} · {i.texto}</span>;
}

function SelectPulso({ valor, onCambio, campo }: { valor: EstadoPulso | ''; onCambio: (v: EstadoPulso | '') => void; campo: string }) {
  return (
    <select value={valor} onChange={(ev) => onCambio(ev.target.value as EstadoPulso | '')} className={`${INPUT} min-w-[130px] ${valor === 'ausente' ? 'text-rose-700 font-semibold' : ''}`} data-campo={campo}>
      <option value="">—</option>
      {(Object.keys(PULSO_LABEL) as EstadoPulso[]).map((p) => <option key={p} value={p}>{PULSO_LABEL[p]}</option>)}
    </select>
  );
}

const FILAS_ITB: { lado: string; pedia: keyof CamposItb; tibial: keyof CamposItb; pPedio: keyof PulsosPie; pTibial: keyof PulsosPie; itb: 'itbIzq' | 'itbDer' }[] = [
  { lado: 'Izquierdo', pedia: 'pediaIzq', tibial: 'tibialIzq', pPedio: 'pedioIzq', pTibial: 'tibialIzq', itb: 'itbIzq' },
  { lado: 'Derecho', pedia: 'pediaDer', tibial: 'tibialDer', pPedio: 'pedioDer', pTibial: 'tibialDer', itb: 'itbDer' },
];

export function FormItb({ e }: { e: E }) {
  const presion = (k: keyof CamposItb) => (
    <input type="number" min={0} max={300} inputMode="numeric" value={e.itb[k]} onChange={(ev) => e.setCampoItb(k, ev.target.value)} placeholder="mmHg" className={`${INPUT} w-24`} data-campo={k} />
  );
  const eap = [e.itbIzq, e.itbDer].some((v) => v != null && v <= 0.9) || Object.values(e.pulsos).includes('ausente');
  return (
    <div className="mb-4 space-y-3" data-testid="form-itb">
      <p className="text-xs text-on-surface-variant">Presión sistólica (mmHg) con doppler en ambos brazos y, en cada tobillo, en la arteria pedia y la tibial posterior. <b>ITB de cada pie = mayor presión del tobillo ÷ mayor presión braquial.</b> Los pulsos se pueden registrar solos, sin doppler.</p>
      <div className="flex flex-wrap gap-3">
        <div><label className={LBL}>Brazo izquierdo</label>{presion('braqIzq')}</div>
        <div><label className={LBL}>Brazo derecho</label>{presion('braqDer')}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm min-w-[640px]">
          <thead>
            <tr className="text-[10px] font-semibold uppercase text-on-surface-variant text-left">
              <th className="pr-3 py-1">Pie</th><th className="px-1">Pedia</th><th className="px-1">Tibial post.</th><th className="px-1">Pulso pedio</th><th className="px-1">Pulso tibial post.</th><th className="px-1">ITB</th>
            </tr>
          </thead>
          <tbody>
            {FILAS_ITB.map((f) => (
              <tr key={f.lado}>
                <td className="pr-3 py-1 font-bold text-on-surface">{f.lado}</td>
                <td className="px-1 py-1">{presion(f.pedia)}</td>
                <td className="px-1 py-1">{presion(f.tibial)}</td>
                <td className="px-1 py-1"><SelectPulso valor={e.pulsos[f.pPedio]} onCambio={(v) => e.setPulso(f.pPedio, v)} campo={`pulso-${f.pPedio}`} /></td>
                <td className="px-1 py-1"><SelectPulso valor={e.pulsos[f.pTibial]} onCambio={(v) => e.setPulso(f.pTibial, v)} campo={`pulso-${f.pTibial}`} /></td>
                <td className="px-1 py-1" data-testid={`itb-${f.itb}`}><ChipItb v={e[f.itb]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-on-surface-variant">Normal 1,00–1,40 · limítrofe 0,91–0,99 · EAP leve 0,70–0,90 · moderada 0,40–0,69 · grave &lt; 0,40 · mayor a 1,40 = arteria no compresible (frecuente en diabetes).</p>
      {eap && <p className="text-sm font-semibold text-rose-700 flex items-center gap-1"><span className="material-symbols-outlined text-base">warning</span>Sugiere enfermedad arterial periférica: el IWGDF de hoy lo tomará como sugerencia.</p>}
    </div>
  );
}

// ── OSI (onicomicosis) ───────────────────────────────────────────────────────
const COLOR_OSI = { nula: 'text-emerald-700', leve: 'text-yellow-700', moderada: 'text-amber-700', grave: 'text-rose-700' } as const;

export function FormOsi({ e }: { e: E }) {
  const sev = severidadOsi(e.osiPuntaje);
  const dif = e.osiAnterior ? e.osiPuntaje - e.osiAnterior.puntaje : null;
  return (
    <div className="mb-4 space-y-3" data-testid="form-osi">
      <p className="text-xs text-on-surface-variant">Una uña por registro. <b>Puntaje = área afectada × cercanía a la matriz</b>, +10 si hay dermatofitoma (banda o mancha) o hiperqueratosis subungueal mayor a 2 mm. Leve 1–5 · moderada 6–15 · grave 16–35.</p>
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div><label className={LBL}>Pie</label>
          <select value={e.osiPie} onChange={(ev) => e.setOsiPie(ev.target.value as 'izquierdo' | 'derecho' | '')} className={INPUT} data-campo="osi-pie">
            <option value="">Elige…</option><option value="izquierdo">Izquierdo</option><option value="derecho">Derecho</option>
          </select>
        </div>
        <div><label className={LBL}>Uña</label>
          <select value={e.osiUna} onChange={(ev) => e.setOsiUna(ev.target.value)} className={INPUT} data-campo="osi-una">
            {OSI_UNAS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </div>
      </div>
      <div><p className={LBL}>Área de la uña afectada</p>
        <div className="flex flex-wrap gap-1.5">
          {OSI_AREA.map((t, i) => <button key={i} type="button" onClick={() => e.setOsiArea(i)} className={CHIP(e.osiArea === i)} data-osi-area={i}><b>{i}</b> · {t}</button>)}
        </div>
      </div>
      <div><p className={LBL}>Cercanía a la matriz (desde el borde libre)</p>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={!e.osiArea} onClick={() => e.setOsiProx(n)} className={CHIP(!!e.osiArea && e.osiProx === n)} data-osi-prox={n}><b>{n}</b> · {OSI_PROXIMIDAD[n]}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Casilla checked={e.osiDerm} onChange={e.setOsiDerm}>Dermatofitoma (banda o mancha longitudinal)</Casilla>
        <Casilla checked={e.osiHiper} onChange={e.setOsiHiper}>Hiperqueratosis subungueal &gt; 2 mm</Casilla>
      </div>
      <p className="text-sm"><span className={LBL}>Puntaje calculado</span>
        <b className={`text-base ${COLOR_OSI[sev.nivel]}`} data-testid="osi-puntaje">OSI {e.osiPuntaje}/35 · {sev.texto}</b>
        {e.osiAnterior && dif != null && (
          <span className={`ml-2 ${dif < 0 ? 'text-emerald-700' : dif > 0 ? 'text-rose-700' : 'text-on-surface-variant'}`}>
            · anterior {e.osiAnterior.puntaje} ({fmtFecha(e.osiAnterior.fecha)}) → {dif < 0 ? `mejoró ${-dif}` : dif > 0 ? `empeoró ${dif}` : 'igual'}
          </span>
        )}
      </p>
      {!e.osiPie && <p className="text-[11px] text-amber-700">Elige el pie para poder registrar.</p>}
    </div>
  );
}

// ── Manchester (hallux valgus) ───────────────────────────────────────────────
/** Figura simple del 1er radio: el hallux se desvía hacia el 2º dedo y el juanete crece con el grado. */
function IconoHallux({ angulo, grado }: { angulo: number; grado: number }) {
  const a = (angulo * Math.PI) / 180;
  const x2 = 16 + 22 * Math.sin(a), y2 = 34 - 22 * Math.cos(a);
  return (
    <svg viewBox="0 0 48 64" className="w-10 h-14" aria-hidden>
      <line x1="34" y1="62" x2="34" y2="28" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.3" />
      <line x1="16" y1="62" x2="16" y2="34" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <line x1="16" y1="34" x2={x2} y2={y2} stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      {grado > 1 && <circle cx={15 - (grado - 1) * 1.4} cy="36" r={1.6 + (grado - 1) * 1.7} fill="currentColor" opacity="0.45" />}
    </svg>
  );
}

export function FormManchester({ e }: { e: E }) {
  const columna = (lado: 'Izquierdo' | 'Derecho', valor: number | null, set: (g: number | null) => void) => (
    <div>
      <p className={LBL}>{lado}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {MANCHESTER.map((m) => (
          <button key={m.grado} type="button" onClick={() => set(valor === m.grado ? null : m.grado)} data-manchester={`${lado}-${m.grado}`}
            className={`rounded-xl border px-2 py-2 flex flex-col items-center gap-0.5 text-xs transition-colors ${valor === m.grado ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'}`}>
            <IconoHallux angulo={m.angulo} grado={m.grado} />
            <span className="font-bold">Grado {m.grado}</span><span>{m.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="mb-4 space-y-3" data-testid="form-manchester">
      <p className="text-xs text-on-surface-variant">Compara cada pie con las figuras y elige su grado (escala de Manchester). Moderado o grave se sugiere como deformidad en el IWGDF. Toca de nuevo para quitar.</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {columna('Izquierdo', e.manIzq, e.setManIzq)}
        {columna('Derecho', e.manDer, e.setManDer)}
      </div>
    </div>
  );
}

// ── Examen del pie ───────────────────────────────────────────────────────────
const ZONA_LABEL = Object.fromEntries(ZONAS_DESGASTE) as Record<ZonaDesgaste, string>;
// Suela vista como en el podograma: en el zapato IZQUIERDO el lado interno (del dedo gordo) queda a la derecha.
const ZONAS_SUELA: Record<ZonaDesgaste, { cx: number; cy: number; rx: number; ry: number; txt: string }> = {
  punta: { cx: 40, cy: 24, rx: 19, ry: 12, txt: 'Punta' },
  antepie_int: { cx: 53, cy: 60, rx: 12, ry: 18, txt: 'Int' },
  antepie_ext: { cx: 27, cy: 60, rx: 12, ry: 18, txt: 'Ext' },
  talon_int: { cx: 47, cy: 150, rx: 9, ry: 16, txt: 'Int' },
  talon_ext: { cx: 33, cy: 150, rx: 9, ry: 16, txt: 'Ext' },
};

function SuelaDesgaste({ lado, zonas, onToggle }: { lado: 'izquierdo' | 'derecho'; zonas: ZonaDesgaste[]; onToggle: (z: ZonaDesgaste) => void }) {
  const X = (x: number) => (lado === 'derecho' ? 80 - x : x);
  return (
    <svg viewBox="0 0 80 182" className="w-20 h-44 shrink-0" data-suela={lado}>
      <path d="M40 6 C58 6 70 26 70 52 C70 74 64 90 56 104 C50 116 56 136 56 152 C56 170 48 176 40 176 C31 176 24 170 24 152 C24 132 20 116 16 102 C10 86 10 72 10 52 C10 26 22 6 40 6 Z"
        transform={lado === 'derecho' ? 'translate(80,0) scale(-1,1)' : undefined} fill="#f5f5f4" stroke="#78716c" strokeWidth="1.5" />
      {ZONAS_DESGASTE.map(([z, label]) => {
        const p = ZONAS_SUELA[z];
        const on = zonas.includes(z);
        return (
          <g key={z} onClick={() => onToggle(z)} className="cursor-pointer" data-zona-desgaste={z}>
            <title>{label}</title>
            <ellipse cx={X(p.cx)} cy={p.cy} rx={p.rx} ry={p.ry} fill={on ? 'rgba(220,38,38,0.55)' : 'rgba(0,68,171,0.06)'} stroke={on ? '#dc2626' : '#94a3b8'} strokeDasharray={on ? undefined : '3 2'} strokeWidth="1.2" />
            <text x={X(p.cx)} y={p.cy + 3} textAnchor="middle" fontSize="8" fontWeight="700" fill={on ? '#ffffff' : '#475569'} className="pointer-events-none select-none">{p.txt}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function FormExamenPie({ e }: { e: E }) {
  return (
    <div className="mb-4 space-y-4" data-testid="form-examen">
      <p className="text-xs text-on-surface-variant">Marca en qué pie ves cada hallazgo (Izq / Der); solo se guarda lo marcado. Las deformidades se sugieren como factor en el IWGDF.</p>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {GRUPOS_EXAMEN.map((g) => (
          <div key={g.id} className="rounded-xl border border-outline-variant/30 p-3">
            <p className="text-sm font-semibold text-on-surface flex items-center gap-1.5 mb-2"><span className="material-symbols-outlined text-base text-primary">{g.icono}</span>{g.titulo}</p>
            <div className="space-y-1">
              {g.items.map(([k, label]) => {
                const clave = `${g.id}.${k}`;
                const v = e.hallazgos[clave];
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className={`text-sm flex-1 min-w-0 ${v?.izq || v?.der ? 'text-on-surface font-semibold' : 'text-on-surface'}`}>{label}</span>
                    {(['izq', 'der'] as const).map((lado) => (
                      <button key={lado} type="button" onClick={() => e.toggleHallazgo(clave, lado)} data-hallazgo={clave} data-lado={lado}
                        className={`min-w-[44px] min-h-[36px] lg:min-h-0 px-2 py-1 rounded-lg text-[11px] font-bold border transition-colors ${v?.[lado] ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'}`}>
                        {lado === 'izq' ? 'Izq' : 'Der'}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-outline-variant/30 p-3 space-y-3">
        <p className="text-sm font-semibold text-on-surface flex items-center gap-1.5"><span className="material-symbols-outlined text-base text-primary">steps</span>Calzado</p>
        <div className="flex flex-wrap items-end gap-4">
          <div><p className={LBL}>¿Adecuado?</p><SiNo valor={e.calzado.adecuado} onCambio={(v) => e.setCampoCalzado({ adecuado: v })} campo="calzado-adecuado" /></div>
          <div className="min-w-[200px]"><label className={LBL}>Tipo</label>
            <select value={e.calzado.tipo} onChange={(ev) => e.setCampoCalzado({ tipo: ev.target.value })} className={INPUT} data-campo="calzado-tipo">
              <option value="">—</option>
              {CALZADO_TIPOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div><p className={LBL}>¿Usa plantillas?</p><SiNo valor={e.calzado.plantillas} onCambio={(v) => e.setCampoCalzado({ plantillas: v })} campo="calzado-plantillas" /></div>
        </div>
        <div><p className={LBL}>Problemas del calzado</p>
          <div className="flex flex-wrap gap-1.5">
            {CALZADO_PROBLEMAS.map(([k, l]) => <button key={k} type="button" onClick={() => e.toggleProblema(k)} className={CHIP(e.calzado.problemas.includes(k))} data-problema={k}>{l}</button>)}
          </div>
        </div>
        <div>
          <p className={LBL}>Desgaste de la suela · toca las zonas gastadas (Int = lado del dedo gordo)</p>
          <div className="flex flex-wrap gap-6">
            {(['izquierdo', 'derecho'] as const).map((lado) => {
              const zonas = lado === 'izquierdo' ? e.calzado.desgasteIzq : e.calzado.desgasteDer;
              const lectura = lecturaDesgaste(zonas);
              return (
                <div key={lado} className="flex items-start gap-3">
                  <SuelaDesgaste lado={lado} zonas={zonas} onToggle={(z) => e.toggleDesgaste(lado, z)} />
                  <div className="text-xs max-w-[190px] space-y-1 pt-2">
                    <p className="font-bold text-on-surface">{lado === 'izquierdo' ? 'Zapato izquierdo' : 'Zapato derecho'}</p>
                    <p className="text-on-surface-variant">{zonas.length ? zonas.map((z) => ZONA_LABEL[z]).join(', ') : 'Sin desgaste marcado'}</p>
                    {lectura && <p className="text-primary font-semibold" data-testid={`lectura-desgaste-${lado}`}>→ {lectura}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-on-surface-variant mt-2">Guía: desgaste en el borde interno (talón o antepié) sugiere pronación; en el antepié externo, supinación; solo el talón externo es el patrón habitual; la punta gastada, arrastre. Lo confirma el médico.</p>
        </div>
      </div>
      <div><label className={LBL}>Observación</label><input value={e.obsExamen} onChange={(ev) => e.setObsExamen(ev.target.value)} placeholder="Opcional" className={INPUT} /></div>
    </div>
  );
}
