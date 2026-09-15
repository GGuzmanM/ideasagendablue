// Bloque «Constancias y descansos médicos» (5.4) dentro de la pestaña Receta. Vista pura: la lógica
// vive en services/constanciasService.ts. Formulario corto: la constancia sale con un toque; el
// descanso pide desde cuándo, cuántos días y el diagnóstico.
import { TIPO_CONSTANCIA_LABEL, MAX_DIAS_DESCANSO, type AtencionCompleta } from '../../api/historiaClinica';
import { useConstancias } from '../../services/constanciasService';
import { DialogoMotivo } from './DialogoMotivo';
import { fmtFechaDia, fmtFechaLima } from '../../utils/fechas';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const BTN = 'min-h-[44px] lg:min-h-0 px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1';

export function ConstanciasSection({ a, puedeRegistrar, esMedicoPrescriptor }: { a: AtencionCompleta; puedeRegistrar: boolean; esMedicoPrescriptor: boolean }) {
  const c = useConstancias(a, puedeRegistrar, esMedicoPrescriptor);
  return (
    <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 space-y-3" data-testid="constancias">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center"><span className="material-symbols-outlined mr-2 text-primary">verified</span>Constancias y descansos médicos</h3>
        {!c.tipo && (
          <div className="flex gap-2 flex-wrap">
            {c.puedeConstancia && <button onClick={() => c.abrir('constancia_atencion')} data-testid="nueva-constancia" className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-primary/40 text-primary bg-primary/5 rounded-xl text-sm font-bold hover:bg-primary/10 flex items-center gap-2"><span className="material-symbols-outlined text-base">task</span>Constancia de atención</button>}
            {c.puedeDescanso && <button onClick={() => c.abrir('descanso_medico')} data-testid="nuevo-descanso" className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-primary/40 text-primary bg-primary/5 rounded-xl text-sm font-bold hover:bg-primary/10 flex items-center gap-2"><span className="material-symbols-outlined text-base">bed</span>Descanso médico</button>}
          </div>
        )}
      </div>
      {puedeRegistrar && !esMedicoPrescriptor && !c.tipo && <p className="text-xs text-on-surface-variant">El descanso médico lo emite solo un médico colegiado con sesión.</p>}

      {c.tipo && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="form-constancia">
          <p className="text-sm font-semibold text-on-surface">{TIPO_CONSTANCIA_LABEL[c.tipo]}</p>
          {c.tipo === 'constancia_atencion'
            ? <p className="text-xs text-on-surface-variant">Deja constancia de que el paciente fue atendido hoy en esta sede, por este servicio y a cargo del profesional que lo atendió. El texto lo arma el sistema; puedes agregar una nota.</p>
            : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><label className={LBL}>Desde el día</label><input type="date" value={c.desde} onChange={(e) => c.setDesde(e.target.value)} className={INPUT} data-testid="descanso-desde" /></div>
                <div><label className={LBL}>Días de descanso (1 a {MAX_DIAS_DESCANSO})</label><input type="text" inputMode="numeric" value={c.dias} onChange={(e) => c.setDias(e.target.value.replace(/\D/g, '').slice(0, 2))} className={INPUT} data-testid="descanso-dias" /></div>
                <div><label className={LBL}>Hasta (inclusive)</label><p className="px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface bg-surface-container-low/60 rounded-lg">{c.hasta ? fmtFechaDia(c.hasta) : '—'}</p></div>
                <div className="md:col-span-3"><label className={LBL}>Diagnóstico que sustenta el descanso</label>
                  {c.diagnosticos.length === 0
                    ? <p className="text-xs text-amber-700">Registra primero un diagnóstico en la pestaña Evolución.</p>
                    : <select value={c.dxCodigo} onChange={(e) => c.setDxCodigo(e.target.value)} className={INPUT} data-testid="descanso-dx">
                        {c.diagnosticos.map((d) => <option key={d.id} value={d.cie10Codigo}>{d.cie10Codigo} · {d.cie10.descripcion}{d.principal ? ' (principal)' : ''}</option>)}
                      </select>}
                </div>
              </div>
            )}
          <div><label className={LBL}>Nota adicional (opcional)</label><textarea value={c.observacion} onChange={(e) => c.setObservacion(e.target.value)} rows={2} maxLength={1000} placeholder={c.tipo === 'descanso_medico' ? 'Ej. Debe mantener el pie en alto y volver a control el…' : 'Ej. Acudió acompañado; se recomienda reposo relativo por 24 horas.'} className={INPUT} data-testid="constancia-observacion" /></div>
          <div className="flex flex-wrap items-center gap-3">
            {c.faltantes.length > 0 && <span className="text-xs text-on-surface-variant flex-1">Falta {c.faltantes.join(', ')}.</span>}
            <span className="flex-1" />
            <button type="button" onClick={c.cerrar} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container-high">Cancelar</button>
            <button type="button" disabled={!c.puedeEmitir || c.emitirMut.isPending} onClick={() => c.emitirMut.mutate()} data-testid="emitir-constancia" className="min-h-[44px] lg:min-h-0 px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">{c.emitirMut.isPending ? 'Emitiendo…' : 'Emitir e imprimir'}</button>
          </div>
        </div>
      )}

      {c.emitida && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800 flex flex-wrap items-center gap-3" data-testid="constancia-emitida">
          <span className="material-symbols-outlined">check_circle</span>
          <span className="flex-1">{TIPO_CONSTANCIA_LABEL[c.emitida.tipo]} N° {String(c.emitida.numero).padStart(5, '0')} emitida.</span>
          <button onClick={() => c.ver(c.emitida!.id)} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-2"><span className="material-symbols-outlined text-base">print</span>Ver e imprimir</button>
        </div>
      )}

      {c.lista.length === 0 ? (
        !c.tipo && <p className="text-sm text-on-surface-variant">Sin constancias en esta atención.</p>
      ) : (
        <div className="space-y-2" data-testid="lista-constancias">
          {c.lista.map((x) => (
            <div key={x.id} className={`rounded-xl border px-4 py-3 flex flex-wrap items-center gap-3 ${x.estado === 'anulada' ? 'border-rose-200 bg-rose-50/40' : 'border-outline-variant/30'}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-on-surface">{TIPO_CONSTANCIA_LABEL[x.tipo]} N° {String(x.numero).padStart(5, '0')}{x.estado === 'anulada' && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Anulada</span>}</p>
                <p className="text-xs text-on-surface-variant">{fmtFechaLima(x.fechaEmision)} · {x.emisorNombre}{x.tipo === 'descanso_medico' && x.desde && x.hasta ? ` · ${x.dias} día(s): ${fmtFechaDia(x.desde)} al ${fmtFechaDia(x.hasta)}` : ''}{x.diagnosticoCie10Codigo ? ` · ${x.diagnosticoCie10Codigo}` : ''}</p>
                {x.estado === 'anulada' && x.motivoAnulacion && <p className="text-xs text-rose-700">Motivo: {x.motivoAnulacion}</p>}
              </div>
              <button onClick={() => c.ver(x.id)} className={BTN}><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver</button>
              {c.puedeAnular(x) && <button onClick={() => c.setAnulando(x.id)} className="min-h-[44px] lg:min-h-0 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Anular</button>}
            </div>
          ))}
        </div>
      )}
      {c.anulando && <DialogoMotivo titulo="Anular el documento" descripcion="Queda anulado con marca de agua y motivo; si hace falta, emite uno nuevo." confirmar="Anular" pending={c.anularMut.isPending} onConfirmar={(m) => c.anularMut.mutate({ id: c.anulando!, motivo: m })} onClose={() => c.setAnulando(null)} />}
    </section>
  );
}
