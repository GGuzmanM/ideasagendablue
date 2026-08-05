import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { baroSolicitudApi, type ProfBaro } from '../../api/baroSolicitud';

const TIPO_LABEL: Record<string, string> = { medico: 'Médico', podologa: 'Podóloga', fisioterapeuta: 'Fisioterapeuta' };

interface Props {
  onClose: () => void;
  puedeGestionar: boolean;
  sedeId: string;
  sedeNombre?: string;
  hora?: string;
  ocupados?: Map<string, { unidad: string; hora: string }>;
}

/**
 * Gestión del roster de baropodometría "por solicitud" POR SEDE (agregar/quitar médicos) en
 * un modal, sin salir del formulario de Nueva Cita. Solo ofrece profesionales que trabajan en
 * la sede actual, y avisa si el médico ya está ocupado a la hora elegida.
 */
export function BaroSolicitudModal({ onClose, puedeGestionar, sedeId, sedeNombre, hora, ocupados }: Props) {
  const qc = useQueryClient();
  const [aAgregar, setAAgregar] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['baro-solicitud', sedeId],
    queryFn: () => baroSolicitudApi.obtener(sedeId),
    enabled: Boolean(sedeId),
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['baro-solicitud'] });
    qc.invalidateQueries({ queryKey: ['ocupacion-dia'] });
  };
  const agregarMut = useMutation({
    mutationFn: (id: string) => baroSolicitudApi.agregar(id, sedeId),
    onSuccess: () => { invalidar(); setAAgregar(''); toast.success('Médico agregado a baro en esta sede'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: (id: string) => baroSolicitudApi.quitar(id, sedeId),
    onSuccess: () => { invalidar(); toast.success('Quitado de baro en esta sede'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Chip de disponibilidad de un médico a la hora seleccionada.
  const estado = (id: string) => {
    const ocup = ocupados?.get(id);
    if (ocup) return <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">Ocupado {ocup.hora}</span>;
    if (hora) return <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Libre {hora}</span>;
    return null;
  };

  return (
    <div
      className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[110] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-surface-container-lowest w-full max-w-[480px] max-h-[85vh] rounded-2xl flex flex-col overflow-hidden custom-shadow border border-outline-variant/30 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#0044ab] px-5 py-4 flex items-center gap-3 shrink-0">
          <span className="material-symbols-outlined text-white/90" style={{ fontVariationSettings: "'FILL' 1" }}>monitor_heart</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base leading-tight">Médicos de baropodometría</h2>
            <p className="text-white/70 text-xs">{sedeNombre ? `Sede ${sedeNombre} · ` : ''}Atienden solo cuando el paciente los solicita</p>
          </div>
          <button onClick={onClose} className="material-symbols-outlined text-white/80 hover:text-white p-1 rounded-full transition">close</button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 text-xs text-on-surface-variant leading-relaxed">
            Solo se listan profesionales que <b>trabajan en esta sede</b>. Al agregarlos, quedan habilitados para atender
            baropodometría <b>en esta sede</b> (por solicitud). La máquina la asigna el sistema; ellos ocupan su tiempo también en su columna.
          </div>

          {/* Agregar */}
          {puedeGestionar && (
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider mb-1.5">Agregar médico (de esta sede)</p>
              <div className="flex gap-2">
                <select
                  data-testid="baro-modal-agregar-select"
                  className="flex-1 bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  value={aAgregar}
                  onChange={(e) => setAAgregar(e.target.value)}
                >
                  <option value="">Selecciona un profesional…</option>
                  {(data?.disponibles ?? []).map((p: ProfBaro) => (
                    <option key={p.id} value={p.id}>{p.nombre} · {TIPO_LABEL[p.tipo] ?? p.tipo}</option>
                  ))}
                </select>
                <button
                  data-testid="baro-modal-agregar-btn"
                  onClick={() => aAgregar && agregarMut.mutate(aAgregar)}
                  disabled={!aAgregar || agregarMut.isPending}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#0044ab] hover:bg-[#003a91] disabled:opacity-40 transition-colors shrink-0"
                >Agregar</button>
              </div>
              {aAgregar && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span className="text-on-surface-variant/70">A la hora de la cita:</span>
                  {estado(aAgregar) ?? <span className="text-on-surface-variant/50">elige una hora en la cita</span>}
                </div>
              )}
            </div>
          )}

          {/* Lista */}
          <div className="space-y-2">
            <p className="font-label-caps text-label-caps text-on-surface-variant/70 uppercase tracking-wider">
              En esta sede {data && <span className="text-on-surface-variant/50">· {data.porSolicitud.length}</span>}
            </p>
            {isLoading ? (
              <div className="flex justify-center py-6"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : (data?.porSolicitud.length ?? 0) === 0 ? (
              <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-5 text-center text-on-surface-variant/60 text-sm">
                Ningún médico atiende baro en esta sede todavía.
              </div>
            ) : (
              data!.porSolicitud.map((p) => (
                <div key={p.id} className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                    {p.nombre.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {p.nombre}
                      {p.activo === false && <span className="ml-2 text-[10px] font-normal text-on-surface-variant/50">(inactivo)</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-on-surface-variant/60">{TIPO_LABEL[p.tipo] ?? p.tipo}</span>
                      {estado(p.id)}
                    </div>
                  </div>
                  {puedeGestionar && (
                    <button
                      onClick={() => quitarMut.mutate(p.id)}
                      disabled={quitarMut.isPending}
                      className="text-xs font-semibold text-on-surface-variant/70 hover:text-error px-3 py-1.5 rounded-lg hover:bg-error/10 transition-colors shrink-0 disabled:opacity-50"
                      title="Quitar de baro en esta sede"
                    >Quitar</button>
                  )}
                </div>
              ))
            )}
            {!puedeGestionar && (
              <p className="text-[11px] text-on-surface-variant/50 pt-1">Solo la Coordinadora de Sedes y el administrador pueden modificar esta lista.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
