import type { CitaResumen } from '../../api/citas';
import type { AtencionCompleta } from '../../api/historiaClinica';
import { useRegistrarAtencionForm } from '../../services/historiaClinicaService';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const ESTADO_CITA: Record<string, string> = { llego: 'Llegó', en_atencion: 'En atención', completada: 'Completada', agendada: 'Agendada', confirmada: 'Confirmada' };

// Registrar atención clínica desde una cita atendida (llegó / en atención / completada).
export function RegistrarAtencionModal({ cita, nombrePaciente, onClose, onCreada }: { cita: CitaResumen; nombrePaciente: string; onClose: () => void; onCreada: (a: AtencionCompleta) => void }) {
  const f = useRegistrarAtencionForm(cita, onCreada);
  const fecha = (cita.fecha ?? '').slice(0, 10).split('-').reverse().join('/');
  const estado = (cita.estado || '').toLowerCase();
  return (
    // El fondo no cierra (se sale con Cancelar o la X): en la tablet se toca sin querer.
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest w-full max-w-[560px] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200">
        <div className="bg-[#0044ab] text-white p-6 flex justify-between items-start shrink-0 shadow-md">
          <div>
            <h3 className="font-headline-md text-headline-md font-bold">Registrar atención clínica</h3>
            <p className="text-sm text-white/80 mt-1 flex items-center gap-1.5"><span className="material-symbols-outlined text-base">clinical_notes</span>{nombrePaciente}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="material-symbols-outlined text-white/80 hover:text-white text-2xl min-w-[44px] min-h-[44px] flex items-center justify-center">close</button>
        </div>
        <div className="p-6 space-y-5">
          <div className="rounded-xl bg-surface-container-low/60 border border-outline-variant/20 p-3 text-sm grid grid-cols-2 gap-2">
            <div><span className={LBL}>Cita</span><b>{fecha} · {cita.horaInicio}</b></div>
            <div><span className={LBL}>Servicio</span><b>{cita.servicio?.nombre ?? '—'}</b></div>
            <div><span className={LBL}>Sede</span><b>{cita.sede?.nombre ?? '—'}</b></div>
            <div><span className={LBL}>Estado</span><b>{ESTADO_CITA[estado] ?? cita.estado}</b></div>
          </div>
          <div>
            <label className={LBL}>Motivo de consulta *</label>
            <textarea value={f.motivoConsulta} onChange={(e) => f.setMotivoConsulta(e.target.value)} rows={3} autoFocus maxLength={500} placeholder="Ej. Dolor y engrosamiento de la uña del 1.er dedo derecho" className={INPUT} />
          </div>
          <div>
            <label className={LBL}>Profesional que atendió {f.columnaEsEquipo ? '(médico que supervisó) *' : ''}</label>
            <select value={f.profesionalId} onChange={(e) => f.setProfesionalId(e.target.value)} className={INPUT}>
              {f.columnaEsEquipo ? <option value="">— Elige el médico que supervisó —</option> : <option value="">— El de la cita —</option>}
              {f.opciones.map((p) => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos} · {p.tipo}</option>)}
            </select>
            {f.columnaEsEquipo && (
              <p className="text-[11px] text-on-surface-variant mt-1">La cita es de baropodometría (equipo): la atención se registra a nombre del médico que la supervisó, quien también podrá emitir la receta.</p>
            )}
          </div>
        </div>
        <div className="p-5 border-t border-outline-variant/30 flex gap-3 bg-surface-container-low/40 shrink-0">
          <button type="button" onClick={onClose} className="flex-1 px-5 py-2.5 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">Cancelar</button>
          <button type="button" onClick={() => f.abrirMut.mutate()} disabled={!f.puedeGuardar || f.abrirMut.isPending}
            className="flex-1 px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer">
            {f.abrirMut.isPending ? 'Registrando…' : 'Abrir atención'}
          </button>
        </div>
      </div>
    </div>
  );
}
