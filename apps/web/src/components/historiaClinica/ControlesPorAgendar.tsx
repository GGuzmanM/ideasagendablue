// Bandeja clínica · «Controles por agendar» (4.2): los controles sugeridos al cerrar que ya
// vencieron o vencen pronto, con el riesgo IWGDF del paciente y su próxima cita si ya tiene una.
import { ORIGEN_CONTROL_LABEL, RIESGO_IWGDF_LABEL } from '../../api/historiaClinica';
import { useControlesBandeja } from '../../services/controlesService';
import { DialogoMotivo } from './DialogoMotivo';

const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const CARD = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5';
const BTN_SEC = 'min-h-[40px] lg:min-h-0 px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1 disabled:opacity-50';
const RIESGO_CHIP = ['bg-emerald-100 text-emerald-700', 'bg-yellow-100 text-yellow-800', 'bg-orange-100 text-orange-800', 'bg-rose-100 text-rose-700'];

export function ControlesPorAgendar({ puedeRegistrar }: { puedeRegistrar: boolean }) {
  const c = useControlesBandeja();
  const lista = c.datos?.controles ?? [];
  const vencidos = lista.filter((x) => x.vencido).length;
  return (
    <section className={CARD} data-testid="controles-por-agendar">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">event_repeat</span>Controles por agendar ({lista.length})
          {vencidos > 0 && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-rose-100 text-rose-700">{vencidos} vencido{vencidos === 1 ? '' : 's'}</span>}
        </h2>
        <label className="text-xs text-on-surface-variant flex items-center gap-2">Vencen en los próximos
          <select value={c.dias} onChange={(ev) => c.setDias(Number(ev.target.value))} className="bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-sm text-on-surface">
            {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} días</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-on-surface-variant mb-3">Sugeridos al cerrar la atención (riesgo IWGDF o servicios indicados). Se quitan de la lista al marcarlos agendados o descartarlos.</p>
      {c.cargando ? <p className="text-sm text-on-surface-variant">Cargando…</p> : c.error ? <p className="text-sm text-rose-700">{c.error.message}</p> : (
        <>
          {lista.length === 0 && <p className="text-sm text-on-surface-variant">Ningún control pendiente en ese plazo.</p>}
          <div className="space-y-2">
            {lista.map((x) => (
              <div key={x.id} className={`rounded-xl border px-4 py-3 ${x.vencido ? 'border-rose-200 bg-rose-50/30' : 'border-outline-variant/20'}`} data-testid="control-pendiente">
                <div className="flex items-center gap-2 flex-wrap">
                  {x.riesgo != null && <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${RIESGO_CHIP[x.riesgo]}`} title="Riesgo IWGDF actual del paciente">IWGDF {x.riesgo} · {RIESGO_IWGDF_LABEL[x.riesgo]}</span>}
                  <button onClick={() => c.abrirPaciente(x.paciente.id)} className="text-sm font-bold text-primary hover:underline text-left">{x.paciente.nombres} {x.paciente.apellidoPaterno} {x.paciente.apellidoMaterno}</button>
                  <span className={`text-xs font-semibold ${x.vencido ? 'text-rose-700' : x.diasRestantes <= 7 ? 'text-amber-700' : 'text-on-surface-variant'}`}>
                    {fmtFecha(x.fechaSugerida)} · {x.vencido ? `venció hace ${-x.diasRestantes} día${x.diasRestantes === -1 ? '' : 's'}` : x.diasRestantes === 0 ? 'hoy' : `en ${x.diasRestantes} día${x.diasRestantes === 1 ? '' : 's'}`}
                  </span>
                  <span className="flex-1" />
                  {x.paciente.telefono && <a href={`tel:${x.paciente.telefono}`} className="text-xs font-semibold text-primary flex items-center gap-0.5"><span className="material-symbols-outlined text-sm">call</span>{x.paciente.telefono}</a>}
                </div>
                <p className="text-xs text-on-surface mt-1"><span className="text-[10px] font-bold uppercase text-on-surface-variant mr-1">{ORIGEN_CONTROL_LABEL[x.origen]}</span>{x.motivo}</p>
                <p className="text-[11px] text-on-surface-variant mt-0.5">De la atención del {fmtFecha(x.atencion.fecha)} · {x.atencion.profesional.apellidos} {x.atencion.profesional.nombres} · {x.atencion.sede}</p>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  {x.proximaCita && <span className="text-xs text-emerald-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm">event_available</span>Tiene cita el {fmtFecha(x.proximaCita.fecha)} {x.proximaCita.horaInicio} · {x.proximaCita.servicio} · {x.proximaCita.sede}</span>}
                  <span className="flex-1" />
                  {puedeRegistrar && x.proximaCita && (
                    <button onClick={() => c.resolverMut.mutate({ id: x.id, accion: 'agendar', citaId: x.proximaCita!.id })} disabled={c.resolverMut.isPending} className={BTN_SEC} data-testid="vincular-cita">
                      <span className="material-symbols-outlined text-base">link</span>Vincular esa cita
                    </button>
                  )}
                  {puedeRegistrar && (
                    <button onClick={() => c.resolverMut.mutate({ id: x.id, accion: 'agendar' })} disabled={c.resolverMut.isPending} className={BTN_SEC} data-testid="marcar-agendado">
                      <span className="material-symbols-outlined text-base">event_available</span>Marcar agendado
                    </button>
                  )}
                  {puedeRegistrar && <button onClick={() => c.setDescartando(x.id)} className="px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Descartar</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {c.descartando && (
        <DialogoMotivo titulo="Descartar control" descripcion="El control deja de aparecer en la bandeja (queda registrado con el motivo)." confirmar="Descartar"
          pending={c.resolverMut.isPending} onConfirmar={(m) => c.resolverMut.mutate({ id: c.descartando!, accion: 'descartar', motivo: m })} onClose={() => c.setDescartando(null)} />
      )}
    </section>
  );
}
