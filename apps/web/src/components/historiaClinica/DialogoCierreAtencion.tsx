// Cierre de la atención: lista lo que falta (aviso, no bloqueo) y propone los PRÓXIMOS CONTROLES
// (4.1): por riesgo IWGDF, por los servicios indicados y los que agregue el profesional.
import { ORIGEN_CONTROL_LABEL, RIESGO_IWGDF_LABEL, type AtencionCompleta, type ControlEntrada } from '../../api/historiaClinica';
import { useCierreConControles } from '../../services/controlesService';

const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const CHIP: Record<string, string> = { iwgdf: 'bg-rose-100 text-rose-700', indicacion: 'bg-primary/10 text-primary', manual: 'bg-surface-container text-on-surface-variant' };

export function DialogoCierreAtencion({ a, faltantes, pending, onCerrar, onClose }: {
  a: AtencionCompleta; faltantes: string[]; pending: boolean; onCerrar: (controles: ControlEntrada[]) => void; onClose: () => void;
}) {
  const c = useCierreConControles(a);
  const n = c.controles.length;
  return (
    <div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={(ev) => ev.stopPropagation()} data-testid="dialogo-cierre">
        <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">lock</span>Cerrar atención</h3>

        {faltantes.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><span className="material-symbols-outlined text-base">warning</span>Antes de cerrar, falta:</p>
            <ul className="mt-2 space-y-1">
              {faltantes.map((f) => <li key={f} className="text-sm text-on-surface flex items-start gap-2"><span className="material-symbols-outlined text-base text-amber-600">radio_button_unchecked</span>{f}</li>)}
            </ul>
            <p className="text-xs text-on-surface-variant mt-2">Puedes cerrar igual; queda registrado que la atención se cerró con estos pendientes.</p>
          </div>
        )}

        <section>
          <p className="text-sm font-semibold text-on-surface flex items-center gap-1.5"><span className="material-symbols-outlined text-base text-primary">event_repeat</span>Próximos controles</p>
          <p className="text-xs text-on-surface-variant mb-2">Quedan pendientes y aparecen en la Bandeja clínica cuando se acercan, para agendarlos.</p>
          {c.pendientes.length > 0 && (
            <p className="text-xs text-on-surface-variant bg-surface-container-low/60 rounded-lg px-3 py-2 mb-2">
              Ya tiene {c.pendientes.length} pendiente{c.pendientes.length === 1 ? '' : 's'}: {c.pendientes.map((p) => `${fmtFecha(p.fechaSugerida)} (${p.motivo})`).join(' · ')}
            </p>
          )}
          {c.cargando ? <p className="text-xs text-on-surface-variant">Calculando sugerencias…</p> : c.error ? <p className="text-xs text-rose-700">{c.error.message}</p> : (
            <div className="space-y-2">
              {c.filas.length === 0 && <p className="text-xs text-on-surface-variant">Sin sugerencias: no hay escala IWGDF ni servicios indicados en esta atención.</p>}
              {c.filas.map((f) => (
                <div key={f.clave} className={`rounded-xl border px-3 py-2 space-y-1.5 ${f.incluir ? 'border-primary/30 bg-primary/[0.03]' : 'border-outline-variant/30 opacity-60'}`} data-testid="fila-control">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input type="checkbox" checked={f.incluir} onChange={(e) => c.cambiar(f.clave, { incluir: e.target.checked })} className="w-4 h-4" aria-label="Guardar este control" />
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${CHIP[f.origen]}`}>{ORIGEN_CONTROL_LABEL[f.origen]}{f.riesgo != null ? ` ${f.riesgo} · ${RIESGO_IWGDF_LABEL[f.riesgo]}` : ''}</span>
                    <input type="date" value={f.fechaSugerida} min={c.hoy} onChange={(e) => c.cambiar(f.clave, { fechaSugerida: e.target.value })}
                      className="bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-sm text-on-surface" />
                    <span className="flex-1" />
                    {f.origen === 'manual' && <button type="button" onClick={() => c.quitar(f.clave)} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg" aria-label="Quitar">close</button>}
                  </div>
                  <input value={f.motivo} onChange={(e) => c.cambiar(f.clave, { motivo: e.target.value })} maxLength={300} placeholder="Motivo del control (ej. Control de curación)"
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-1.5 text-sm text-on-surface outline-none focus:border-primary" data-testid="motivo-control" />
                </div>
              ))}
              <button type="button" onClick={c.agregarManual} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1" data-testid="agregar-control"><span className="material-symbols-outlined text-base">add</span>Agregar control</button>
              {c.invalidas > 0 && <p className="text-xs text-amber-700">Completa el motivo (mín. 3 letras) y una fecha desde hoy en los controles marcados, o desmárcalos.</p>}
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2 pt-2 flex-wrap">
          <button onClick={onClose} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high">{faltantes.length ? 'Volver a completar' : 'Volver'}</button>
          <button onClick={() => onCerrar(c.controles)} disabled={pending || c.cargando || c.invalidas > 0} data-testid="confirmar-cierre"
            className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">
            {pending ? 'Cerrando…' : `${faltantes.length ? 'Cerrar de todos modos' : 'Cerrar atención'}${n ? ` y guardar ${n} control${n === 1 ? '' : 'es'}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
