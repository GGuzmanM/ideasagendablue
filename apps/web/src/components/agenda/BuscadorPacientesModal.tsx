import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { pacientesApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';
import { Idea1NuevoPacienteModal } from '../pacientes/Idea1NuevoPacienteModal';
import { cn } from '../../utils/cn';

interface BuscadorPacientesModalProps {
  open: boolean;
  onClose: () => void;
}

export function BuscadorPacientesModal({ open, onClose }: BuscadorPacientesModalProps) {
  const [query, setQuery] = useState('');
  const [selectedPacienteId, setSelectedPacienteId] = useState<string | null>(null);
  const [nuevoPacienteOpen, setNuevoPacienteOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const usuario = useAuthStore((s) => s.usuario);
  const perms = usuario?.permisos ?? [];

  const tienePermiso = (p: string | string[]) => {
    if (!usuario) return true;
    if (perms.length === 0) return true;
    return Array.isArray(p) ? p.some((x) => perms.includes(x)) : perms.includes(p);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        if (selectedPacienteId) {
          setSelectedPacienteId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, selectedPacienteId, onClose]);

  useEffect(() => {
    if (open && !selectedPacienteId) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open, selectedPacienteId]);

  // Búsqueda de pacientes (recientes si query está vacía, filtro si tiene texto)
  const { data: pacientes = [], isLoading: buscandoPacientes } = useQuery({
    queryKey: ['buscar-pacientes-modal', query],
    queryFn: () => pacientesApi.buscar(query),
    enabled: open && tienePermiso('pacientes.ver'),
  });

  // Detalle del paciente seleccionado (Historial de Citas)
  const { data: pacienteDetalle, isLoading: cargandoDetalle } = useQuery({
    queryKey: ['paciente-detalle-modal', selectedPacienteId],
    queryFn: () => pacientesApi.obtener(selectedPacienteId!),
    enabled: open && !!selectedPacienteId,
  });

  const getEstadoBadge = (estado: string) => {
    const est = (estado || '').toLowerCase();
    if (['completada', 'atendida', 'finalizada', 'completado'].includes(est)) {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-emerald-600"></span> Completada
        </span>
      );
    }
    if (['confirmada', 'confirmado', 'agendada'].includes(est)) {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-blue-600"></span> Confirmada
        </span>
      );
    }
    if (['pendiente', 'en_espera', 'espera'].includes(est)) {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-amber-600"></span> Pendiente
        </span>
      );
    }
    if (['no_show', 'ausente', 'no asiste'].includes(est)) {
      return (
        <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1.5 shrink-0">
          <span className="w-2 h-2 rounded-full bg-rose-600"></span> No Show
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-300 flex items-center gap-1.5 shrink-0">
        <span className="w-2 h-2 rounded-full bg-slate-500"></span> {estado}
      </span>
    );
  };

  if (!open && !nuevoPacienteOpen) return null;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-inverse-surface/40 backdrop-blur-[2px] animate-in fade-in duration-200"
          onClick={onClose}
        >
          <div
            className="bg-surface-container-lowest border border-outline-variant/60 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: ÚNICAMENTE las 2 Opciones */}
            <div className="p-3.5 bg-surface-container-low border-b border-outline-variant/30 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPacienteId(null);
                    setQuery('');
                  }}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer',
                    !selectedPacienteId
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-surface-container-lowest border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container'
                  )}
                >
                  <span className="material-symbols-outlined text-base">search</span>
                  1. Buscar Paciente & Historial
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setNuevoPacienteOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-all flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <span className="material-symbols-outlined text-base">person_add</span>
                  2. Registrar Nuevo Paciente
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl hover:bg-surface-container text-on-surface-variant transition-colors cursor-pointer"
                title="Cerrar ventana"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {/* VISTA 1: Búsqueda de Pacientes */}
            {!selectedPacienteId ? (
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* Input de Búsqueda */}
                <div className="flex items-center gap-3 px-5 py-3.5 border-b border-outline-variant/30 bg-surface-container-lowest shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">search</span>
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Escribe el nombre, DNI o teléfono del paciente..."
                    className="flex-1 text-sm outline-none text-on-surface placeholder:text-on-surface-variant/50 bg-transparent font-semibold"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="text-xs text-on-surface-variant hover:text-on-surface font-bold cursor-pointer"
                    >
                      Limpiar
                    </button>
                  )}
                </div>

                {/* Lista de Pacientes Encontrados */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 max-h-[60vh]">
                  {buscandoPacientes && (
                    <div className="px-4 py-12 text-center text-xs font-semibold text-on-surface-variant/70 italic">
                      Buscando pacientes en la base de datos…
                    </div>
                  )}

                  {!buscandoPacientes && pacientes.length === 0 && (
                    <div className="px-4 py-12 text-center text-xs font-semibold text-on-surface-variant/70">
                      No se encontró ningún paciente que coincida con "{query}".
                    </div>
                  )}

                  {!buscandoPacientes && pacientes.length > 0 && (
                    <>
                      <div className="px-3 py-1 text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">
                        {query ? `Pacientes Coincidentes (${pacientes.length})` : `Pacientes Recientes (${pacientes.length})`}
                      </div>

                      {pacientes.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPacienteId(p.id)}
                          className="w-full flex items-center justify-between p-3.5 rounded-2xl text-left bg-surface-container-lowest border border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container-low transition-all cursor-pointer shadow-2xs group"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-[#0044ab] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                              {p.nombres?.[0]?.toUpperCase()}{p.apellidoPaterno?.[0]?.toUpperCase()}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors truncate">
                                {p.nombreCompleto || `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`}
                              </span>
                              <span className="text-[11px] text-on-surface-variant/70 font-mono truncate">
                                {p.tipoDocumento || 'DNI'}: {p.numeroDocumento} · Tel: {p.telefono}
                              </span>
                            </div>
                          </div>

                          <span className="text-xs font-bold text-primary bg-primary/10 group-hover:bg-primary group-hover:text-white px-3 py-1.5 rounded-xl shrink-0 flex items-center gap-1.5 transition-colors">
                            <span className="material-symbols-outlined text-sm">history</span>
                            Ver Historial de Citas
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* VISTA 2: Historial de Citas del Paciente Seleccionado */
              <div className="flex flex-col flex-1 max-h-[75vh] overflow-hidden">
                {/* Cabeza del Paciente */}
                <div className="p-4 bg-surface-container-low border-b border-outline-variant/30 flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedPacienteId(null)}
                      className="p-2 rounded-xl bg-surface-container-lowest border border-outline-variant/50 hover:bg-surface-container text-on-surface-variant transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                      title="Volver a la lista de pacientes"
                    >
                      <span className="material-symbols-outlined text-base">arrow_back</span>
                      Volver
                    </button>
                    <div>
                      <h3 className="text-sm font-bold text-on-surface">
                        {pacienteDetalle?.nombres} {pacienteDetalle?.apellidoPaterno} {pacienteDetalle?.apellidoMaterno}
                      </h3>
                      <p className="text-[11px] text-on-surface-variant/80 font-mono">
                        {pacienteDetalle?.tipoDocumento} {pacienteDetalle?.numeroDocumento} · Tel: {pacienteDetalle?.telefono}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigate(`/pacientes/${selectedPacienteId}`);
                        onClose();
                      }}
                      className="px-3.5 py-1.5 bg-surface-container-lowest border border-outline-variant/60 text-on-surface text-xs font-bold rounded-xl hover:bg-surface-container transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    >
                      <span className="material-symbols-outlined text-sm">visibility</span>
                      Ver Ficha Completa
                    </button>
                  </div>
                </div>

                {/* Historial de Citas Agendadas */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                  {cargandoDetalle ? (
                    <div className="p-12 text-center text-xs font-semibold text-on-surface-variant/70 italic">
                      Cargando historial de citas agendadas…
                    </div>
                  ) : !pacienteDetalle ? (
                    <div className="p-8 text-center text-xs font-semibold text-on-surface-variant/70">
                      No se pudo obtener la información del paciente.
                    </div>
                  ) : (
                    <>
                      {/* Resumen numérico */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 bg-surface-container-low/60 border border-outline-variant/30 rounded-xl">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase block">Total Citas</span>
                          <span className="text-base font-bold font-mono text-on-surface">
                            {pacienteDetalle.totalCitas || pacienteDetalle.historial?.length || 0}
                          </span>
                        </div>
                        <div className="p-3 bg-surface-container-low/60 border border-outline-variant/30 rounded-xl">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase block">Próximas Citas</span>
                          <span className="text-base font-bold font-mono text-primary">
                            {pacienteDetalle.proximas?.length || 0}
                          </span>
                        </div>
                        <div className="p-3 bg-surface-container-low/60 border border-outline-variant/30 rounded-xl">
                          <span className="text-[10px] font-bold text-on-surface-variant uppercase block">Historial Registrado</span>
                          <span className="text-base font-bold font-mono text-emerald-700">
                            {pacienteDetalle.historial?.length || 0}
                          </span>
                        </div>
                      </div>

                      {/* Lista de Próximas Citas */}
                      {pacienteDetalle.proximas && pacienteDetalle.proximas.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm">event</span>
                            Próximas Citas Programadas
                          </h4>
                          <div className="space-y-2">
                            {pacienteDetalle.proximas.map((c) => (
                              <div key={c.id} className="p-3.5 bg-primary/5 border border-primary/20 rounded-xl flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold text-on-surface font-mono">
                                    {format(parseISO(c.fecha), "EEEE d 'de' MMMM yyyy", { locale: es })} · {c.horaInicio}
                                  </p>
                                  <p className="text-xs text-on-surface-variant mt-0.5">
                                    {c.servicio.nombre} {c.profesional ? `· ${c.profesional.nombres}` : ''} · Sede: {c.sede.nombre}
                                  </p>
                                </div>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300">
                                  Programada
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Lista de Historial de Citas */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-sm">history</span>
                          Historial de Citas Agendadas ({pacienteDetalle.historial?.length || 0})
                        </h4>

                        {!pacienteDetalle.historial || pacienteDetalle.historial.length === 0 ? (
                          <div className="p-6 text-center text-xs text-on-surface-variant/70 bg-surface-container-low rounded-xl">
                            El paciente aún no cuenta con historial de citas registradas.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {pacienteDetalle.historial.map((c) => (
                              <div
                                key={c.id}
                                className="p-3.5 bg-surface-container-lowest border border-outline-variant/40 rounded-xl flex items-center justify-between gap-3 shadow-2xs hover:border-primary/40 transition-colors"
                              >
                                <div className="space-y-0.5">
                                  <p className="text-xs font-bold text-on-surface font-mono">
                                    {format(parseISO(c.fecha), "EEEE d 'de' MMMM yyyy", { locale: es })} · {c.horaInicio}
                                  </p>
                                  <p className="text-xs font-semibold text-on-surface-variant">
                                    {c.servicio.nombre} {c.profesional ? `· Prof. ${c.profesional.nombres} ${c.profesional.apellidos}` : ''}
                                  </p>
                                  <p className="text-[11px] text-on-surface-variant/70">
                                    Sede: <strong className="text-on-surface">{c.sede.nombre}</strong>
                                    {c.duracionMinutos ? ` · Duración: ${c.duracionMinutos} min` : ''}
                                  </p>
                                </div>

                                {getEstadoBadge(c.estado)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Crear Nuevo Paciente */}
      {nuevoPacienteOpen && (
        <Idea1NuevoPacienteModal
          onClose={() => setNuevoPacienteOpen(false)}
          onCreated={(p) => {
            setNuevoPacienteOpen(false);
            navigate(`/pacientes/${p.id}`);
          }}
        />
      )}
    </>
  );
}
