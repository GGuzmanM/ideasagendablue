// Gestión de los tratamientos habituales de un diagnóstico (se abre desde el catálogo CIE-10). Vista pura; la lógica
// vive en services/tratamientosDiagnosticoService.ts.
import { useGestionTratamientosDx, usePuedeGestionarTratamientosDx } from '../../services/tratamientosDiagnosticoService';
import { BuscadorMedicamento } from './Buscadores';
import { lineaPosologia } from '../../utils/posologiaTexto';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';

export function TratamientosDiagnosticoDialog({ codigo, descripcion, onClose }: { codigo: string; descripcion: string; onClose: () => void }) {
  const g = useGestionTratamientosDx(codigo);
  const f = g.form;
  // 06-oct-2026: solo administración y el médico auditor cambian la lista; el resto la ve (solo lectura).
  const gestiona = usePuedeGestionarTratamientosDx();
  const quitarOVolver = (t: (typeof g.items)[number]) => {
    if (t.activo && !window.confirm(`¿Quitar «${t.tratamiento}» de los tratamientos habituales de ${codigo}?\n\nDeja de salir en la receta. No se borra: se puede volver a usar con «Ver quitados».`)) return;
    g.activoMut.mutate(t);
  };
  return (
    <div className="fixed inset-0 z-[130] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto p-6" onClick={(ev) => ev.stopPropagation()} data-testid="gestion-tratamientos-dx">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">checklist</span>Tratamientos habituales · <span className="text-primary">{codigo}</span> {descripcion}
          </h3>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant hover:text-on-surface">close</button>
        </div>
        <p className="text-xs text-on-surface-variant mb-4">Son los que la receta ofrece con checks al elegir este diagnóstico. <b>Presentación</b> se imprime como Cantidad; la <b>posología</b> (dosis, vía, cada cuánto y por cuánto tiempo) sale ya llena y el médico solo la valida. Los que ya no se usan se <b>quitan</b> (no se borran: se pueden volver a usar).</p>
        {!gestiona && (
          <p className="mb-4 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-base">lock</span>Solo administración y el médico auditor pueden cambiar esta lista. Tú puedes elegirlos en la receta.
          </p>
        )}

        <div className={`grid grid-cols-1 gap-5 ${gestiona ? 'lg:grid-cols-[1.5fr_1fr]' : ''}`}>
          <section>
            <div className="flex items-center gap-3 mb-2">
              {gestiona && <button onClick={g.nuevo} className="px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold flex items-center gap-1" data-accion="nuevo-tratamiento"><span className="material-symbols-outlined text-base">add</span>Nuevo tratamiento</button>}
              <span className="flex-1" />
              {gestiona && <label className="flex items-center gap-1.5 text-xs text-on-surface-variant"><input type="checkbox" checked={g.verInactivos} onChange={(e) => g.setVerInactivos(e.target.checked)} className="accent-primary" />Ver quitados</label>}
            </div>
            {g.cargando && <p className="text-xs text-on-surface-variant">Cargando…</p>}
            {!g.cargando && !g.items.length && <p className="text-xs text-on-surface-variant py-4">Este diagnóstico aún no tiene tratamientos habituales.</p>}
            <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
              {g.items.map((t) => {
                return (
                  <div key={t.id} className={`rounded-xl border px-3 py-2 ${f?.id === t.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20'} ${t.activo ? '' : 'opacity-55'}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-on-surface">{t.tratamiento}</p>
                        <p className="text-[11px] text-on-surface-variant">{t.presentacion || 'Sin presentación'}</p>
                        {(() => {
                          const linea = lineaPosologia({ tipo: t.tipo, formaFarmaceutica: t.medicamento?.formaFarmaceutica, dosis: t.dosis, via: t.via ?? t.medicamento?.viaAdministracion, frecuencia: t.frecuencia, duracion: t.duracion });
                          return <p className="text-[11px] text-on-surface">{linea ? <b className="font-semibold">{linea}</b> : null}{linea && t.indicaciones ? ' · ' : ''}{linea ? t.indicaciones : (t.indicaciones ?? t.aplicacion ?? 'Sin aplicación')}</p>;
                        })()}
                        <p className="text-[10px] text-on-surface-variant/80">{t.medicamento ? `Vademécum: ${t.medicamento.dci} ${t.medicamento.concentracion ?? ''}` : t.servicio ? `Servicio: ${t.servicio.nombre}` : 'Texto libre (no vinculado)'}</p>
                      </div>
                      {gestiona && (<>
                        <button onClick={() => g.editar(t)} className="text-primary text-xs font-semibold hover:underline shrink-0">Editar</button>
                        <button onClick={() => quitarOVolver(t)} disabled={g.activoMut.isPending} data-accion={t.activo ? 'quitar-tratamiento' : 'volver-tratamiento'}
                          title={t.activo ? 'Deja de salir en la receta (no se borra)' : 'Vuelve a salir en la receta'}
                          className={`text-[11px] font-semibold px-2 py-1 rounded-lg shrink-0 flex items-center gap-1 ${t.activo ? 'text-rose-700 hover:bg-rose-50' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                          <span className="material-symbols-outlined text-sm">{t.activo ? 'delete' : 'undo'}</span>{t.activo ? 'Quitar' : 'Volver a usar'}
                        </button>
                      </>)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {gestiona && <section className="rounded-2xl border border-outline-variant/30 p-4 h-fit space-y-3">
            {!f ? (
              <p className="text-xs text-on-surface-variant">Elige «Editar» en un tratamiento o «Nuevo tratamiento».</p>
            ) : (
              <>
                <h4 className="text-sm font-semibold text-on-surface">{f.id ? 'Editar tratamiento' : 'Nuevo tratamiento'}</h4>
                <div><label className={LBL}>Tratamiento *</label><input value={f.tratamiento} onChange={(e) => g.cambiar({ tratamiento: e.target.value })} placeholder="Ej. Itraconazol 100mg (Itramicol®)" className={INPUT} data-campo="trat-nombre" /></div>
                <div><label className={LBL}>Presentación (se imprime como Cantidad)</label><input value={f.presentacion} onChange={(e) => g.cambiar({ presentacion: e.target.value })} placeholder="Ej. Cápsulas #28 · Frasco 100ml #01" className={INPUT} /></div>
                <div>
                  <label className={LBL}>Aplicación (texto original)</label>
                  <textarea value={f.aplicacion} onChange={(e) => g.cambiar({ aplicacion: e.target.value })} rows={2} placeholder="Ej. 01 tab vía oral c/8h por 5 días" className={INPUT} />
                  <button type="button" onClick={() => g.leerMut.mutate()} disabled={!f.aplicacion.trim() || g.leerMut.isPending} data-accion="leer-posologia"
                    className="mt-1 text-xs font-semibold text-primary hover:underline disabled:opacity-40 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">auto_fix_high</span>{g.leerMut.isPending ? 'Leyendo…' : 'Leer la posología de este texto'}
                  </button>
                </div>
                <div className="rounded-xl border border-outline-variant/30 p-3 space-y-2 bg-surface-container-low/40">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-on-surface-variant">Posología por defecto (sale llena en la receta)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className={LBL}>Dosis</label><input value={f.dosis} onChange={(e) => g.cambiar({ dosis: e.target.value })} placeholder="1 · 1 gota · 2 puff" className={INPUT} data-campo="trat-dosis" /></div>
                    <div><label className={LBL}>Vía</label><input value={f.via} onChange={(e) => g.cambiar({ via: e.target.value })} placeholder="oral (vacío = la del vademécum)" className={INPUT} data-campo="trat-via" /></div>
                    <div><label className={LBL}>Frecuencia</label><input value={f.frecuencia} onChange={(e) => g.cambiar({ frecuencia: e.target.value })} placeholder="cada 8 horas · 1 vez al día" className={INPUT} data-campo="trat-frecuencia" /></div>
                    <div><label className={LBL}>Duración</label><input value={f.duracion} onChange={(e) => g.cambiar({ duracion: e.target.value })} placeholder="5 días · 2 semanas · 1 mes" className={INPUT} data-campo="trat-duracion" /></div>
                  </div>
                  <div><label className={LBL}>Indicaciones (se imprimen aparte)</label><textarea value={f.indicaciones} onChange={(e) => g.cambiar({ indicaciones: e.target.value })} rows={2} placeholder="Ej. Después del almuerzo" className={INPUT} data-campo="trat-indicaciones" /></div>
                  {(() => {
                    const linea = lineaPosologia({ tipo: f.servicioId ? 'SERVICIO' : f.tipo, dosis: f.dosis, via: f.via, frecuencia: f.frecuencia, duracion: f.duracion });
                    return linea ? <p className="text-[11px] text-on-surface-variant">En la receta: <b className="text-on-surface">{linea}</b></p> : null;
                  })()}
                </div>
                <div>
                  <label className={LBL}>Vínculo con el vademécum (opcional)</label>
                  {f.medicamento ? (
                    <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/30 px-3 py-2 text-sm"><span className="flex-1 truncate">{f.medicamento.etiqueta}</span><button onClick={() => g.cambiar({ medicamento: null })} className="material-symbols-outlined text-base" title="Quitar vínculo">close</button></div>
                  ) : <BuscadorMedicamento onSeleccionar={g.vincular} onManual={() => undefined} placeholder="Buscar en el vademécum…" />}
                  <p className="text-[10px] text-on-surface-variant mt-1">Si se vincula, el tipo (receta / venta libre) lo pone el vademécum y la receta revisa alergias.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className={LBL}>Tipo</label>
                    <select value={f.servicioId ? 'SERVICIO' : f.tipo} disabled={!!f.medicamento || !!f.servicioId} onChange={(e) => g.cambiar({ tipo: e.target.value as typeof f.tipo })} className={INPUT}>
                      <option value="MEDICAMENTO_RX">Receta</option><option value="MEDICAMENTO_OTC">Venta libre</option><option value="PRODUCTO">Producto</option><option value="SERVICIO">Servicio</option>
                    </select>
                  </div>
                  <div><label className={LBL}>Marca a imprimir</label><input value={f.marca} onChange={(e) => g.cambiar({ marca: e.target.value })} placeholder="Ej. Itramicol" className={INPUT} /></div>
                </div>
                <div><label className={LBL}>Servicio de la clínica (si es un servicio)</label>
                  <select value={f.servicioId} onChange={(e) => g.cambiar({ servicioId: e.target.value, ...(e.target.value ? { medicamento: null, tipo: 'SERVICIO' as const } : {}) })} className={INPUT}>
                    <option value="">— Ninguno —</option>
                    {g.servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={g.cancelar} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high">Cancelar</button>
                  <button onClick={() => g.guardarMut.mutate()} disabled={!g.puedeGuardar || g.guardarMut.isPending} className="px-4 py-1.5 rounded-lg text-xs font-bold bg-primary text-on-primary disabled:opacity-50" data-accion="guardar-tratamiento">{g.guardarMut.isPending ? 'Guardando…' : 'Guardar'}</button>
                </div>
              </>
            )}
          </section>}
        </div>
      </div>
    </div>
  );
}
