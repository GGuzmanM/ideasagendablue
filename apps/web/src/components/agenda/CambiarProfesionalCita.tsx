import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { citasApi, type CitaResumen, type DestinoProfesional } from '../../api/citas';
import { invalidarAgenda } from '../../services/idea1DetalleCitaService';
import { cn } from '../../utils/cn';

/**
 * Lápiz junto a «Profesional» del detalle de la cita (30-oct-2026): pasar la cita a OTRA profesional o columna «Adicional» en
 * el MISMO día y hora. Si esa persona está libre es un MOVER; si tiene otra cita justo ahí se ofrece INTERCAMBIAR (las dos citas
 * cambian de profesional, y se dice con todas sus letras). Cambiar el día u hora sigue siendo «Reprogramar cita».
 * El servidor ya sabe qué cabe y qué no (GET /citas/:id/destinos-profesional usa las mismas reglas que mover/intercambiar) y
 * las vuelve a validar al guardar; aquí solo se muestra el resultado y el motivo de lo que no se puede.
 */
export function CambiarProfesionalCita({ cita, onCerrar }: { cita: CitaResumen; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [elegida, setElegida] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['destinos-profesional', cita.id, cita.fecha?.slice(0, 10), cita.horaInicio, cita.profesionalId],
    queryFn: () => citasApi.destinosProfesional(cita.id),
    staleTime: 0,
    gcTime: 0,
  });

  const refrescar = () => {
    invalidarAgenda(qc);
    qc.invalidateQueries({ queryKey: ['cita-detalle', cita.id] });
    qc.invalidateQueries({ queryKey: ['destinos-profesional'] });
  };

  const moverMut = useMutation({
    mutationFn: (destinoId: string) => {
      const datos = {
        profesionalId: destinoId, fecha: cita.fecha.slice(0, 10), horaInicio: cita.horaInicio,
        // Ya no es «la que eligió el paciente» (igual que al intercambiar).
        ...(cita.origenAsignacion === 'elegida_por_paciente' ? { origenAsignacion: 'asignada_automaticamente' } : {}),
      };
      return cita.slotGrupoId && data?.esBloque ? citasApi.moverGrupo(cita.slotGrupoId, datos) : citasApi.mover(cita.id, datos);
    },
    onSuccess: () => { refrescar(); toast.success('Cita pasada a otra profesional'); onCerrar(); },
    onError: (e: Error) => { toast.error(e.message); refrescar(); },
  });
  const intercambiarMut = useMutation({
    mutationFn: (otraCitaId: string) => citasApi.intercambiar(cita.id, otraCitaId),
    onSuccess: () => { refrescar(); toast.success('Citas intercambiadas'); onCerrar(); },
    onError: (e: Error) => { toast.error(e.message); refrescar(); },
  });
  const guardando = moverMut.isPending || intercambiarMut.isPending;

  const destino = data?.destinos.find((d) => d.id === elegida) ?? null;
  const fechaTxt = data ? format(new Date(`${data.fecha}T12:00:00`), "EEE d 'de' MMM", { locale: es }) : '';

  const seleccionable = (d: DestinoProfesional) => d.estado === 'libre' || (d.estado === 'ocupado' && !!d.intercambio?.posible);

  return (
    <div className="p-3 bg-primary/5 rounded-2xl border border-primary/20 space-y-2 animate-in fade-in duration-200" data-testid="cambiar-profesional">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-label-caps text-label-caps text-primary font-bold uppercase tracking-wider">Cambiar de profesional</p>
          {data && <p className="text-xxs text-on-surface-variant mt-0.5">{fechaTxt} · {data.horaInicio} · misma fecha y hora. Para cambiar el día o la hora usa «Reprogramar cita».</p>}
        </div>
        <button onClick={onCerrar} aria-label="Cerrar" className="text-on-surface-variant hover:text-on-surface cursor-pointer">
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      {isLoading && <p className="text-xs text-on-surface-variant">Revisando quién está libre…</p>}
      {isError && <p className="text-xs text-error">{(error as Error).message}</p>}
      {data && !data.movible && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{data.motivo}</p>}
      {data?.movible && data.esBloque && (
        <p className="text-xxs text-on-surface-variant bg-surface-container rounded-lg px-2.5 py-1.5">Es una cita doble (dos servicios): se pasa el bloque completo.</p>
      )}

      {data?.movible && (
        <div className="grid gap-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
          {data.destinos.length === 0 && <p className="text-xs text-on-surface-variant">No hay otras profesionales en esta sede ese día.</p>}
          {data.destinos.map((d) => {
            const ok = seleccionable(d);
            const sel = elegida === d.id;
            return (
              <button
                key={d.id} type="button" disabled={!ok || guardando}
                onClick={() => setElegida(sel ? null : d.id)}
                data-testid="destino-profesional" data-estado={d.estado}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition-all',
                  sel ? 'bg-primary text-white border-primary shadow-xs'
                    : ok ? 'bg-surface-container-lowest border-outline-variant/30 hover:border-primary cursor-pointer'
                    : 'bg-surface-container/60 border-transparent opacity-70 cursor-not-allowed',
                )}
              >
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0 font-mono text-[9px] font-bold" style={{ backgroundColor: d.colorAvatar || '#0044ab' }}>
                  {d.nombres[0]}{d.apellidos[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <span className="truncate">{d.nombre}</span>
                    {d.adicional && <span className={cn('text-[9px] font-bold px-1 rounded', sel ? 'bg-white/25' : 'bg-amber-100 text-amber-800')}>ADICIONAL</span>}
                  </span>
                  {d.estado === 'no_disponible' && <span className="block text-[11px] leading-tight">{d.motivo}</span>}
                  {d.estado === 'ocupado' && (
                    <span className="block text-[11px] leading-tight">
                      {d.ocupante ? `Tiene a ${d.ocupante.paciente} (${d.ocupante.horaInicio} · ${d.ocupante.duracionMinutos} min)` : d.motivo}
                      {!d.intercambio?.posible && d.intercambio?.motivo ? ` — ${d.intercambio.motivo}` : ''}
                    </span>
                  )}
                </span>
                <span className={cn('shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                  d.estado === 'libre' ? (sel ? 'bg-white/25' : 'bg-emerald-100 text-emerald-800')
                    : d.estado === 'ocupado' ? (sel ? 'bg-white/25' : 'bg-amber-100 text-amber-800')
                    : 'bg-surface-container-high text-on-surface-variant')}>
                  {d.estado === 'libre' ? 'LIBRE' : d.estado === 'ocupado' ? (d.intercambio?.posible ? 'INTERCAMBIAR' : 'OCUPADA') : 'NO DISPONIBLE'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {destino && data && (
        <div className="rounded-xl border border-primary/30 bg-surface-container-lowest p-2.5 space-y-2" data-testid="confirmar-cambio-profesional">
          {destino.estado === 'libre' ? (
            <p className="text-xs text-on-surface">
              Pasar esta cita de <b>{data.actual?.nombre}</b> a <b>{destino.nombre}</b> ({data.horaInicio}).
            </p>
          ) : (
            <div className="text-xs text-on-surface space-y-1">
              <p><span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 mr-1.5">INTERCAMBIO</span>
                Las dos citas cambian de profesional a las {data.horaInicio}:</p>
              <p>• Esta cita pasa de <b>{data.actual?.nombre}</b> a <b>{destino.nombre}</b>.</p>
              <p>• La de <b>{destino.ocupante?.paciente}</b> pasa de <b>{destino.nombre}</b> a <b>{data.actual?.nombre}</b>.</p>
            </div>
          )}
          {destino.avisos.map((a, i) => (
            <p key={i} className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{a}</p>
          ))}
          <div className="flex gap-2">
            <button
              disabled={guardando}
              onClick={() => (destino.estado === 'libre' ? moverMut.mutate(destino.id) : intercambiarMut.mutate(destino.ocupante!.citaId))}
              data-testid="confirmar-profesional"
              className="flex-1 bg-primary text-white py-1.5 rounded-xl text-xs font-bold hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {guardando ? 'Guardando…' : destino.estado === 'libre' ? `Pasar a ${destino.nombre}` : 'Confirmar intercambio'}
            </button>
            <button onClick={() => setElegida(null)} disabled={guardando} className="px-3 py-1.5 bg-surface-container border border-outline-variant/30 rounded-xl text-xs font-bold cursor-pointer">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
