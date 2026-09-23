// Tratamientos habituales del diagnóstico elegido en la receta (lista del ERP «diagnostico_cie10_plan», 23-sep-2026):
// tabla con checks — Tratamiento · Presentación · Aplicación — y «Agregar seleccionados». Vista pura; la lógica de cómo
// se convierte cada fila en un ítem de la receta vive en useEmitirRecetaForm (agregarTratamientos).
import { useEffect, useMemo, useState } from 'react';
import type { TratamientoDiagnostico } from '../../api/catalogos';
import { lineaPosologia } from '../../utils/posologiaTexto';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function TratamientosDiagnosticoPanel({ codigo, descripcion, tratamientos, cargando, permitido, onAgregar }: {
  codigo: string; descripcion: string;
  tratamientos: TratamientoDiagnostico[]; cargando: boolean;
  permitido: (t: TratamientoDiagnostico) => boolean;
  onAgregar: (lista: TratamientoDiagnostico[]) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState(true);
  useEffect(() => { setSel(new Set()); setQ(''); }, [codigo]); // otro diagnóstico → otra lista

  const visibles = useMemo(() => {
    const t = norm(q.trim());
    return t ? tratamientos.filter((x) => norm(`${x.tratamiento} ${x.presentacion ?? ''} ${x.aplicacion ?? ''}`).includes(t)) : tratamientos;
  }, [tratamientos, q]);
  const elegibles = visibles.filter(permitido);
  const todosMarcados = elegibles.length > 0 && elegibles.every((x) => sel.has(x.id));
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const alternarTodos = () => setSel((s) => { const n = new Set(s); if (todosMarcados) elegibles.forEach((x) => n.delete(x.id)); else elegibles.forEach((x) => n.add(x.id)); return n; });
  const agregar = () => { onAgregar(tratamientos.filter((x) => sel.has(x.id))); setSel(new Set()); };

  if (cargando) return <div className="rounded-2xl border border-outline-variant/30 p-4 text-xs text-on-surface-variant">Cargando tratamientos habituales…</div>;
  if (!tratamientos.length) return null;

  return (
    <div className="rounded-2xl border border-primary/25 bg-primary/[0.02] overflow-hidden" data-testid="tratamientos-dx">
      <button type="button" onClick={() => setAbierto(!abierto)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-primary/5 transition-colors">
        <span className="material-symbols-outlined text-primary text-lg">checklist</span>
        <span className="font-semibold text-on-surface text-sm flex-1 min-w-0 truncate">
          Tratamientos habituales · <b className="text-primary">{codigo}</b> {descripcion}
        </span>
        <span className="text-[11px] font-bold text-on-surface-variant bg-surface-container border border-outline-variant/30 rounded-full px-2 py-0.5">{tratamientos.length}</span>
        <span className="material-symbols-outlined text-on-surface-variant">{abierto ? 'expand_less' : 'expand_more'}</span>
      </button>
      {abierto && (
        <div className="px-4 pb-4 space-y-2">
          {tratamientos.length > 8 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar (ej. crema, laser, itraconazol)…"
              className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-1.5 text-sm text-on-surface outline-none focus:border-primary" />
          )}
          <div className="max-h-72 overflow-y-auto custom-scrollbar rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-container text-on-surface-variant z-10">
                <tr>
                  <th className="w-9 px-2 py-2 text-center"><input type="checkbox" checked={todosMarcados} onChange={alternarTodos} disabled={!elegibles.length} aria-label="Marcar todos" /></th>
                  <th className="px-2 py-2 text-left font-semibold">Tratamiento</th>
                  <th className="px-2 py-2 text-left font-semibold w-[22%]">Presentación</th>
                  <th className="px-2 py-2 text-left font-semibold w-[38%]">Cómo usarlo</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((t) => {
                  const ok = permitido(t);
                  return (
                    <tr key={t.id} onClick={() => ok && alternar(t.id)} data-testid={`tratamiento-dx-${t.id}`}
                      className={`border-t border-outline-variant/15 align-top ${ok ? 'cursor-pointer hover:bg-primary/5' : 'opacity-50 cursor-not-allowed'} ${sel.has(t.id) ? 'bg-primary/10' : ''}`}
                      title={ok ? undefined : 'De venta bajo receta: va en una Receta Médica firmada por médico'}>
                      <td className="px-2 py-2 text-center"><input type="checkbox" checked={sel.has(t.id)} disabled={!ok} onChange={() => alternar(t.id)} onClick={(e) => e.stopPropagation()} /></td>
                      <td className="px-2 py-2">
                        <span className="font-semibold text-on-surface">{t.tratamiento}</span>
                        {t.medicamento && <span className="block text-[10px] text-on-surface-variant mt-0.5">Vademécum: {[t.medicamento.dci, t.medicamento.concentracion, t.medicamento.formaFarmaceutica].filter(Boolean).join(' ')}</span>}
                        {t.servicio && <span className="block text-[10px] text-on-surface-variant mt-0.5">Servicio: {t.servicio.nombre}</span>}
                      </td>
                      <td className="px-2 py-2 text-on-surface-variant">{t.presentacion || '—'}</td>
                      <td className="px-2 py-2 text-on-surface" title={t.aplicacion ?? undefined}>
                        {(() => {
                          const linea = lineaPosologia({ tipo: t.tipo, formaFarmaceutica: t.medicamento?.formaFarmaceutica, dosis: t.dosis, via: t.via ?? t.medicamento?.viaAdministracion, frecuencia: t.frecuencia, duracion: t.duracion });
                          const extra = linea ? t.indicaciones : (t.indicaciones ?? t.aplicacion);
                          return (<>
                            {linea && <span className="block font-medium" data-campo="posologia-dx">{linea}</span>}
                            {extra && <span className={`block ${linea ? 'text-on-surface-variant mt-0.5' : ''}`}>{extra}</span>}
                            {!linea && !extra && '—'}
                          </>);
                        })()}
                      </td>
                    </tr>
                  );
                })}
                {!visibles.length && <tr><td colSpan={4} className="px-3 py-4 text-center text-on-surface-variant">Nada coincide con «{q}».</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[11px] text-on-surface-variant flex-1 min-w-[200px]">La dosis, cada cuánto y por cuánto tiempo salen <b>ya llenos</b> (Presentación va como Cantidad); el médico los revisa y ajusta abajo antes de emitir.</p>
            {sel.size > 0 && <button type="button" onClick={() => setSel(new Set())} className="px-3 py-1.5 text-xs font-semibold text-on-surface-variant hover:underline">Limpiar</button>}
            <button type="button" onClick={agregar} disabled={!sel.size} data-testid="agregar-tratamientos-dx"
              className="px-4 py-2 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-40 flex items-center gap-1">
              <span className="material-symbols-outlined text-base">playlist_add</span>Agregar seleccionados{sel.size ? ` (${sel.size})` : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
