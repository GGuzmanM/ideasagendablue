import { nombreMedico } from '../../api/medicoCita';
import { citaLlevaMedico, useMedicoDeLaCita, type CitaConMedico } from '../../services/medicoCitaService';

/**
 * «Médico de la cita» en el detalle. Los médicos se reparten las citas entre ellos: cada uno toca
 * «Tomar esta cita» (y puede soltarla). Admin y coordinación eligen a cualquiera del desplegable.
 * Recepción solo lo ve.
 */
export function MedicoDeLaCita({ cita }: { cita: CitaConMedico }) {
  const m = useMedicoDeLaCita(cita);
  if (!citaLlevaMedico(cita)) return null;
  const nombre = nombreMedico(m.medico);

  return (
    <div className="space-y-2" data-testid="medico-cita">
      <div className="flex justify-between items-end">
        <p className="text-sm font-bold text-on-surface">Médico de la cita</p>
        {m.medico?.colegiatura && <p className="text-xs text-on-surface-variant font-medium">{m.medico.colegiatura}</p>}
      </div>

      <div className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5 ${m.medicoId ? 'border-sky-200 bg-sky-50/60' : 'border-dashed border-outline-variant/50 bg-surface-container-lowest'}`}>
        <span className={`material-symbols-outlined text-xl ${m.medicoId ? 'text-sky-700' : 'text-on-surface-variant'}`}>stethoscope</span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold truncate ${m.medicoId ? 'text-sky-900' : 'text-on-surface-variant'}`} data-testid="medico-cita-nombre">
            {nombre ?? 'Sin médico asignado'}
            {m.esMia && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-600 text-white align-middle">Tú</span>}
          </p>
          {!m.medicoId && m.soyMedico && m.activa && <p className="text-[11px] text-on-surface-variant">Tómala si vas a atender a este paciente.</p>}
        </div>

        {m.puedeTomar && (
          <button type="button" onClick={m.tomar} disabled={m.pendiente} data-testid="medico-tomar"
            className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-sky-700 text-white text-xs font-bold hover:bg-sky-800 disabled:opacity-50 flex items-center gap-1">
            <span className="material-symbols-outlined text-base">front_hand</span>Tomar esta cita
          </button>
        )}
        {m.puedeSoltar && !m.puedeAsignar && (
          <button type="button" onClick={m.soltar} disabled={m.pendiente} data-testid="medico-soltar"
            className="min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-rose-700 hover:bg-rose-50 disabled:opacity-50">
            Soltar
          </button>
        )}
      </div>

      {m.puedeAsignar && m.activa && (
        <label className="flex items-center gap-2 text-xs text-on-surface-variant">
          <span className="shrink-0 font-semibold">Asignar:</span>
          <select
            data-testid="medico-asignar"
            value={m.medicoId ?? ''}
            disabled={m.pendiente || m.cargandoAsignables}
            onChange={(e) => m.asignar(e.target.value || null)}
            className="flex-1 min-h-[40px] lg:min-h-0 rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-2 py-1.5 text-sm text-on-surface"
          >
            <option value="">— Sin médico —</option>
            {m.asignables.some((x) => x.enEstaSede) && (
              <optgroup label="Con acceso a esta sede">
                {m.asignables.filter((x) => x.enEstaSede).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.colegiatura ? '' : ' (sin CMP)'}</option>)}
              </optgroup>
            )}
            <optgroup label="Otros médicos">
              {m.asignables.filter((x) => !x.enEstaSede).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.colegiatura ? '' : ' (sin CMP)'}</option>)}
            </optgroup>
          </select>
        </label>
      )}
    </div>
  );
}
