import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi } from '../api';
import { citasApi, type CitaResumen } from '../api/citas';
import { reboteApi, TURNO_LABEL, RESULTADO_LLAMADA_LABEL, type CitaEnRebote } from '../api/rebote';
import { Idea1DetalleCitaModal } from '../components/agenda/Idea1DetalleCitaModal';
import { cn } from '../utils/cn';
import { useAuthStore } from '../stores/authStore';

const ORIGEN_LABEL: Record<string, string> = { agendada: 'Agendada', confirmada: 'Confirmada', no_show: 'No vino' };

/**
 * Bandeja de REBOTE (30-sep-2026; desde el 01-oct, quienes reprograman): citas que salieron de la agenda para volver a
 * llamar al paciente. General, con filtro de sede opcional. Clic en una fila → el detalle de la cita,
 * donde se registra la llamada, se reagenda (sale del rebote) o se descarta.
 */
export function ReboteBandejaPage() {
  const qc = useQueryClient();
  const [sedeId, setSedeId] = useState('');
  const [unidadId, setUnidadId] = useState('');
  const [abierta, setAbierta] = useState<CitaResumen | null>(null);
  const [cargandoId, setCargandoId] = useState<string | null>(null);

  const { data: todasSedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  // Solo las sedes a las que el usuario tiene acceso (hoy todos los roles del rebote ven todas; el servidor igual filtra).
  const puedeAccederSede = useAuthStore((s) => s.puedeAccederSede);
  const sedes = todasSedes.filter((s) => puedeAccederSede(s.id));
  // Unidades (Podología / Baropodometría / Fisioterapia): las mismas en todas las sedes; se juntan sin repetir.
  const unidades = [...new Map(sedes.flatMap((s) => s.unidadesNegocio ?? []).map((u) => [u.id, u])).values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const reboteQ = useQuery({
    queryKey: ['rebote', 'bandeja', sedeId, unidadId],
    queryFn: () => reboteApi.listar({ sedeId: sedeId || undefined, unidadNegocioId: unidadId || undefined }),
    refetchInterval: 60_000,
  });
  const citas = reboteQ.data?.citas ?? [];
  const diasRebote = reboteQ.data?.diasRebote ?? 30;

  const abrir = async (c: CitaEnRebote) => {
    setCargandoId(c.id);
    try {
      setAbierta(await citasApi.obtener(c.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir la cita');
    } finally {
      setCargandoId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
      <header className="flex flex-wrap justify-between items-center gap-3 px-6 py-4 bg-surface-container-lowest border-b border-outline-variant/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">phone_callback</span>
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-on-surface leading-tight">Rebote</h1>
            <p className="text-xs text-on-surface-variant">
              Citas que salieron de la agenda para volver a llamar al paciente. Si en {diasRebote} días no se reagendan, se cancelan solas.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px]">medical_services</span>
            Unidad
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} data-testid="rebote-filtro-unidad"
              className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface">
              <option value="">Todas</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px]">location_on</span>
            Sede
            <select value={sedeId} onChange={(e) => setSedeId(e.target.value)} data-testid="rebote-filtro-sede"
              className="rounded-xl border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-xs font-semibold text-on-surface">
              <option value="">Todas</option>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {reboteQ.isLoading ? (
          <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : reboteQ.isError ? (
          <p className="text-sm text-error text-center py-16">{(reboteQ.error as Error).message}</p>
        ) : citas.length === 0 ? (
          <div className="text-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl text-violet-300">phone_callback</span>
            <p className="text-sm mt-2">No hay citas en rebote{sedeId || unidadId ? ' con estos filtros' : ''}.</p>
            <p className="text-xs mt-1 text-on-surface-variant/70">Se envían desde el detalle de la cita: «Enviar a rebote».</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 overflow-x-auto">
            <p className="px-4 py-2.5 text-xs font-semibold text-on-surface-variant border-b border-outline-variant/30">
              {citas.length} cita(s) por reagendar · ordenadas por las que vencen primero
            </p>
            <table className="w-full text-xs" data-testid="rebote-tabla">
              <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Paciente</th>
                  <th className="text-left px-3 py-2.5 font-bold">Servicio</th>
                  <th className="text-left px-3 py-2.5 font-bold">Sede · cita original</th>
                  <th className="text-left px-3 py-2.5 font-bold">Motivo</th>
                  <th className="text-left px-3 py-2.5 font-bold">Llamadas</th>
                  <th className="text-right px-4 py-2.5 font-bold">Vence</th>
                </tr>
              </thead>
              <tbody>
                {citas.map((c) => {
                  const nombre = `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.trim();
                  const aunNo = c.reboteLlamarDesde && c.reboteLlamarDesde > format(new Date(), 'yyyy-MM-dd');
                  return (
                    <tr key={c.id} onClick={() => abrir(c)} data-testid="rebote-fila"
                      className={cn('border-t border-outline-variant/20 cursor-pointer hover:bg-violet-50/60 transition-colors', cargandoId === c.id && 'opacity-50')}>
                      <td className="px-4 py-3 align-top">
                        <p className="font-bold text-on-surface">{nombre}</p>
                        <p className="text-on-surface-variant font-mono text-[11px]">{c.paciente.numeroDocumento} · {c.paciente.telefono}</p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mb-1"
                          style={{ backgroundColor: `${c.unidadNegocio.color}22`, color: c.unidadNegocio.color }} data-testid="rebote-unidad">
                          {c.unidadNegocio.nombre}
                        </span>
                        <p className="font-semibold text-on-surface">{c.servicio.nombre}{c.servicioExtra ? ` + ${c.servicioExtra}` : ''}</p>
                        {c.reboteTurno && <p className="text-[11px] text-violet-700">Prefiere: {TURNO_LABEL[c.reboteTurno]}</p>}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <p className="font-semibold text-on-surface">{c.sede.nombre}</p>
                        <p className="text-on-surface-variant text-[11px]">
                          {format(parseISO(c.fecha), "EEE d MMM", { locale: es })} {c.horaInicio}
                          {c.medicoPedidoNombre ? ` · ${c.medicoPedidoNombre}` : c.profesionalNombre ? ` · ${c.profesionalNombre}` : ''}
                        </p>
                        <p className="text-on-surface-variant/70 text-[11px]">{ORIGEN_LABEL[c.reboteEstadoOrigen ?? ''] ?? ''}</p>
                      </td>
                      <td className="px-3 py-3 align-top max-w-[220px]">
                        <p className="text-on-surface line-clamp-2">{c.reboteMotivo}</p>
                        <p className="text-[11px] text-on-surface-variant/70">
                          hace {c.diasEnEspera} día(s){c.rebotePor ? ` · ${c.rebotePor.nombre}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {c.llamadas === 0 ? (
                          <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5">Sin llamar</span>
                        ) : (
                          <>
                            <p className="font-semibold text-on-surface">{c.llamadas} llamada(s)</p>
                            {c.ultimaLlamada && (
                              <p className="text-[11px] text-on-surface-variant">
                                {RESULTADO_LLAMADA_LABEL[c.ultimaLlamada.resultado]} · {format(new Date(c.ultimaLlamada.creadoEn), 'dd/MM HH:mm')}
                              </p>
                            )}
                          </>
                        )}
                        {aunNo && (
                          <p className="text-[11px] text-sky-700 mt-0.5">Llamar desde el {format(parseISO(c.reboteLlamarDesde!), "d 'de' MMM", { locale: es })}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-right whitespace-nowrap">
                        <span className={cn('text-[11px] font-bold px-2 py-1 rounded-lg',
                          c.diasParaVencer <= 5 ? 'bg-rose-100 text-rose-700' : c.diasParaVencer <= 15 ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-800')}>
                          {c.diasParaVencer} día(s)
                        </span>
                        <p className="text-[10px] text-on-surface-variant mt-1">{format(parseISO(c.reboteVenceEl), 'dd/MM/yyyy')}</p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {abierta && (
        <Idea1DetalleCitaModal
          cita={abierta}
          onClose={() => { setAbierta(null); qc.invalidateQueries({ queryKey: ['rebote'] }); }}
        />
      )}
    </div>
  );
}
