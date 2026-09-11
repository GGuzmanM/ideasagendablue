// Gestión de plantillas de nota por diagnóstico (1.1) y autotextos (1.2). Vista pura; la lógica
// vive en usePlantillasAdmin (services/historiaClinicaService.ts). Solo administración, coordinación
// y médicos (el backend también lo exige).
import { usePlantillasAdmin } from '../../services/historiaClinicaService';
import { BuscadorCie10 } from './Buscadores';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';

export function PlantillasDialog({ onClose }: { onClose: () => void }) {
  const p = usePlantillasAdmin();
  const notas = p.plantillas.filter((x) => x.tipo === 'nota');
  const autos = p.plantillas.filter((x) => x.tipo === 'autotexto');
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-6" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">library_books</span>Plantillas y autotextos</h3>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>
        <p className="text-xs text-on-surface-variant mb-4">
          <b>Plantillas</b>: texto base por diagnóstico que rellena Subjetivo / Objetivo / Apreciación / Plan (solo los campos vacíos).
          <b> Autotextos</b>: al escribir el atajo y un espacio (ej. <code>.oc</code>) se reemplaza por su texto en cualquier campo de la nota.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">
          <div className="space-y-4">
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-on-surface">Plantillas de nota ({notas.length})</h4>
                <button onClick={() => p.nueva('nota')} className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-base">add</span>Nueva plantilla</button>
              </div>
              {p.cargando && <p className="text-xs text-on-surface-variant">Cargando…</p>}
              {!p.cargando && notas.length === 0 && <p className="text-xs text-on-surface-variant">Sin plantillas.</p>}
              <div className="space-y-1.5">
                {notas.map((x) => (
                  <div key={x.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${p.editando === x.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20'}`}>
                    {x.clave && <span className="font-mono-label text-mono-label font-bold text-primary w-14 shrink-0">{x.clave}</span>}
                    <span className="text-sm text-on-surface flex-1 min-w-0 truncate">{x.nombre}</span>
                    <button onClick={() => p.cargar(x)} className="text-primary text-xs font-semibold hover:underline">Editar</button>
                    <button onClick={() => p.eliminarMut.mutate(x.id)} disabled={p.eliminarMut.isPending} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>
                  </div>
                ))}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-on-surface">Autotextos ({autos.length})</h4>
                <button onClick={() => p.nueva('autotexto')} className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-base">add</span>Nuevo autotexto</button>
              </div>
              {!p.cargando && autos.length === 0 && <p className="text-xs text-on-surface-variant">Sin autotextos.</p>}
              <div className="space-y-1.5">
                {autos.map((x) => (
                  <div key={x.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${p.editando === x.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20'}`}>
                    <code className="text-xs font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{x.clave}</code>
                    <span className="text-sm text-on-surface flex-1 min-w-0 truncate" title={x.contenido.texto}>{x.contenido.texto}</span>
                    <button onClick={() => p.cargar(x)} className="text-primary text-xs font-semibold hover:underline">Editar</button>
                    <button onClick={() => p.eliminarMut.mutate(x.id)} disabled={p.eliminarMut.isPending} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div>
            {p.editando ? (
              <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3">
                <h4 className="text-sm font-semibold text-on-surface">{p.editando === 'nueva' ? (p.tipo === 'nota' ? 'Nueva plantilla de nota' : 'Nuevo autotexto') : 'Editar'}</h4>
                {p.tipo === 'nota' ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div><label className={LBL}>Nombre</label><input value={p.nombre} onChange={(ev) => p.setNombre(ev.target.value)} placeholder="Ej. Onicocriptosis" className={INPUT} /></div>
                      <div><label className={LBL}>Diagnóstico CIE-10 sugerido (opcional)</label>
                        {p.clave
                          ? <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/30 px-3 py-2 text-sm"><b className="text-primary">{p.clave}</b><span className="flex-1" /><button onClick={() => p.setClave('')} className="material-symbols-outlined text-base">close</button></div>
                          : <BuscadorCie10 onSeleccionar={(c) => p.setClave(c.codigo)} placeholder="Buscar CIE-10…" />}
                      </div>
                    </div>
                    {([['Subjetivo', p.subjetivo, p.setSubjetivo], ['Objetivo', p.objetivo, p.setObjetivo], ['Apreciación', p.apreciacion, p.setApreciacion], ['Plan', p.plan, p.setPlan]] as const).map(([label, valor, set]) => (
                      <div key={label}><label className={LBL}>{label}</label><textarea value={valor} onChange={(ev) => set(ev.target.value)} rows={2} maxLength={5000} className={INPUT} /></div>
                    ))}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-3">
                      <div><label className={LBL}>Atajo</label><input value={p.clave} onChange={(ev) => p.setClave(ev.target.value)} placeholder=".oc" className={`${INPUT} font-mono`} /></div>
                      <div><label className={LBL}>Nombre</label><input value={p.nombre} onChange={(ev) => p.setNombre(ev.target.value)} placeholder="Ej. onicocriptosis" className={INPUT} /></div>
                    </div>
                    <div><label className={LBL}>Texto que reemplaza al atajo</label><textarea value={p.texto} onChange={(ev) => p.setTexto(ev.target.value)} rows={3} maxLength={2000} className={INPUT} /></div>
                    <p className="text-[11px] text-on-surface-variant">El atajo empieza con ".", "/" o "#" y se activa al escribirlo seguido de un espacio o signo de puntuación.</p>
                  </>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={p.cancelar} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold hover:bg-surface-container-high">Cancelar</button>
                  <button disabled={!p.puedeGuardar || p.guardarMut.isPending} onClick={() => p.guardarMut.mutate()} className="min-h-[44px] lg:min-h-0 px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">{p.guardarMut.isPending ? 'Guardando…' : 'Guardar'}</button>
                </div>
              </section>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-on-surface-variant border border-dashed border-outline-variant/40 rounded-2xl p-8 text-center">Elige una plantilla para editarla o crea una nueva.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
