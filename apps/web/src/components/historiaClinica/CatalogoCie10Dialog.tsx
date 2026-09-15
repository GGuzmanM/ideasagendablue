// Catálogo CIE-10 de la clínica (D3). Vista pura; la lógica vive en useCatalogoCie10
// (services/catalogoCie10Service.ts). Solo administración, coordinación y médicos.
import { useCatalogoCie10 } from '../../services/catalogoCie10Service';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';

export function CatalogoCie10Dialog({ onClose }: { onClose: () => void }) {
  const c = useCatalogoCie10();
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-6" onClick={(ev) => ev.stopPropagation()} data-testid="catalogo-cie10">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">menu_book</span>Catálogo CIE-10</h3>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>
        <p className="text-xs text-on-surface-variant mb-4">Son los códigos que aparecen al buscar un diagnóstico. Agrega los que falten; los que ya no se usan se <b>desactivan</b> (no se borran: pueden estar en historias anteriores).</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
          <section>
            <div className="flex items-center gap-3 mb-2">
              <input value={c.q} onChange={(ev) => c.setQ(ev.target.value)} placeholder="Buscar por código o nombre…" className={INPUT} data-campo="cie10-buscar" />
              <label className="flex items-center gap-1.5 text-xs text-on-surface-variant whitespace-nowrap"><input type="checkbox" checked={c.verInactivos} onChange={(ev) => c.setVerInactivos(ev.target.checked)} className="accent-primary" />Ver inactivos</label>
            </div>
            {c.cargando && <p className="text-xs text-on-surface-variant">Cargando…</p>}
            {!c.cargando && c.items.length === 0 && <p className="text-xs text-on-surface-variant">Sin resultados.</p>}
            <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {c.items.map((x) => (
                <div key={x.codigo} className={`rounded-xl border px-3 py-2 ${c.editando === x.codigo ? 'border-primary bg-primary/5' : 'border-outline-variant/20'} ${x.activo ? '' : 'opacity-60'}`} data-cie10={x.codigo}>
                  {c.editando === x.codigo ? (
                    <div className="space-y-2">
                      <p className="font-mono-label text-mono-label font-bold text-primary">{x.codigo}</p>
                      <input value={c.editDesc} onChange={(ev) => c.setEditDesc(ev.target.value)} className={INPUT} />
                      <input value={c.editCat} onChange={(ev) => c.setEditCat(ev.target.value)} list="cie10-categorias" placeholder="Categoría (opcional)" className={INPUT} />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => c.setEditando(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high">Cancelar</button>
                        <button onClick={c.guardarEdicion} disabled={c.editDesc.trim().length < 3 || c.editarMut.isPending} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-on-primary disabled:opacity-50">Guardar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono-label text-mono-label font-bold text-primary w-16 shrink-0">{x.codigo}</span>
                      <span className="text-sm text-on-surface flex-1 min-w-0">
                        {x.descripcion}
                        <span className="block text-[11px] text-on-surface-variant">{x.categoria ?? 'Sin categoría'}{x.usos ? ` · usado en ${x.usos} diagnóstico${x.usos === 1 ? '' : 's'}` : ''}</span>
                      </span>
                      <button onClick={() => c.empezarEdicion(x)} className="text-primary text-xs font-semibold hover:underline">Editar</button>
                      <button onClick={() => c.alternarActivo(x)} disabled={c.editarMut.isPending} data-accion="alternar-activo"
                        className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${x.activo ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}
                        title={x.activo ? 'Desactivar: deja de salir al buscar diagnósticos' : 'Activar'}>{x.activo ? 'Activo' : 'Inactivo'}</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <datalist id="cie10-categorias">{c.categorias.map((k) => <option key={k} value={k} />)}</datalist>
          </section>

          <section className="rounded-2xl border border-outline-variant/30 p-4 h-fit space-y-3">
            <h4 className="text-sm font-semibold text-on-surface flex items-center gap-1.5"><span className="material-symbols-outlined text-base text-primary">add_circle</span>Agregar código</h4>
            <div><label className={LBL}>Código</label>
              <input value={c.codigo} onChange={(ev) => c.setCodigo(ev.target.value)} placeholder="Ej. L84 o B35.1" className={`${INPUT} font-mono uppercase`} data-campo="cie10-codigo" />
              {c.codigo.trim() && !c.codigoValido && <p className="text-[11px] text-amber-700 mt-1">Formato: una letra y dos números, y si hace falta un punto y la subcategoría (L84, B35.1).</p>}
            </div>
            <div><label className={LBL}>Descripción</label><input value={c.descripcion} onChange={(ev) => c.setDescripcion(ev.target.value)} placeholder="Ej. Callos y callosidades" className={INPUT} data-campo="cie10-descripcion" /></div>
            <div><label className={LBL}>Categoría</label><input value={c.categoria} onChange={(ev) => c.setCategoria(ev.target.value)} list="cie10-categorias" placeholder="Opcional (agrupa en la lista)" className={INPUT} /></div>
            <button onClick={() => c.crearMut.mutate()} disabled={!c.puedeCrear || c.crearMut.isPending} className="w-full min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">
              {c.crearMut.isPending ? 'Agregando…' : 'Agregar al catálogo'}
            </button>
            <p className="text-[11px] text-on-surface-variant">Queda disponible al instante en «Agregar diagnóstico». Cada cambio se registra en la auditoría.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
