// Pestaña «Consentimientos» (5.1): lista de la atención + formulario para firmar en la tablet.
// Vista pura: la lógica vive en services/consentimientoService.ts.
import type { AtencionCompleta } from '../../api/historiaClinica';
import { useConsentimientos } from '../../services/consentimientoService';
import { FirmaPad } from './FirmaPad';
import { DialogoMotivo } from './DialogoMotivo';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PanelConsentimientos({ a, puedeRegistrar }: { a: AtencionCompleta; puedeRegistrar: boolean }) {
  const c = useConsentimientos(a, puedeRegistrar);
  return (
    <div className="space-y-4" data-testid="panel-consentimientos">
      {c.puedeFirmar && !c.abierto && (
        <button onClick={() => c.setAbierto(true)} data-testid="nuevo-consentimiento"
          className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:opacity-90 flex items-center gap-2">
          <span className="material-symbols-outlined text-base">contract_edit</span>Nuevo consentimiento
        </button>
      )}
      {c.cerrada && puedeRegistrar && (
        <p className="text-xs text-amber-700">La atención está cerrada: el consentimiento se firma antes del procedimiento, con la atención abierta.</p>
      )}

      {c.abierto && (
        <section className="rounded-2xl border border-primary/30 bg-surface-container-lowest p-4 lg:p-5 space-y-4" data-testid="form-consentimiento">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className={LBL}>Procedimiento que se autoriza</label>
              <input list="sugerencias-consentimiento" value={c.procedimiento} onChange={(e) => c.setProcedimiento(e.target.value)} maxLength={300}
                placeholder="Ej. Matricectomía parcial del borde externo, 1er dedo pie derecho" className={INPUT} data-testid="consentimiento-procedimiento" />
              <datalist id="sugerencias-consentimiento">{c.sugerencias.map((s) => <option key={s.texto} value={s.texto} />)}</datalist>
            </div>
            <div className="md:col-span-2 flex gap-2">
              {(['paciente', 'apoderado'] as const).map((r) => (
                <button key={r} type="button" onClick={() => c.cambiarRelacion(r)} data-testid={`firmante-${r}`}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${c.relacion === r ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant'}`}>
                  {r === 'paciente' ? 'Firma el paciente' : 'Firma un apoderado'}
                </button>
              ))}
            </div>
            <div><label className={LBL}>Nombre de quien firma</label><input value={c.firmanteNombre} onChange={(e) => c.setFirmanteNombre(e.target.value)} maxLength={200} className={INPUT} data-testid="firmante-nombre" /></div>
            <div><label className={LBL}>Documento{c.relacion === 'apoderado' ? ' (obligatorio)' : ''}</label><input value={c.firmanteDocumento} onChange={(e) => c.setFirmanteDocumento(e.target.value)} maxLength={20} className={INPUT} data-testid="firmante-documento" /></div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={LBL + ' mb-0'}>Texto que se lee y se firma</span>
              {/* De dónde sale el cuerpo: la plantilla del procedimiento (5.2) o el texto general. */}
              <span className="text-[11px] text-on-surface-variant" data-testid="consentimiento-origen">
                {c.plantilla ? <>Plantilla: <b className="text-on-surface">{c.plantilla.nombre}</b></> : 'Texto general (este procedimiento no tiene plantilla propia)'}
              </span>
              <span className="flex-1" />
              {c.plantilla && (
                <button type="button" onClick={() => { c.setSinPlantilla(true); c.setTextoEditado(null); }} className="text-xs text-on-surface-variant font-semibold hover:underline">Usar el texto general</button>
              )}
              {!c.plantilla && c.sinPlantilla && (
                <button type="button" onClick={() => { c.setSinPlantilla(false); c.setTextoEditado(null); }} className="text-xs text-on-surface-variant font-semibold hover:underline">Volver a la plantilla</button>
              )}
              {c.textoEditado === null
                ? <button type="button" onClick={() => c.setTextoEditado(c.texto)} className="text-xs text-primary font-semibold hover:underline">Ajustar texto</button>
                : <button type="button" onClick={() => c.setTextoEditado(null)} className="text-xs text-primary font-semibold hover:underline">Deshacer mis cambios</button>}
            </div>
            {c.textoEditado === null
              ? <div className="rounded-xl bg-surface-container-low/60 border border-outline-variant/30 px-4 py-3 text-sm leading-relaxed text-on-surface whitespace-pre-line max-h-72 overflow-y-auto" data-testid="consentimiento-texto">{c.texto}</div>
              : <textarea value={c.textoEditado} onChange={(e) => c.setTextoEditado(e.target.value)} rows={10} maxLength={20000} className={INPUT + ' leading-relaxed'} data-testid="consentimiento-texto-editable" />}
          </div>

          <div>
            <p className="text-xs text-on-surface-variant mb-1.5">Entregue la tablet {c.relacion === 'paciente' ? 'al paciente' : 'al apoderado'}: que lea el texto y firme en el recuadro.</p>
            <FirmaPad trazos={c.firma} onChange={c.setFirma} deshabilitado={c.firmarMut.isPending} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {c.faltantes.length > 0 && <span className="text-xs text-on-surface-variant flex-1">Falta {c.faltantes.join(', ')}.</span>}
            <span className="flex-1" />
            <button type="button" onClick={c.reiniciar} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container-high">Cancelar</button>
            <button type="button" disabled={c.faltantes.length > 0 || c.firmarMut.isPending} onClick={() => c.firmarMut.mutate()} data-testid="firmar-consentimiento"
              className="px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">{c.firmarMut.isPending ? 'Guardando…' : 'Registrar consentimiento firmado'}</button>
          </div>
        </section>
      )}

      {c.lista.length === 0 ? (
        !c.abierto && <div className="text-center py-12 text-on-surface-variant border border-dashed border-outline-variant/40 rounded-2xl"><span className="material-symbols-outlined text-4xl mb-1">contract</span><p className="text-sm">Sin consentimientos en esta atención.</p></div>
      ) : (
        <div className="space-y-2" data-testid="lista-consentimientos">
          {c.lista.map((x) => (
            <div key={x.id} className={`rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-3 ${x.estado === 'revocado' ? 'border-rose-200 bg-rose-50/40' : 'border-outline-variant/30 bg-surface-container-lowest'}`}>
              <span className="material-symbols-outlined text-primary">contract</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-on-surface">
                  N° {String(x.numero).padStart(5, '0')} · {x.procedimiento}
                  {x.estado === 'revocado' && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Revocado</span>}
                </div>
                <div className="text-[11px] text-on-surface-variant">
                  {fmtFechaHora(x.firmadoEn)} · firmó {x.firmanteNombre}{x.firmanteRelacion === 'apoderado' ? ' (apoderado)' : ''}{x.registradoEtiqueta ? ` · registró ${x.registradoEtiqueta}` : ''}
                  {x.estado === 'revocado' && x.motivoRevocacion && <> · motivo: {x.motivoRevocacion}</>}
                </div>
              </div>
              <button onClick={() => c.verPdf(x.id)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver</button>
              {x.estado === 'firmado' && puedeRegistrar && <button onClick={() => c.setRevocando(x.id)} className="px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Revocar</button>}
            </div>
          ))}
        </div>
      )}
      {c.revocando && (
        <DialogoMotivo titulo="Revocar consentimiento" descripcion="El paciente retira su consentimiento. Queda registrado (no se borra) y su PDF sale con la marca REVOCADO."
          confirmar="Revocar" pending={c.revocarMut.isPending} onConfirmar={(m) => c.revocarMut.mutate({ id: c.revocando!, motivo: m })} onClose={() => c.setRevocando(null)} />
      )}
    </div>
  );
}
