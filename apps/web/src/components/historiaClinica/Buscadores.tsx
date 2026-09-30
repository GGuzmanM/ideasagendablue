import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { catalogosApi, useBuscarCie10, useBuscarMedicamentos, useCie10Frecuentes, type Cie10Item, type MedicamentoItem } from '../../api/catalogos';
import { useAuthStore } from '../../stores/authStore';

// Quién puede agregar un diagnóstico que no está en el catálogo (misma regla que el servidor: Catálogo CIE-10).
const ROLES_AGREGAN_DX = ['admin', 'coordinadora_sedes', 'medico'];

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';

// ─── Buscador CIE-10 (por código o descripción) ──────────────────────────────
export function BuscadorCie10({ onSeleccionar, placeholder = 'Buscar diagnóstico (código o nombre)…', autoFocus, consulta }: {
  onSeleccionar: (c: Cie10Item) => void; placeholder?: string; autoFocus?: boolean;
  /** Búsqueda puesta desde fuera (dictado por voz): `n` cambia en cada dictado para poder repetir el mismo término. */
  consulta?: { termino: string; n: number } | null;
}) {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(false);
  useEffect(() => { if (consulta?.termino) { setQ(consulta.termino); setAbierto(true); } }, [consulta]);
  const { data = [], isFetching } = useBuscarCie10(q, abierto);
  const elegir = (c: Cie10Item) => { onSeleccionar(c); setQ(''); setAbierto(false); setNuevo(null); };
  // Diagnóstico que NO está en el catálogo (26-sep-2026): se agrega aquí mismo y queda elegido. Código opcional.
  const puedeAgregar = ROLES_AGREGAN_DX.includes(useAuthStore((s) => s.usuario?.rol) ?? '');
  const [nuevo, setNuevo] = useState<{ descripcion: string; codigo: string } | null>(null);
  const qc = useQueryClient();
  const crearMut = useMutation({
    mutationFn: () => catalogosApi.crearCie10({ descripcion: nuevo!.descripcion.trim(), codigo: nuevo!.codigo.trim().toUpperCase() }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['catalogo-cie10'] });
      toast.success(`Diagnóstico agregado: ${c.codigo} · ${c.descripcion}`);
      elegir({ codigo: c.codigo, descripcion: c.descripcion, categoria: c.categoria } as Cie10Item);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="relative">
      <input value={q} onChange={(e) => { setQ(e.target.value); setAbierto(true); }} onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && data[0]) { e.preventDefault(); elegir(data[0]); } if (e.key === 'Escape') setAbierto(false); }}
        placeholder={placeholder} autoFocus={autoFocus} className={INPUT} />
      {abierto && q.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-lg">
          {isFetching && data.length === 0 && <div className="px-3 py-2 text-xs text-on-surface-variant">Buscando…</div>}
          {!isFetching && data.length === 0 && (
            <div className="px-3 py-2 text-xs text-on-surface-variant">
              Sin resultados en el catálogo.
              {puedeAgregar ? (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setNuevo({ descripcion: q.trim(), codigo: '' }); setAbierto(false); }}
                  data-testid="dx-agregar-nuevo" className="mt-1.5 w-full text-left px-2 py-1.5 rounded-lg bg-primary/5 hover:bg-primary/10 text-primary font-semibold text-sm">
                  + Agregar «{q.trim()}» como diagnóstico nuevo
                </button>
              ) : <span> Pide a un médico o a coordinación que lo agregue.</span>}
            </div>
          )}
          {data.map((c) => (
            <button key={c.codigo} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(c)}
              className="w-full text-left px-3 py-2 hover:bg-primary/5 flex items-start gap-3 border-b border-outline-variant/15 last:border-0">
              <span className="font-mono-label text-mono-label font-bold text-primary shrink-0 w-14">{c.codigo}{c.frecuente && <span title="Diagnóstico frecuente de la clínica" className="text-amber-500"> ★</span>}</span>
              <span className="min-w-0"><span className="text-sm text-on-surface">{c.descripcion}</span>{c.categoria && <span className="block text-[11px] text-on-surface-variant">{c.categoria}</span>}</span>
            </button>
          ))}
        </div>
      )}
      {nuevo && (
        <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="dx-nuevo-form">
          <p className="text-xs font-semibold text-primary">Diagnóstico nuevo (queda en el catálogo para todos)</p>
          <input value={nuevo.descripcion} onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })} maxLength={300}
            placeholder="Nombre del diagnóstico" aria-label="Nombre del diagnóstico" className={INPUT} />
          <input value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} maxLength={8}
            placeholder="Código CIE-10 (opcional, ej. M76.8)" aria-label="Código CIE-10" className={INPUT} />
          <p className="text-[11px] text-on-surface-variant">Si no sabes el código, déjalo vacío: se le asigna uno interno de la clínica (LB…), que luego se puede corregir en Catálogo CIE-10.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setNuevo(null)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold">Cancelar</button>
            <button type="button" onClick={() => crearMut.mutate()} disabled={nuevo.descripcion.trim().length < 3 || crearMut.isPending} data-testid="dx-nuevo-guardar"
              className="px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-50">
              {crearMut.isPending ? 'Agregando…' : 'Agregar y usar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Lista de diagnósticos frecuentes (los del ERP de la clínica) ──────────────
// Para no tener que escribir: se elige de la lista y queda seleccionado igual que desde el buscador.
export function FrecuentesCie10({ onSeleccionar }: { onSeleccionar: (c: Cie10Item) => void }) {
  const { data = [] } = useCie10Frecuentes();
  if (!data.length) return null;
  return (
    <select value="" onChange={(e) => { const c = data.find((x) => x.codigo === e.target.value); if (c) onSeleccionar(c); }}
      className={`${INPUT} mb-1.5`} data-testid="dx-frecuentes" aria-label="Diagnósticos frecuentes">
      <option value="">★ Diagnósticos frecuentes ({data.length})…</option>
      {data.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descripcion}{c.tratamientos ? `  (${c.tratamientos} tratamientos)` : ''}</option>)}
    </select>
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
