import { useState } from 'react';
import { useBuscarCie10, useBuscarMedicamentos, type Cie10Item, type MedicamentoItem } from '../../api/catalogos';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';

// ─── Buscador CIE-10 (por código o descripción) ──────────────────────────────
export function BuscadorCie10({ onSeleccionar, placeholder = 'Buscar diagnóstico (código o nombre)…', autoFocus }: { onSeleccionar: (c: Cie10Item) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const { data = [], isFetching } = useBuscarCie10(q, abierto);
  const elegir = (c: Cie10Item) => { onSeleccionar(c); setQ(''); setAbierto(false); };
  return (
    <div className="relative">
      <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && data[0]) { e.preventDefault(); elegir(data[0]); } if (e.key === 'Escape') setAbierto(false); }}
        placeholder={placeholder} autoFocus={autoFocus} className={INPUT} />
      {abierto && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-lg">
          {isFetching && data.length === 0 && <div className="px-3 py-2 text-xs text-on-surface-variant">Buscando…</div>}
          {!isFetching && data.length === 0 && <div className="px-3 py-2 text-xs text-on-surface-variant">Sin resultados en el catálogo</div>}
          {data.map((c) => (
            <button key={c.codigo} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(c)}
              className="w-full text-left px-3 py-2 hover:bg-primary/5 flex items-start gap-3 border-b border-outline-variant/15 last:border-0">
              <span className="font-mono-label text-mono-label font-bold text-primary shrink-0 w-14">{c.codigo}</span>
              <span className="min-w-0"><span className="text-sm text-on-surface">{c.descripcion}</span>{c.categoria && <span className="block text-[11px] text-on-surface-variant">{c.categoria}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Buscador de medicamentos (DCI, ATC o marca → genérico) ──────────────────
export function BuscadorMedicamento({ onSeleccionar, onManual, soloVentaLibre = false, placeholder = 'Buscar medicamento (genérico o marca)…' }: {
  onSeleccionar: (m: MedicamentoItem) => void; onManual?: (nombre: string) => void; soloVentaLibre?: boolean; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  const { data = [], isFetching } = useBuscarMedicamentos(q, abierto);
  const elegir = (m: MedicamentoItem) => { onSeleccionar(m); setQ(''); setAbierto(false); };
  const manual = () => { if (onManual && q.trim()) { onManual(q.trim()); setQ(''); setAbierto(false); } };
  return (
    <div className="relative">
      <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (data[0]) elegir(data[0]); else manual(); } if (e.key === 'Escape') setAbierto(false); }}
        placeholder={placeholder} className={INPUT} />
      {abierto && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-lg">
          {isFetching && data.length === 0 && <div className="px-3 py-2 text-xs text-on-surface-variant">Buscando…</div>}
          {data.map((m) => {
            const bloqueado = soloVentaLibre && !!m.requiereReceta;
            return (
              <button key={m.id} type="button" disabled={bloqueado} onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(m)}
                className={`w-full text-left px-3 py-2 flex items-start gap-3 border-b border-outline-variant/15 last:border-0 ${bloqueado ? 'opacity-50 cursor-not-allowed' : 'hover:bg-primary/5'}`}>
                <span className="material-symbols-outlined text-primary text-lg shrink-0">{m.esProducto ? 'inventory_2' : 'pill'}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-on-surface">{m.dci}</span>
                  <span className="text-sm text-on-surface-variant"> {[m.concentracion, m.formaFarmaceutica].filter(Boolean).join(' · ')}</span>
                  {m.nombresComerciales && <span className="block text-[11px] text-on-surface-variant/80">{m.nombresComerciales}</span>}
                  {m.grupo && <span className="block text-[10px] uppercase tracking-wide text-on-surface-variant/70">{m.grupo}</span>}
                </span>
                {m.requiereReceta && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">Receta</span>}
              </button>
            );
          })}
          {onManual && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={manual} className="w-full text-left px-3 py-2 hover:bg-surface-container-low text-xs text-primary font-semibold flex items-center gap-2">
              <span className="material-symbols-outlined text-base">edit_note</span> Ingresar manualmente: “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
