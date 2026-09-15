// Bandeja clínica del día (la "ronda" del médico): atenciones abiertas con lo que les falta, para
// revisarlas y cerrarlas en lote, + pacientes con sesiones pendientes que no vuelven (abandono).
// Vista PURA: la lógica vive en services/historiaClinicaService.ts (useBandejaPage).
import { Skeleton } from '../components/ui/Skeleton';
import { useBandejaPage } from '../services/historiaClinicaService';
import { useAuthStore } from '../stores/authStore';
import { ControlesPorAgendar } from '../components/historiaClinica/ControlesPorAgendar';

const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const CARD = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5';
const BTN_SEC = 'min-h-[40px] lg:min-h-0 px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1 disabled:opacity-50';

export function BandejaClinicaPage() {
  const b = useBandejaPage();
  const puedeRegistrar = useAuthStore((s) => s.tiene('hc.registrar'));
  const abiertas = b.bandeja?.abiertas ?? [];
  const sinVolver = b.bandeja?.sinVolver ?? [];
  const completas = abiertas.filter((a) => a.faltantes.length === 0);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1100px] overflow-y-auto h-full">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-headline-md text-headline-md font-bold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">inbox</span>Bandeja clínica</h1>
          <p className="text-xs text-on-surface-variant mt-0.5">Lo que quedó abierto en la ronda y los pacientes que no vuelven.</p>
        </div>
        <button onClick={b.refrescar} className={BTN_SEC}><span className="material-symbols-outlined text-base">refresh</span>Actualizar</button>
      </header>

      {/* Controles sugeridos al cerrar que vencen pronto o ya vencieron (4.2) */}
      <ControlesPorAgendar puedeRegistrar={puedeRegistrar} />

      {b.cargando ? <Skeleton className="h-40 w-full" /> : b.error ? <p className="text-sm text-rose-700">{b.error.message}</p> : (
        <>
          {/* Atenciones abiertas */}
          <section className={CARD}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-primary">pending_actions</span>Atenciones abiertas ({abiertas.length})</h2>
              {puedeRegistrar && completas.length > 0 && (
                <button onClick={() => b.cerrarTodas(completas.map((a) => a.id))} disabled={b.cerrandoTodas} className="min-h-[40px] lg:min-h-0 px-4 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold flex items-center gap-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-base">lock</span>{b.cerrandoTodas ? 'Cerrando…' : `Cerrar las ${completas.length} completas`}
                </button>
              )}
            </div>
            {abiertas.length === 0 && <p className="text-sm text-on-surface-variant">No hay atenciones abiertas. Todo cerrado.</p>}
            <div className="space-y-2">
              {abiertas.map((a) => (
                <div key={a.id} className="rounded-xl border border-outline-variant/20 px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="w-1 h-8 rounded-full shrink-0" style={{ background: a.servicio.color }} />
                    <button onClick={() => b.abrir(a)} className="text-sm font-bold text-primary hover:underline text-left">{a.paciente.nombres} {a.paciente.apellidoPaterno} {a.paciente.apellidoMaterno}</button>
                    <span className="text-xs text-on-surface-variant">{fmtFecha(a.fecha)} · {a.horaInicio} · {a.servicio.nombre} · {a.sede.nombre} · {a.profesional.apellidos} {a.profesional.nombres}</span>
                    <span className="flex-1" />
                    {a.faltantes.length === 0
                      ? <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">Completa</span>
                      : <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-800">{a.faltantes.length} pendiente{a.faltantes.length === 1 ? '' : 's'}</span>}
                    {puedeRegistrar && <button onClick={() => b.cerrarMut.mutate(a.id)} disabled={b.cerrarMut.isPending || b.cerrandoTodas} className={BTN_SEC} title="Cerrar esta atención"><span className="material-symbols-outlined text-base">lock</span>Cerrar</button>}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-1">Motivo: {a.motivoConsulta} · {a.totales.notas} nota(s) · {a.totales.diagnosticos} dx · {a.totales.procedimientos} proc. · {a.totales.recetas} receta(s)</p>
                  {a.faltantes.length > 0 && <p className="text-xs text-amber-700 mt-1 flex items-center gap-1"><span className="material-symbols-outlined text-sm">warning</span>Falta: {a.faltantes.join(' · ')}</p>}
                </div>
              ))}
            </div>
          </section>

          {/* Abandono */}
          <section className={CARD}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center gap-2"><span className="material-symbols-outlined text-rose-600">person_off</span>Pacientes que no vuelven ({sinVolver.length})</h2>
              <label className="text-xs text-on-surface-variant flex items-center gap-2">Sin venir hace más de
                <select value={b.dias} onChange={(ev) => b.setDias(Number(ev.target.value))} className="bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-sm text-on-surface">
                  {[30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-on-surface-variant mb-3">Tienen sesiones pendientes en un paquete o membresía activa y no tienen cita futura agendada.</p>
            {sinVolver.length === 0 && <p className="text-sm text-on-surface-variant">Ninguno con ese criterio.</p>}
            <div className="space-y-1.5">
              {sinVolver.map((s) => (
                <div key={s.paquetePacienteId} className="flex items-center gap-2 flex-wrap rounded-xl border border-outline-variant/20 px-3 py-2">
                  <button onClick={() => b.abrirPaciente(s.paciente.id)} className="text-sm font-bold text-primary hover:underline text-left">{s.paciente.nombres} {s.paciente.apellidoPaterno} {s.paciente.apellidoMaterno}</button>
                  <span className="text-xs text-on-surface-variant">{s.paquete} · {s.sesionesRestantes} sesión(es) pendiente(s) · última cita {fmtFecha(s.ultimaCita)}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-rose-100 text-rose-700">{s.diasSinVenir} días</span>
                  {s.paciente.telefono && <a href={`tel:${s.paciente.telefono}`} className="text-xs font-semibold text-primary flex items-center gap-0.5"><span className="material-symbols-outlined text-sm">call</span>{s.paciente.telefono}</a>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
