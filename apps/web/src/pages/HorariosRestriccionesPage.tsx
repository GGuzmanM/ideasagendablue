import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi, profesionalesApi, type PodologaDiaEspecial, type HorarioSede } from '../api';
import { DIAS_ABREV, DIAS_FULL, useHorarioSede, useFormExcepcion, HORAS_SLOT, PRESETS_CIERRE, proximasFechas } from '../services/horarioSedeService';
import { usePermisosData, tipoLabel, hoyISO } from '../services/permisosService';
import { PermisosPage } from './herramientas/PermisosPage';
import { AlmuerzosPage } from './herramientas/AlmuerzosPage';
import { HorariosPage } from './herramientas/HorariosPage';
import { useAuthStore } from '../stores/authStore';
import { cn } from '../utils/cn';

export function HorariosRestriccionesPage() {
  const puedeGestionarPersonal = useAuthStore((s) => s.tiene('horarios.editar'));

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

        {/* Selector de Sede — aplica a TODAS las pestañas, incluida Horarios del Personal
            (así el turno base del personal se edita por la sede seleccionada). */}
        <div className="flex items-center gap-3">
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
          <HorariosPage hideHeader={true} sedeId={activeSedeId} sedeNombre={sedeActiva?.nombre} />
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
// Estado editable de un día del horario base.
type DiaHorarioEstado = { abierto: boolean; apertura: string; cierre: string };

function estadoDesdeHorario(hd: Record<string, { abierto?: boolean; apertura?: string; cierre?: string } | undefined>): Record<number, DiaHorarioEstado> {
  const m: Record<number, DiaHorarioEstado> = {};
  for (let i = 0; i < 7; i++) {
    const t = hd[String(i)];
    if (t && t.abierto !== false && t.apertura && t.cierre) m[i] = { abierto: true, apertura: t.apertura, cierre: t.cierre };
    else m[i] = { abierto: false, apertura: '09:00', cierre: '18:00' };
  }
  return m;
}

function horarioDesdeEstado(est: Record<number, DiaHorarioEstado>): HorarioSede {
  const h: HorarioSede = {};
  for (let i = 0; i < 7; i++) {
    const d = est[i];
    h[String(i)] = d.abierto ? { abierto: true, apertura: d.apertura, cierre: d.cierre } : { abierto: false };
  }
  return h;
}

function TabHorarioBase({ sedeId, sedeName }: { sedeId: string; sedeName: string }) {
  const { horarioDefault, horarioEfectivo, guardarBase, isGuardandoBase } = useHorarioSede(sedeId);
  const puedeEditar = useAuthStore((s) => s.tiene('horarios.editar'));

  // Firma del horario del server → re-inicializa el estado editable al cambiar de sede o al llegar
  // datos frescos (tras guardar). Durante la edición no cambia, así no pisa lo que estás editando.
  const sig = useMemo(() => JSON.stringify(horarioDefault), [horarioDefault]);
  const [estado, setEstado] = useState<Record<number, DiaHorarioEstado>>(() => estadoDesdeHorario(horarioDefault));
  useEffect(() => { setEstado(estadoDesdeHorario(horarioDefault)); }, [sedeId, sig]);

  const originalJson = useMemo(() => JSON.stringify(horarioDesdeEstado(estadoDesdeHorario(horarioDefault))), [sig]);
  const actualJson = JSON.stringify(horarioDesdeEstado(estado));
  const dirty = actualJson !== originalJson;
  const invalido = Object.values(estado).some((d) => d.abierto && d.apertura >= d.cierre);

  const set = (i: number, patch: Partial<DiaHorarioEstado>) =>
    setEstado((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }));

  const guardar = () => {
    if (!dirty || invalido || !puedeEditar) return;
    guardarBase(horarioDesdeEstado(estado));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              Horario Base Recurrente · <span className="text-[#0044ab]">{sedeName}</span>
            </h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Define la apertura/cierre por día — es la franja <strong>reservable</strong> de la sede. Los cambios a fechas puntuales van en la pestaña de Excepciones.
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
            const d = estado[i] ?? { abierto: false, apertura: '09:00', cierre: '18:00' };
            const isToday = new Date().getDay() === i;
            const rangoMal = d.abierto && d.apertura >= d.cierre;

            return (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-4 px-5 py-3.5 border-b border-outline-variant/20 last:border-b-0 transition-colors',
                  isToday ? 'bg-primary/5' : 'hover:bg-surface-container-low/30'
                )}
              >
                <div className="w-10 flex items-center justify-center shrink-0">
                  <span
                    className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold',
                      isToday ? 'bg-[#0044ab] text-white shadow-sm' : 'bg-surface-container-high text-on-surface-variant'
                    )}
                  >
                    {dia}
                  </span>
                </div>

                <div className="w-28 shrink-0">
                  <p className="text-sm font-bold text-on-surface">{DIAS_FULL[i]}</p>
                  {isToday && (
                    <span className="text-[10px] font-bold text-[#0044ab] uppercase tracking-wider">Hoy</span>
                  )}
                </div>

                {/* Toggle Abierto / Cerrado */}
                <div className="flex bg-surface-container-high rounded-lg p-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={!puedeEditar}
                    onClick={() => set(i, { abierto: true })}
                    className={cn('px-2.5 py-1 text-[11px] font-bold rounded-md transition-all',
                      d.abierto ? 'bg-green-600 text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface',
                      !puedeEditar && 'opacity-60 cursor-not-allowed')}
                  >
                    Abierto
                  </button>
                  <button
                    type="button"
                    disabled={!puedeEditar}
                    onClick={() => set(i, { abierto: false })}
                    className={cn('px-2.5 py-1 text-[11px] font-bold rounded-md transition-all',
                      !d.abierto ? 'bg-red-500 text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface',
                      !puedeEditar && 'opacity-60 cursor-not-allowed')}
                  >
                    Cerrado
                  </button>
                </div>

                {/* Horas (solo si está abierto) */}
                <div className="flex-1 flex items-center gap-2">
                  {d.abierto ? (
                    <>
                      <select
                        value={d.apertura}
                        disabled={!puedeEditar}
                        onChange={(e) => set(i, { apertura: e.target.value })}
                        className={cn('bg-surface-container-low border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-on-surface outline-none focus:ring-1 focus:ring-primary cursor-pointer disabled:opacity-60',
                          rangoMal ? 'border-error' : 'border-outline-variant/50')}
                      >
                        {HORAS_SLOT.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      <span className="text-on-surface-variant text-xs">→</span>
                      <select
                        value={d.cierre}
                        disabled={!puedeEditar}
                        onChange={(e) => set(i, { cierre: e.target.value })}
                        className={cn('bg-surface-container-low border rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-on-surface outline-none focus:ring-1 focus:ring-primary cursor-pointer disabled:opacity-60',
                          rangoMal ? 'border-error' : 'border-outline-variant/50')}
                      >
                        {HORAS_SLOT.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                      {rangoMal && <span className="text-error text-[11px] font-semibold ml-1">La apertura debe ser antes del cierre</span>}
                    </>
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

        {/* Footer: guardar */}
        {puedeEditar && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-on-surface-variant">
              {invalido
                ? <span className="text-error font-semibold">Revisa los días marcados: la apertura debe ser antes del cierre.</span>
                : dirty
                ? 'Tienes cambios sin guardar.'
                : 'Cambia la hora de apertura/cierre de cada día y guarda.'}
            </p>
            <button
              type="button"
              onClick={guardar}
              disabled={!dirty || invalido || isGuardandoBase}
              className={cn('px-5 py-2 rounded-xl text-sm font-bold transition-all shrink-0',
                !dirty || invalido || isGuardandoBase
                  ? 'bg-surface-container-high text-on-surface-variant/50 cursor-not-allowed'
                  : 'bg-[#0044ab] text-white hover:bg-[#003a91] shadow-sm cursor-pointer')}
            >
              {isGuardandoBase ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 2: Excepciones de la Sede ─────────────────────────────────────────────
function TabExcepciones({ sedeId, sedeName }: { sedeId: string; sedeName: string }) {
  const { excepciones, guardarExcepcion, eliminarExcepcion, isGuardando, isEliminando } = useHorarioSede(sedeId);
  const form = useFormExcepcion();
  const puedeEditar = useAuthStore((s) => s.tiene('horarios.editar'));
  // Excepción cuyo panel de "personal del día" está desplegado (solo una a la vez).
  const [personalAbierto, setPersonalAbierto] = useState<string | null>(null);

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
              {excepciones.map((exc) => {
                const expandido = personalAbierto === exc.fecha;
                return (
                <div
                  key={exc.fecha}
                  className="bg-white border border-outline-variant/30 rounded-xl overflow-hidden shadow-2xs"
                >
                  <div className="p-3.5 flex items-center justify-between gap-3">
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

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Solo un día ABIERTO tiene personal que asignar (si está cerrado no atiende nadie). */}
                      {exc.abierto && (
                        <button
                          type="button"
                          onClick={() => setPersonalAbierto(expandido ? null : exc.fecha)}
                          className={cn(
                            'text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer flex items-center gap-1',
                            expandido
                              ? 'bg-primary text-white border-primary'
                              : 'text-primary border-primary/30 hover:bg-primary/5'
                          )}
                        >
                          <span className="material-symbols-outlined text-sm">groups</span>
                          Personal
                          <span className={cn('material-symbols-outlined text-sm transition-transform', expandido && 'rotate-180')}>expand_more</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => eliminarExcepcion(exc.fecha)}
                        disabled={isEliminando}
                        className="text-xs text-red-600 font-bold hover:bg-red-50 px-2.5 py-1 rounded-lg border border-red-200 transition-colors cursor-pointer"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>

                  {exc.abierto && expandido && (
                    <PanelPersonalExcepcion
                      sedeId={sedeId}
                      sedeName={sedeName}
                      fecha={exc.fecha}
                      apertura={exc.horaApertura ?? null}
                      puedeEditar={puedeEditar}
                    />
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Panel de personal de un día de EXCEPCIÓN abierta ──────────────────────────
// Reutiliza el motor de "día especial" (mismo que la herramienta Días Especiales):
//  - Podóloga DE LA SEDE → marca PRESENCIA (EntradaPodologa) ese día.
//  - Podóloga de OTRA SEDE → crea una COBERTURA de un solo día (su sede base NO se toca);
//    al día siguiente vuelve sola. Baropodometría no se toca (baro permanente por clínica).
// El backend limita/valida contra la ventana de la excepción y refresca disponibilidad.
function PanelPersonalExcepcion({ sedeId, sedeName, fecha, apertura, puedeEditar }: {
  sedeId: string; sedeName: string; fecha: string; apertura: string | null; puedeEditar: boolean;
}) {
  const qc = useQueryClient();
  // Entrada por defecto = apertura de la excepción (08/09); si abre a otra hora, 08:00
  // (el backend recorta el turno a la ventana de la excepción de todos modos).
  const [horaInicio, setHoraInicio] = useState<'08:00' | '09:00'>(apertura === '09:00' ? '09:00' : '08:00');

  const { data, isLoading } = useQuery({
    queryKey: ['dia-especial', sedeId, fecha],
    queryFn: () => profesionalesApi.diaEspecial(sedeId, fecha),
    enabled: !!sedeId && !!fecha,
  });

  const setMut = useMutation({
    mutationFn: (vars: { profesionalId: string; viene: boolean }) =>
      profesionalesApi.setDiaEspecial({ profesionalId: vars.profesionalId, sedeId, fechas: [fecha], viene: vars.viene, horaInicio }),
    onSuccess: (r, vars) => {
      qc.invalidateQueries({ queryKey: ['dia-especial', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] }); // refresca columnas de la agenda
      if (r.errores.length > 0) toast.error(r.errores[0].error, { duration: 6000 });
      else toast.success(vars.viene ? 'Agregada al día' : 'Quitada del día');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deshabilitado = !puedeEditar || setMut.isPending;

  return (
    <div className="border-t border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold text-on-surface">
          Personal que atenderá el{' '}
          <span className="capitalize">{format(parseISO(fecha), "EEEE d 'de' MMM", { locale: es })}</span>
          <span className="font-normal text-on-surface-variant"> · {sedeName}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-xxs font-semibold text-on-surface-variant">Entrada:</span>
          {(['08:00', '09:00'] as const).map((h) => (
            <button
              key={h}
              type="button"
              disabled={!puedeEditar}
              onClick={() => setHoraInicio(h)}
              className={cn(
                'px-2 py-0.5 rounded-md text-xxs font-bold border cursor-pointer disabled:cursor-not-allowed',
                horaInicio === h ? 'bg-primary text-white border-primary' : 'bg-white text-on-surface-variant border-outline-variant'
              )}
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-on-surface-variant/70 py-3 text-center">Cargando personal…</p>
      ) : !data ? null : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ListaStaffExcepcion
            titulo={`Podólogas de ${sedeName}`}
            subtitulo="Marca quién viene este día"
            staff={data.propias}
            deshabilitado={deshabilitado}
            onToggle={(id, viene) => setMut.mutate({ profesionalId: id, viene })}
            vacio="No hay podólogas asignadas a esta sede"
          />
          <ListaStaffExcepcion
            titulo="Traer de otra sede"
            subtitulo="Cubre solo este día — su sede base no se toca"
            staff={data.otras}
            deshabilitado={deshabilitado}
            onToggle={(id, viene) => setMut.mutate({ profesionalId: id, viene })}
            mostrarSedeBase
            vacio="No hay podólogas de otras sedes"
          />
        </div>
      )}
      <p className="text-xxs text-on-surface-variant/60">
        {puedeEditar
          ? 'Baropodometría no cambia aquí: su médico es permanente por clínica.'
          : 'Solo lectura — se requiere permiso de edición de horarios.'}
      </p>
    </div>
  );
}

function ListaStaffExcepcion({ titulo, subtitulo, staff, deshabilitado, onToggle, mostrarSedeBase = false, vacio }: {
  titulo: string; subtitulo: string; staff: PodologaDiaEspecial[]; deshabilitado: boolean;
  onToggle: (id: string, viene: boolean) => void; mostrarSedeBase?: boolean; vacio: string;
}) {
  const vienen = staff.filter((p) => p.viene).length;
  return (
    <div className="bg-white border border-outline-variant/30 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-outline-variant/20 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-on-surface">{titulo}</p>
          <p className="text-xxs text-on-surface-variant/70">{subtitulo}</p>
        </div>
        <span className="text-xxs font-bold text-primary bg-primary/5 border border-primary/20 rounded-full px-2 py-0.5">{vienen} vienen</span>
      </div>
      {staff.length === 0 ? (
        <p className="px-3 py-5 text-center text-xxs text-on-surface-variant/60">{vacio}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-outline-variant/10">
          {staff.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={deshabilitado}
              onClick={() => onToggle(p.id, !p.viene)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                p.viene ? 'bg-primary/5' : 'hover:bg-surface-container-low'
              )}
            >
              <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0', p.viene ? 'bg-primary border-primary text-white' : 'border-outline-variant bg-white')}>
                {p.viene && <span className="material-symbols-outlined text-[12px] leading-none">check</span>}
              </span>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: p.colorAvatar }}>
                {(p.nombres[0] ?? '') + (p.apellidos[0] ?? '')}
              </span>
              <span className={cn('flex-1 text-xs', p.viene ? 'font-semibold text-on-surface' : 'text-on-surface-variant')}>
                {p.nombres.split(' ')[0]} {p.apellidos.split(' ')[0]}
              </span>
              {mostrarSedeBase && p.sedeBase && <span className="text-xxs text-on-surface-variant/60">de {p.sedeBase}</span>}
              {p.viene && <span className="text-xxs text-primary">{p.horaEntrada}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
