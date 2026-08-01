import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi } from '../api';
import { DIAS_ABREV, DIAS_FULL, useHorarioSede, useFormExcepcion, HORAS_SLOT, PRESETS_CIERRE, proximasFechas } from '../services/horarioSedeService';
import { usePermisosData, tipoLabel, hoyISO } from '../services/permisosService';
import { PermisosPage } from './herramientas/PermisosPage';
import { AlmuerzosPage } from './herramientas/AlmuerzosPage';
import { HorariosPage } from './herramientas/HorariosPage';
import { useAuthStore } from '../stores/authStore';
import { cn } from '../utils/cn';

export function HorariosRestriccionesPage() {
  const puedeGestionarPersonal = useAuthStore((s) => s.isCoordinadora());

  const { data: sedes = [] } = useQuery({
    queryKey: ['sedes'],
    queryFn: () => sedesApi.listar(),
  });

  const [sedeId, setSedeId] = useState<string>('');

  // Auto-seleccionar primera sede
  const sedeActiva = sedes.find((s) => s.id === (sedeId || sedes[0]?.id)) || sedes[0];
  const activeSedeId = sedeActiva?.id || '';

  const [activeTab, setActiveTab] = useState<'base' | 'excepciones' | 'almuerzos' | 'permisos' | 'personal_general'>('base');

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-surface-container-lowest/50">
      {/* Header Superior del Módulo */}
      <header className="px-6 py-5 bg-surface-container-lowest border-b border-outline-variant/30 sticky top-0 z-20 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#0044ab]/10 text-[#0044ab] flex items-center justify-center font-bold shrink-0">
            <span className="material-symbols-outlined text-2xl">schedule</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-headline-md text-xl font-bold text-on-surface tracking-tight">
                Horarios y Restricciones
              </h1>
              <span className="bg-[#0044ab]/10 text-[#0044ab] text-xs px-2.5 py-0.5 rounded-full font-bold">
                Módulo Sede
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Gestión de horarios de apertura, turnos base, excepciones, almuerzos y horarios del personal.
            </p>
          </div>
        </div>

        {/* Selector de Sede */}
        <div className="flex items-center gap-3">
          {activeTab === 'personal_general' ? (
            <div className="flex items-center gap-2 px-3.5 py-2 bg-teal-50 border border-teal-200 rounded-xl text-teal-800 text-xs font-bold shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
              <span>General (Todas las Sedes)</span>
            </div>
          ) : (
            <>
              <label className="text-xs font-bold text-on-surface-variant flex items-center gap-1 shrink-0">
                <span className="material-symbols-outlined text-base">location_on</span>
                SEDE:
              </label>
              <div className="relative min-w-[200px]">
                <select
                  value={activeSedeId}
                  onChange={(e) => setSedeId(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant/50 rounded-xl px-3.5 py-2 text-xs font-bold text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all appearance-none cursor-pointer"
                >
                  {sedes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant text-base">
                  expand_more
                </span>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Tabs Navigation */}
      <div className="px-6 bg-surface-container-lowest border-b border-outline-variant/20 flex gap-2 shrink-0 overflow-x-auto">
        <button
          onClick={() => setActiveTab('base')}
          className={cn(
            'flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'base'
              ? 'border-[#0044ab] text-[#0044ab] bg-primary/5'
              : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
          )}
        >
          <span className="material-symbols-outlined text-base">calendar_view_week</span>
          Horario Semanal Base
        </button>

        <button
          onClick={() => setActiveTab('excepciones')}
          className={cn(
            'flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'excepciones'
              ? 'border-[#0044ab] text-[#0044ab] bg-primary/5'
              : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
          )}
        >
          <span className="material-symbols-outlined text-base">event_repeat</span>
          Excepciones de la Sede
        </button>

        <button
          onClick={() => setActiveTab('almuerzos')}
          className={cn(
            'flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'almuerzos'
              ? 'border-[#0044ab] text-[#0044ab] bg-primary/5'
              : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
          )}
        >
          <span className="material-symbols-outlined text-base">restaurant</span>
          Horarios de Almuerzo
        </button>

        <button
          onClick={() => setActiveTab('permisos')}
          className={cn(
            'flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap',
            activeTab === 'permisos'
              ? 'border-[#0044ab] text-[#0044ab] bg-primary/5'
              : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
          )}
        >
          <span className="material-symbols-outlined text-base">block</span>
          Restricciones y Ausencias (Personal)
        </button>

        {puedeGestionarPersonal && (
          <button
            onClick={() => setActiveTab('personal_general')}
            className={cn(
              'flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap',
              activeTab === 'personal_general'
                ? 'border-teal-600 text-teal-700 bg-teal-50/50'
                : 'border-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low/50'
            )}
          >
            <span className="material-symbols-outlined text-base">badge</span>
            Horarios del Personal (General)
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {activeTab === 'personal_general' ? (
          <HorariosPage hideHeader={true} />
        ) : activeSedeId ? (
          <>
            {activeTab === 'base' && (
              <TabHorarioBase sedeId={activeSedeId} sedeName={sedeActiva?.nombre || ''} />
            )}

            {activeTab === 'excepciones' && (
              <TabExcepciones sedeId={activeSedeId} sedeName={sedeActiva?.nombre || ''} />
            )}

            {activeTab === 'almuerzos' && (
              <AlmuerzosPage hideHeader={true} hideSedeTabs={true} sedeId={activeSedeId} />
            )}

            {activeTab === 'permisos' && (
              <PermisosPage hideHeader={true} hideSedeTabs={true} sedeId={activeSedeId} />
            )}
          </>
        ) : (
          <div className="p-8 text-center text-on-surface-variant text-sm font-medium">
            Cargando sedes...
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 1: Horario Semanal Base ────────────────────────────────────────────────
function TabHorarioBase({ sedeId, sedeName }: { sedeId: string; sedeName: string }) {
  const { horarioDefault, horarioEfectivo } = useHorarioSede(sedeId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              Horario Base Recurrente · <span className="text-[#0044ab]">{sedeName}</span>
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Configuración por defecto de atención semanal. Los cambios a fechas puntuales se aplican en la pestaña de Excepciones.
            </p>
          </div>
          {horarioEfectivo && (
            <div className="px-3.5 py-1.5 rounded-xl border border-outline-variant/40 bg-surface-container-low flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', horarioEfectivo.abierto ? 'bg-green-500' : 'bg-red-500')} />
              <span className="text-xs font-bold text-on-surface font-mono">
                Hoy: {horarioEfectivo.abierto ? `${horarioEfectivo.apertura} – ${horarioEfectivo.cierre}` : 'Cerrado'}
              </span>
            </div>
          )}
        </div>

        <div className="border border-outline-variant/40 rounded-2xl overflow-hidden bg-white">
          {DIAS_ABREV.map((dia, i) => {
            const turno = horarioDefault[String(i)];
            const abierto = turno?.abierto !== false;
            const isToday = new Date().getDay() === i;

            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-4 px-5 py-4 border-b border-outline-variant/20 last:border-b-0 transition-colors',
                  isToday ? 'bg-primary/5 font-medium' : 'hover:bg-surface-container-low/30'
                )}
              >
                <div className="w-10 flex items-center justify-center">
                  <span
                    className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold',
                      isToday ? 'bg-[#0044ab] text-white shadow-sm' : 'bg-surface-container-high text-on-surface-variant'
                    )}
                  >
                    {dia}
                  </span>
                </div>

                <div className="w-32">
                  <p className="text-sm font-bold text-on-surface">{DIAS_FULL[i]}</p>
                  {isToday && (
                    <span className="text-[10px] font-bold text-[#0044ab] uppercase tracking-wider">Hoy</span>
                  )}
                </div>

                <div className="flex-1 flex items-center gap-3">
                  {abierto && turno && 'apertura' in turno ? (
                    <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-800 border border-green-200 rounded-lg text-xs font-mono font-bold">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-600" />
                      <span>{turno.apertura}</span>
                      <span className="text-green-400">→</span>
                      <span>{turno.cierre}</span>
                    </div>
                  ) : (
                    <span className="px-3 py-1 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-bold italic">
                      Cerrado
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Excepciones de la Sede ─────────────────────────────────────────────
function TabExcepciones({ sedeId, sedeName }: { sedeId: string; sedeName: string }) {
  const { excepciones, guardarExcepcion, eliminarExcepcion, isGuardando, isEliminando } = useHorarioSede(sedeId);
  const form = useFormExcepcion();

  const handleGuardar = () => {
    if (form.rangoInvalido) return;
    guardarExcepcion(form.toPayload(), {
      onSuccess: () => form.reset(),
    } as never);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-xs space-y-6">
        <div>
          <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
            Nueva Excepción de Horario · <span className="text-[#0044ab]">{sedeName}</span>
          </h2>
          <p className="text-xs text-on-surface-variant mt-1">
            Sobrescribe el horario base de la sede para una fecha específica (feriado cerrado, jornada reducida, horario extendido).
          </p>
        </div>

        {/* Formulario */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-surface-container-low/40 p-4 rounded-xl border border-outline-variant/20">
          <div>
            <label className="text-xs font-bold text-on-surface-variant block mb-1">FECHA *</label>
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => form.setFecha(e.target.value)}
              className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-xs font-mono font-bold text-on-surface outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-on-surface-variant block mb-1">ESTADO *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => form.setAbierto(true)}
                className={cn(
                  'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer',
                  form.abierto
                    ? 'bg-green-600 text-white border-green-600 shadow-xs'
                    : 'bg-white text-on-surface border-outline-variant hover:bg-green-50'
                )}
              >
                Abierto
              </button>
              <button
                type="button"
                onClick={() => form.setAbierto(false)}
                className={cn(
                  'flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all border cursor-pointer',
                  !form.abierto
                    ? 'bg-red-600 text-white border-red-600 shadow-xs'
                    : 'bg-white text-on-surface border-outline-variant hover:bg-red-50'
                )}
              >
                Cerrado
              </button>
            </div>
          </div>

          {form.abierto && (
            <>
              <div>
                <label className="text-xs font-bold text-on-surface-variant block mb-1">HORA APERTURA</label>
                <select
                  value={form.apertura}
                  onChange={(e) => form.setApertura(e.target.value)}
                  className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-xs font-mono text-on-surface outline-none"
                >
                  {HORAS_SLOT.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-on-surface-variant block mb-1">HORA CIERRE</label>
                <select
                  value={form.cierre}
                  onChange={(e) => form.setCierre(e.target.value)}
                  className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-xs font-mono text-on-surface outline-none"
                >
                  {HORAS_SLOT.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="md:col-span-2">
            <label className="text-xs font-bold text-on-surface-variant block mb-1">MOTIVO / NOTA</label>
            <input
              type="text"
              value={form.nota}
              onChange={(e) => form.setNota(e.target.value)}
              placeholder="Ej: Feriado Fiestas Patrias, Capacitación interna..."
              className="w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-xs text-on-surface outline-none"
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="button"
              onClick={handleGuardar}
              disabled={isGuardando || form.rangoInvalido}
              className="px-5 py-2 bg-[#0044ab] text-white rounded-xl text-xs font-bold hover:bg-[#003380] transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {isGuardando ? 'Guardando...' : 'Guardar Excepción'}
            </button>
          </div>
        </div>

        {/* Lista de Excepciones Registradas */}
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
            Excepciones Vigentes / Futuras ({excepciones.length})
          </h3>

          {excepciones.length === 0 ? (
            <p className="text-xs text-on-surface-variant/70 italic p-4 bg-surface-container-low rounded-xl text-center">
              No hay excepciones registradas. La sede funciona según su horario base.
            </p>
          ) : (
            <div className="space-y-2">
              {excepciones.map((exc) => (
                <div
                  key={exc.fecha}
                  className="p-3.5 bg-white border border-outline-variant/30 rounded-xl flex items-center justify-between gap-3 shadow-2xs"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'w-2.5 h-2.5 rounded-full shrink-0',
                        exc.abierto ? 'bg-green-500' : 'bg-red-500'
                      )}
                    />
                    <div>
                      <p className="text-xs font-bold text-on-surface font-mono">
                        {exc.fecha}
                      </p>
                      <p className="text-xs font-semibold text-on-surface-variant">
                        {exc.abierto ? `Atención: ${exc.horaApertura} – ${exc.horaCierre}` : 'CERRADO TODO EL DÍA'}
                        {exc.nota && <span className="text-on-surface-variant/70"> · {exc.nota}</span>}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => eliminarExcepcion(exc.fecha)}
                    disabled={isEliminando}
                    className="text-xs text-red-600 font-bold hover:bg-red-50 px-2.5 py-1 rounded-lg border border-red-200 transition-colors cursor-pointer"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
