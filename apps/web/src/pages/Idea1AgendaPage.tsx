import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, addDays } from 'date-fns';
import { sedesApi, profesionalesApi, citasApi, horariosApi } from '../api';
import { useAgendaStore } from '../stores/agendaStore';
import {
  obtenerHorariosAgenda,
  getDefaultAvatar,
  formatearFechaAgenda,
  formatearNombreDoctor,
  mapearCitasDbACitaAgenda,
  procesarYOrdenarDoctores,
  calcularRangoHorarioAgenda,
  obtenerAtajosFechaRapidos,
  esMismoDia,
  timeToMinutes,
  calcularTopPxLineaActual,
  DoctorAgenda,
  CitaAgenda,
  SlotHorario,
} from '../services/idea1AgendaService';

export function Idea1AgendaPage() {
  const { sedeId, setSedeId, fecha, setFecha, unidadNegocioId, setUnidadNegocioId, fechaStr } = useAgendaStore();

  // Estado y refs para los desplegables (Combobox) de Sedes y Especialidades
  const [isSedeOpen, setIsSedeOpen] = useState(false);
  const [isEspecialidadOpen, setIsEspecialidadOpen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const sedeDropdownRef = useRef<HTMLDivElement>(null);
  const especialidadDropdownRef = useRef<HTMLDivElement>(null);

  // Cerrar desplegables al hacer clic fuera de ellos
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sedeDropdownRef.current && !sedeDropdownRef.current.contains(event.target as Node)) {
        setIsSedeOpen(false);
      }
      if (especialidadDropdownRef.current && !especialidadDropdownRef.current.contains(event.target as Node)) {
        setIsEspecialidadOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 1. Cargar sedes desde la Base de Datos
  const { data: sedesDb } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  // Auto-seleccionar primera sede si no hay seleccionada
  useEffect(() => {
    if (sedesDb && sedesDb.length > 0 && !sedeId) {
      setSedeId(sedesDb[0].id);
    }
  }, [sedesDb, sedeId, setSedeId]);

  const activeSedeDb = sedesDb?.find((s) => s.id === sedeId);
  const unidadesDisponibles = activeSedeDb?.unidadesNegocio || [];

  // Auto-seleccionar por defecto el área de Podología
  useEffect(() => {
    if (unidadesDisponibles.length > 0) {
      if (!unidadNegocioId || !unidadesDisponibles.find((u) => u.id === unidadNegocioId)) {
        const podologia = unidadesDisponibles.find((u) =>
          u.nombre.toLowerCase().includes('podolog')
        );
        setUnidadNegocioId(podologia ? podologia.id : unidadesDisponibles[0].id);
      }
    }
  }, [unidadesDisponibles, unidadNegocioId, setUnidadNegocioId]);

  const activeSedeName = activeSedeDb?.nombre || 'Seleccionar Sede';
  const activeUnidad = unidadesDisponibles.find((u) => u.id === unidadNegocioId) || unidadesDisponibles[0];
  const activeUnidadName = activeUnidad?.nombre || 'Podología';

  // 2. Horario efectivo de la sede en la fecha seleccionada
  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, fechaStr()],
    queryFn: () => horariosApi.efectivo(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  let baseHoraInicioInt = 8;
  let baseHoraFinInt = 20;
  if (horarioData?.efectivo?.abierto && horarioData.efectivo.apertura && horarioData.efectivo.cierre) {
    const aperturaH = parseInt(horarioData.efectivo.apertura.split(':')[0], 10);
    const cierreH = parseInt(horarioData.efectivo.cierre.split(':')[0], 10);
    if (!isNaN(aperturaH) && !isNaN(cierreH) && aperturaH < cierreH) {
      baseHoraInicioInt = aperturaH;
      baseHoraFinInt = cierreH;
    }
  }

  // 3. Citas desde la Base de Datos filtradas por Sede y Especialidad / Unidad de Negocio
  const { data: citasDb } = useQuery({
    queryKey: ['citas', 'idea1', sedeId, unidadNegocioId, fechaStr()],
    queryFn: () =>
      citasApi.listar({
        sedeId: sedeId!,
        unidadNegocioId: unidadNegocioId!,
        fecha: fechaStr(),
      }),
    enabled: !!sedeId && !!unidadNegocioId,
    refetchInterval: 5_000,
  });

  // 4. Doctores/Profesionales desde la Base de Datos filtrados por Sede y Especialidad
  const { data: profesionalesDb } = useQuery({
    queryKey: ['profesionales-sede', sedeId, unidadNegocioId, fechaStr()],
    queryFn: () =>
      profesionalesApi.listar({
        sedeId: sedeId!,
        unidadNegocioId: unidadNegocioId!,
        fecha: fechaStr(),
        activo: true,
      }),
    enabled: !!sedeId && !!unidadNegocioId,
  });

  // Mapa de doctores para garantizar que cualquier doctor con cita asignada en la unidad tenga su columna
  const doctoresMap = new Map<string, DoctorAgenda>();

  (profesionalesDb || []).forEach((p) => {
    doctoresMap.set(p.id, {
      id: p.id,
      nombres: p.nombres,
      apellidos: p.apellidos,
      especialidad: p.tipo || activeUnidadName,
      activo: p.activo,
      sedeId: p.sedeActual?.id || sedeId || '',
      avatarUrl: undefined,
    });
  });

  (citasDb || []).forEach((c) => {
    const p = c.profesional || c.solicitadoProfesional;
    const pId = c.profesionalId || (c as any).solicitadoProfesionalId || c.solicitadoProfesional?.id;
    if (pId && !doctoresMap.has(pId)) {
      doctoresMap.set(pId, {
        id: pId,
        nombres: p?.nombres || 'Doctor',
        apellidos: p?.apellidos || '',
        especialidad: activeUnidadName,
        activo: true,
        sedeId: sedeId || '',
      });
    }
  });

  // 5. Query de seleccionables para detectar bloqueos y vacaciones en tiempo real
  const { data: seleccionablesDb } = useQuery({
    queryKey: ['seleccionables', sedeId, unidadNegocioId, fechaStr()],
    queryFn: async () => {
      try {
        if (!sedeId || !unidadNegocioId) return [];
        return await profesionalesApi.seleccionables({
          sedeId,
          unidadNegocioId,
          fecha: fechaStr(),
        });
      } catch (err) {
        console.warn('Error al cargar seleccionables/bloqueos:', err);
        return [];
      }
    },
    enabled: !!sedeId && !!unidadNegocioId,
  });

  // 6. Transformación y ordenamiento de citas y doctores usando la capa de servicio
  const citas: CitaAgenda[] = mapearCitasDbACitaAgenda(citasDb || []);

  const doctores: DoctorAgenda[] = procesarYOrdenarDoctores({
    profesionalesDb,
    citasDb,
    citasAgenda: citas,
    seleccionablesDb,
    activeUnidadName,
    sedeId,
  });

  const { horaInicioInt, horaFinInt } = calcularRangoHorarioAgenda(baseHoraInicioInt, baseHoraFinInt, citas);

  const horarios: SlotHorario[] = obtenerHorariosAgenda(horaInicioInt, horaFinInt);

  // 5. Estadísticas del día desde la BD
  const { data: statsDb } = useQuery({
    queryKey: ['stats', sedeId, fechaStr()],
    queryFn: () => citasApi.stats(sedeId!, fechaStr()),
    enabled: !!sedeId,
  });

  const totalCitas = statsDb?.total ?? citas.length;
  const llegadasCitas = (statsDb?.llegaron ?? 0) + (statsDb?.confirmadas ?? 0);
  const completadasCitas = statsDb?.completadas ?? 0;
  const noShowCitas = statsDb?.noShows ?? 0;

  // Refs para sincronización de scrollbars superior e inferior
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);
  const [scrollContentWidth, setScrollContentWidth] = useState(0);

  useEffect(() => {
    const updateWidth = () => {
      if (mainScrollRef.current) {
        setScrollContentWidth(mainScrollRef.current.scrollWidth);
      }
    };
    updateWidth();
    const timer = setTimeout(updateWidth, 300);
    return () => clearTimeout(timer);
  }, [doctores.length, sedeId, unidadNegocioId]);

  const handleTopScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && mainScrollRef.current) {
      mainScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  const handleMainScroll = () => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (topScrollRef.current && mainScrollRef.current) {
      topScrollRef.current.scrollLeft = mainScrollRef.current.scrollLeft;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  };

  const scrollGrid = (direction: 'left' | 'right') => {
    if (mainScrollRef.current) {
      const scrollAmount = 360;
      mainScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 7. Generación dinámica de atajos de fecha y cálculo de posición de línea de hora actual
  const quickShortcuts = obtenerAtajosFechaRapidos();
  const ROW_HEIGHT = 100; // 100px por hora para espacio amplio sin saturación
  const now = new Date();
  const currentTimeTopPx = calcularTopPxLineaActual(horaInicioInt, ROW_HEIGHT);
  const isCurrentDayActive = esMismoDia(fecha, now);

  // Configuración del layout de grilla: Máximo 6 doctores visibles por pantalla sin achicar el ancho
  const MAX_VISIBLE_DOCTORS = 6;
  const numDoctores = Math.max(doctores.length, 1);
  const visibleCols = Math.min(numDoctores, MAX_VISIBLE_DOCTORS);
  const doctorColWidthCss = `calc(max(180px, (100% - 80px) / ${visibleCols}))`;
  const gridTemplateColsCss = `80px repeat(${numDoctores}, ${doctorColWidthCss})`;

  return (
    <div className="bg-background text-on-surface antialiased overflow-hidden flex h-screen w-full">
      {/* SIDE NAVBAR */}
      <aside className="h-screen sticky top-0 left-0 w-sidebar-expanded bg-[#0e4f9f] border-r border-outline-variant/20 flex flex-col py-8 px-4 z-50 shrink-0">
        <div className="mb-10 px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <span
                className="material-symbols-outlined text-white"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                medical_services
              </span>
            </div>
            <div>
              <h1 className="font-headline-md text-headline-md font-bold text-surface-container-lowest leading-none">
                Agenda
              </h1>
              <p className="font-label-caps text-label-caps text-secondary-fixed-dim mt-1">
                Gestión Médica
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-2">
          <a
            className="flex items-center gap-3 py-3 text-primary-fixed-dim font-bold border-l-4 border-primary-fixed-dim pl-4 transition-all duration-300 ease-in-out hover:bg-surface-variant/10 group"
            href="#"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              calendar_today
            </span>
            <span className="font-headline-sm text-headline-sm">Agenda</span>
          </a>
          <a
            className="flex items-center gap-3 py-3 text-secondary-fixed-dim font-medium pl-5 transition-all duration-300 ease-in-out hover:bg-surface-variant/10 hover:text-surface-bright group"
            href="#"
          >
            <span className="material-symbols-outlined">groups</span>
            <span className="font-headline-sm text-headline-sm">Pacientes</span>
          </a>
          <a
            className="flex items-center gap-3 py-3 text-secondary-fixed-dim font-medium pl-5 transition-all duration-300 ease-in-out hover:bg-surface-variant/10 hover:text-surface-bright group"
            href="#"
          >
            <span className="material-symbols-outlined">analytics</span>
            <span className="font-headline-sm text-headline-sm">Analíticas</span>
          </a>
        </nav>

        <div className="mt-auto space-y-2 pt-8 border-t border-white/5">
          <a
            className="flex items-center gap-3 py-3 text-secondary-fixed-dim font-medium pl-5 transition-all duration-300 ease-in-out hover:bg-surface-variant/10 hover:text-surface-bright"
            href="#"
          >
            <span className="material-symbols-outlined">settings</span>
            <span className="font-headline-sm text-headline-sm">Configuración</span>
          </a>
          <a
            className="flex items-center gap-3 py-3 text-secondary-fixed-dim font-medium pl-5 transition-all duration-300 ease-in-out hover:bg-surface-variant/10 hover:text-surface-bright"
            href="#"
          >
            <span className="material-symbols-outlined">help</span>
            <span className="font-headline-sm text-headline-sm">Soporte</span>
          </a>
          <div className="mt-6 p-4 bg-white/5 rounded-xl flex items-center gap-3">
            <img
              alt="Dr. Julian Vance"
              className="w-10 h-10 rounded-full border border-white/10 object-cover"
              src={getDefaultAvatar('Julian Vance')}
            />
            <div className="overflow-hidden">
              <p className="text-white font-semibold text-sm truncate">Dr. Julian Vance</p>
              <p className="text-secondary-fixed-dim text-xs truncate">Jefe de Cirugía</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CANVAS */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface">
        {/* TOP NAVBAR */}
        <header className="docked full-width top-0 sticky z-40 bg-surface/80 backdrop-blur-md border-b border-outline-variant/30 shadow-sm flex justify-between items-center w-full px-8 h-16 shrink-0">
          <div className="flex items-center gap-6 flex-1">
            <div className="relative w-full max-w-md group">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
                search
              </span>
              <input
                className="w-full bg-surface-container-low border border-outline-variant/50 rounded-lg pl-10 pr-16 py-2 text-body-md font-body-md focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                placeholder="Buscar pacientes, registros, archivos..."
                type="text"
                onClick={() => setIsPaletteOpen(true)}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono-label bg-surface-container-high border border-outline-variant rounded text-on-surface-variant">
                  ⌘
                </kbd>
                <kbd className="px-1.5 py-0.5 text-[10px] font-mono-label bg-surface-container-high border border-outline-variant rounded text-on-surface-variant">
                  K
                </kbd>
              </div>
            </div>

            {/* Combobox Desplegable de Sedes */}
            <div className="relative hidden md:block" ref={sedeDropdownRef}>
              <button
                type="button"
                onClick={() => setIsSedeOpen((prev) => !prev)}
                className="flex items-center gap-2.5 px-4 py-2 bg-surface-container-lowest hover:bg-surface-container-low border border-outline-variant/50 rounded-xl text-on-surface font-semibold text-sm transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <span className="material-symbols-outlined text-primary text-xl">location_on</span>
                <span className="truncate max-w-[140px]">{activeSedeName}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                <span
                  className={`material-symbols-outlined text-on-surface-variant text-lg transition-transform duration-200 ${
                    isSedeOpen ? 'rotate-180' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>

              {isSedeOpen && sedesDb && sedesDb.length > 0 && (
                <div className="absolute left-0 mt-2 w-64 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 text-xs font-bold text-on-surface-variant uppercase tracking-wider border-b border-outline-variant/20 flex items-center justify-between">
                    <span>Sedes Disponibles</span>
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                      {sedesDb.length}
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                    {sedesDb.map((sede) => {
                      const isSelected = sede.id === sedeId;
                      return (
                        <button
                          key={sede.id}
                          onClick={() => {
                            setSedeId(sede.id);
                            setIsSedeOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-primary/10 text-primary font-bold'
                              : 'text-on-surface hover:bg-surface-container'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isSelected ? 'bg-primary' : 'bg-outline-variant'
                              }`}
                            />
                            <span className="truncate">{sede.nombre}</span>
                          </div>
                          {isSelected && (
                            <span className="material-symbols-outlined text-primary text-base shrink-0">
                              check
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Combobox Desplegable de Especialidad / Unidad de Negocio */}
            <div className="relative hidden md:block" ref={especialidadDropdownRef}>
              <button
                type="button"
                onClick={() => setIsEspecialidadOpen((prev) => !prev)}
                className="flex items-center gap-2.5 px-4 py-2 bg-surface-container-lowest hover:bg-surface-container-low border border-outline-variant/50 rounded-xl text-on-surface font-semibold text-sm transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <span className="material-symbols-outlined text-primary text-xl">stethoscope</span>
                <span className="truncate max-w-[140px]">{activeUnidadName}</span>
                <span className="w-2 h-2 rounded-full bg-primary shrink-0"></span>
                <span
                  className={`material-symbols-outlined text-on-surface-variant text-lg transition-transform duration-200 ${
                    isEspecialidadOpen ? 'rotate-180' : ''
                  }`}
                >
                  expand_more
                </span>
              </button>

              {isEspecialidadOpen && unidadesDisponibles.length > 0 && (
                <div className="absolute left-0 mt-2 w-60 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-xl z-50 py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-2 text-xs font-bold text-on-surface-variant uppercase tracking-wider border-b border-outline-variant/20 flex items-center justify-between">
                    <span>Especialidad / Área</span>
                    <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-[10px] font-mono font-bold">
                      {unidadesDisponibles.length}
                    </span>
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                    {unidadesDisponibles.map((u) => {
                      const isSelected = u.id === unidadNegocioId;
                      return (
                        <button
                          key={u.id}
                          onClick={() => {
                            setUnidadNegocioId(u.id);
                            setIsEspecialidadOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                            isSelected
                              ? 'bg-primary/10 text-primary font-bold'
                              : 'text-on-surface hover:bg-surface-container'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isSelected ? 'bg-primary' : 'bg-outline-variant'
                              }`}
                            />
                            <span className="truncate">{u.nombre}</span>
                          </div>
                          {isSelected && (
                            <span className="material-symbols-outlined text-primary text-base shrink-0">
                              check
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="bg-primary-container text-on-primary-container px-4 py-2 rounded-lg font-body-md font-semibold hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/20 flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">add_circle</span>
              Nueva Cita
            </button>
            <div className="flex items-center gap-2 px-4 border-l border-outline-variant/30 ml-2">
              <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container rounded-full transition-colors relative">
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-error rounded-full border-2 border-surface"></span>
              </button>
              <button className="w-10 h-10 flex items-center justify-center text-on-surface-variant hover:bg-surface-container rounded-full transition-colors">
                <span className="material-symbols-outlined">apps</span>
              </button>
            </div>
          </div>
        </header>

        {/* AGENDA CONTENT */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8">
          {/* HEADER & METRICS */}
          <section className="flex flex-col lg:flex-row gap-grid-gutter items-start">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="font-headline-md text-headline-md font-bold text-on-surface">
                  Horario Diario
                </h2>
                <span className="px-3 py-1 font-label-caps text-label-caps rounded-full bg-primary/10 text-primary border border-primary/20">
                  {activeSedeName} • {activeUnidadName}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-4">
                {/* Selector de fecha con flechas e input date */}
                <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl p-1 shadow-sm gap-2">
                  <button
                    onClick={() => setFecha(subDays(fecha, 1))}
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors"
                    title="Día anterior"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>

                  <div className="flex items-center gap-2 px-2">
                    <span className="font-body-lg text-body-lg font-bold text-on-surface">
                      {formatearFechaAgenda(fecha)}
                    </span>
                    <input
                      type="date"
                      value={fechaStr()}
                      onChange={(e) => {
                        if (e.target.value) {
                          setFecha(new Date(e.target.value + 'T12:00:00'));
                        }
                      }}
                      className="bg-surface-container border border-outline-variant/40 rounded-lg px-2 py-1 text-xs font-mono text-on-surface cursor-pointer focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>

                  <button
                    onClick={() => setFecha(addDays(fecha, 1))}
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors"
                    title="Día siguiente"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>

                {/* Atajos Dinámicos: Hoy, Mañana, Sábado */}
                <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl p-1 shadow-sm gap-1">
                  {quickShortcuts.map((sc) => {
                    const isActive = esMismoDia(fecha, sc.date);
                    return (
                      <button
                        key={sc.label}
                        onClick={() => setFecha(sc.date)}
                        className={`px-4 py-2 rounded-lg font-body-md font-semibold text-sm transition-all ${
                          isActive
                            ? 'bg-primary text-white shadow-md shadow-primary/20'
                            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                        }`}
                      >
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* KPI PANEL */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full lg:w-auto">
              <div className="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/30 shadow-sm min-w-[140px]">
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                  Total
                </p>
                <div className="flex items-end justify-between">
                  <span className="font-headline-md text-headline-md font-bold">
                    {totalCitas}
                  </span>
                  <span className="text-[10px] font-mono-label text-on-surface-variant bg-surface-container p-1 rounded">
                    100%
                  </span>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/30 shadow-sm min-w-[140px]">
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                  Llegadas
                </p>
                <div className="flex items-end justify-between">
                  <span className="font-headline-md text-headline-md font-bold">
                    {llegadasCitas}
                  </span>
                  <span className="text-[10px] font-mono-label text-primary bg-primary/10 p-1 rounded">
                    {totalCitas > 0 ? Math.round((llegadasCitas / totalCitas) * 100) : 0}%
                  </span>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/30 shadow-sm min-w-[140px]">
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                  Completadas
                </p>
                <div className="flex items-end justify-between">
                  <span className="font-headline-md text-headline-md font-bold">
                    {completadasCitas}
                  </span>
                  <span className="text-[10px] font-mono-label text-on-tertiary-fixed-variant bg-tertiary-fixed p-1 rounded">
                    {totalCitas > 0 ? Math.round((completadasCitas / totalCitas) * 100) : 0}%
                  </span>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/30 shadow-sm min-w-[140px]">
                <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                  No Show
                </p>
                <div className="flex items-end justify-between">
                  <span className="font-headline-md text-headline-md font-bold">
                    {noShowCitas}
                  </span>
                  <span className="text-[10px] font-mono-label text-error bg-error-container p-1 rounded">
                    {totalCitas > 0 ? Math.round((noShowCitas / totalCitas) * 100) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* CALENDAR GRID CONTAINER */}
          <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/40 shadow-sm flex flex-col h-[750px] w-full overflow-hidden">
            {/* BARRA SUPERIOR DE SCROLL E INDICADORES (SI HAY MÁS DE 6 DOCTORES) */}
            {doctores.length > 6 && (
              <div className="bg-surface-container-low border-b border-outline-variant/30 px-3 py-1.5 flex items-center justify-between gap-3 sticky top-0 z-40 shadow-sm shrink-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm text-primary">swap_horiz</span>
                  <span>{doctores.length} doctores listados</span>
                </div>

                {/* SCROLLBAR SUPERIOR SINCRONIZADO */}
                <div
                  ref={topScrollRef}
                  onScroll={handleTopScroll}
                  className="flex-1 overflow-x-auto custom-scrollbar h-3 flex items-center"
                >
                  <div
                    style={{
                      width: scrollContentWidth > 0 ? `${scrollContentWidth}px` : `calc(80px + ${doctores.length} * 180px)`,
                      height: '4px',
                    }}
                  />
                </div>

                {/* BOTONES DE DESPLAZAMIENTO RÁPIDO */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => scrollGrid('left')}
                    title="Deslizar a la izquierda"
                    className="p-1 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-colors border border-outline-variant/30 flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_left</span>
                  </button>
                  <button
                    onClick={() => scrollGrid('right')}
                    title="Deslizar a la derecha"
                    className="p-1 rounded-lg hover:bg-primary/10 text-on-surface-variant hover:text-primary transition-colors border border-outline-variant/30 flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-sm">chevron_right</span>
                  </button>
                </div>
              </div>
            )}

            <div
              ref={mainScrollRef}
              onScroll={handleMainScroll}
              className="flex-1 overflow-auto custom-scrollbar relative w-full"
            >
              <div className="min-w-full inline-block align-top relative">
                {/* GRID HEADER */}
                <div
                  className="grid border-b border-outline-variant/30 bg-surface-container-lowest sticky top-0 z-30 shadow-sm min-w-full"
                  style={{
                    gridTemplateColumns: gridTemplateColsCss,
                  }}
                >
                  <div className="flex items-center justify-center border-r border-outline-variant/20 bg-surface-container-lowest sticky left-0 z-50">
                    <span className="material-symbols-outlined text-on-surface-variant">schedule</span>
                  </div>

                  {doctores.length > 0 ? (
                    doctores.map((doc, idx) => {
                      const nombreCorto = formatearNombreDoctor(doc.nombres, doc.apellidos);

                      return (
                        <div
                          key={doc.id}
                          className={`py-3 px-1.5 text-center min-w-0 transition-all ${
                            doc.enVacaciones ? 'bg-amber-500/5' : 'bg-surface-container-lowest'
                          } ${idx < doctores.length - 1 ? 'border-r border-outline-variant/20' : ''}`}
                        >
                          <div className="relative inline-block mx-auto mb-1">
                            <img
                              alt={`${doc.nombres} ${doc.apellidos}`}
                              className={`w-10 h-10 md:w-11 md:h-11 rounded-full mx-auto border-2 object-cover ${
                                doc.enVacaciones
                                  ? 'border-amber-500/40 opacity-75 grayscale-[20%]'
                                  : 'border-primary/10'
                              }`}
                              src={doc.avatarUrl || getDefaultAvatar(doc.nombres)}
                            />
                            {doc.enVacaciones && (
                              <span className="absolute -bottom-1 -right-1 text-xs" title="En Vacaciones">
                                🌴
                              </span>
                            )}
                          </div>
                          <p
                            className="font-headline-sm text-headline-sm text-xs md:text-sm font-bold text-on-surface truncate px-0.5 leading-tight"
                            title={`${doc.nombres} ${doc.apellidos}`}
                          >
                            {nombreCorto}
                          </p>
                          <p className="font-label-caps text-[9px] md:text-[10px] text-on-surface-variant tracking-wider uppercase truncate">
                            {doc.especialidad}
                          </p>

                          {/* Insignias de Citas o Vacaciones */}
                          {doc.enVacaciones ? (
                            <div className="mt-1 flex items-center justify-center">
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30 truncate">
                                🌴 Vacaciones
                              </span>
                            </div>
                          ) : (doc.citasCount || 0) > 0 ? (
                            <div className="mt-1 flex items-center justify-center">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-primary/10 text-primary border border-primary/20">
                                {doc.citasCount} {doc.citasCount === 1 ? 'cita' : 'citas'}
                              </span>
                            </div>
                          ) : (
                            <div className="mt-1 flex items-center justify-center">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium text-on-surface-variant/50">
                                Sin citas
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-8 px-4 text-center text-on-surface-variant text-sm col-span-full font-medium bg-surface-container-lowest">
                      No hay doctores activos asignados a esta especialidad en la fecha seleccionada.
                    </div>
                  )}
                </div>

                {/* GRID CONTENT ROWS */}
                <div className="relative min-w-full">
                  {horarios.map((slot) => (
                    <div
                      key={slot.hora}
                      className="grid h-[100px] border-b border-outline-variant/15 min-w-full"
                      style={{
                        gridTemplateColumns: gridTemplateColsCss,
                      }}
                    >
                      <div className="flex items-center justify-center font-mono-label text-on-surface-variant border-r border-outline-variant/20 text-xs font-bold bg-surface-container-lowest sticky left-0 z-20">
                        {slot.hora}
                      </div>
                      {doctores.map((doc, idx) => (
                        <div
                          key={doc.id}
                          className={`h-full min-w-0 ${
                            doc.enVacaciones ? 'bg-amber-500/5' : ''
                          } ${idx < doctores.length - 1 ? 'border-r border-outline-variant/15' : ''}`}
                        />
                      ))}
                    </div>
                  ))}

                  {/* OVERLAY DE CITAS Y BLOQUEOS DE VACACIONES */}
                  <div
                    className="absolute inset-0 grid pointer-events-none z-10 min-w-full"
                    style={{
                      gridTemplateColumns: gridTemplateColsCss,
                    }}
                  >
                    {/* Espaciador alineado con el eje de tiempo (80px) */}
                    <div className="pointer-events-none" />

                    {doctores.map((doc) => {
                      if (doc.enVacaciones) {
                        return (
                          <div
                            key={`citas-col-${doc.id}`}
                            className="relative h-full pointer-events-auto bg-amber-500/10 border-x border-amber-500/20 flex flex-col items-center justify-start pt-16 p-3 select-none"
                            style={{
                              backgroundImage: 'radial-gradient(#f59e0b 1.2px, transparent 1.2px)',
                              backgroundSize: '16px 16px',
                            }}
                          >
                            <div className="bg-surface-container-lowest/95 backdrop-blur-md border border-amber-500/40 rounded-2xl p-3 text-center shadow-lg max-w-[95%] sticky top-24 z-20">
                              <span className="text-2xl mb-1 block animate-bounce">🌴</span>
                              <p className="font-bold text-xs text-amber-800 uppercase tracking-wider">
                                En Vacaciones
                              </p>
                              <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                                Horario Bloqueado
                              </p>
                            </div>
                          </div>
                        );
                      }

                      const docCitas = citas.filter((c) => c.doctorId === doc.id);
                      const startMinGrid = horaInicioInt * 60;

                      return (
                        <div key={`citas-col-${doc.id}`} className="relative h-full pointer-events-auto">
                          {docCitas.map((cita) => {
                            const citaStart = timeToMinutes(cita.horaInicio);
                            const topPx = ((citaStart - startMinGrid) / 60) * ROW_HEIGHT;
                            const duracion = cita.duracionMinutos || 30;
                            const heightPx = Math.max((duracion / 60) * ROW_HEIGHT - 4, 40);
                            const isCompact = heightPx < 60;
                            const isMicro = heightPx < 42;

                            return (
                              <div
                                key={cita.id}
                                style={{
                                  position: 'absolute',
                                  top: `${topPx}px`,
                                  height: `${heightPx}px`,
                                  left: '3px',
                                  right: '3px',
                                }}
                                className={`appointment-card rounded-xl p-2 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.01] hover:shadow-lg border overflow-hidden ${
                                  cita.estado === 'EN ATENCIÓN'
                                    ? 'bg-tertiary-fixed/30 border-tertiary-container/30 text-on-surface'
                                    : cita.estado === 'CONFIRMADA'
                                    ? 'bg-primary-container/20 border-primary/30 text-on-surface'
                                    : cita.estado === 'COMPLETADA'
                                    ? 'bg-surface-container-high/60 border-outline-variant/40 text-on-surface-variant opacity-75'
                                    : cita.estado === 'NO SHOW'
                                    ? 'bg-error-container/30 border-error/30 text-on-surface'
                                    : 'bg-surface-container-lowest border-outline-variant/30 text-on-surface shadow-sm'
                                }`}
                              >
                                {/* Barra lateral acento según estado */}
                                <div
                                  className={`absolute left-0 top-1 bottom-1 w-1 rounded-r-full ${
                                    cita.estado === 'EN ATENCIÓN'
                                      ? 'bg-tertiary-container'
                                      : cita.estado === 'CONFIRMADA'
                                      ? 'bg-primary'
                                      : cita.estado === 'COMPLETADA'
                                      ? 'bg-outline'
                                      : cita.estado === 'NO SHOW'
                                      ? 'bg-error'
                                      : 'bg-primary'
                                  }`}
                                />

                                <div className="pl-1.5 flex flex-col gap-0.5 min-w-0">
                                  <div className="flex justify-between items-center gap-1">
                                    <span className="font-headline-sm text-headline-sm text-xs font-bold text-on-surface truncate leading-tight">
                                      {cita.paciente}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 shrink-0 ${
                                        cita.estado === 'EN ATENCIÓN'
                                          ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                                          : cita.estado === 'CONFIRMADA'
                                          ? 'bg-primary-fixed text-on-primary-fixed-variant'
                                          : cita.estado === 'COMPLETADA'
                                          ? 'bg-surface-variant text-on-surface-variant'
                                          : cita.estado === 'NO SHOW'
                                          ? 'bg-error-container text-on-error-container'
                                          : 'bg-secondary-container text-on-secondary-container'
                                      }`}
                                    >
                                      <span
                                        className={`w-1 h-1 rounded-full ${
                                          cita.estado === 'EN ATENCIÓN'
                                            ? 'bg-tertiary-container animate-pulse'
                                            : cita.estado === 'CONFIRMADA'
                                            ? 'bg-primary-container'
                                            : cita.estado === 'NO SHOW'
                                            ? 'bg-error'
                                            : 'bg-secondary-fixed-dim'
                                        }`}
                                      />
                                      <span className="truncate">{cita.estado === 'CONFIRMADA' ? 'LLEGÓ' : cita.estado}</span>
                                    </span>
                                  </div>

                                  {/* Servicio y Subcategoría */}
                                  {!isCompact && (
                                    <p className="font-body-md text-xs text-on-surface-variant font-medium truncate leading-tight mt-0.5">
                                      {cita.servicioNombre || cita.motivo}
                                      {cita.subcategoriaNombre ? ` · ${cita.subcategoriaNombre}` : ''}
                                    </p>
                                  )}

                                  {!isCompact && cita.etiquetaAsignacion && (
                                    <p className="text-[11px] text-primary font-semibold truncate leading-tight">
                                      {cita.etiquetaAsignacion}
                                    </p>
                                  )}
                                </div>

                                {/* Hora de la Cita */}
                                {!isMicro && (
                                  <div className="flex items-center justify-between text-[9px] md:text-[10px] text-on-surface-variant font-mono pl-1.5 mt-auto pt-0.5 border-t border-outline-variant/10">
                                    <span className="truncate">
                                      {cita.horaInicio} - {cita.horaFin}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {/* LÍNEA DE TIEMPO ACTUAL */}
                  {isCurrentDayActive && currentTimeTopPx >= 0 && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none z-30"
                      style={{ top: `${currentTimeTopPx}px` }}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-20 flex justify-end pr-2">
                          <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm font-mono">
                            {format(now, 'HH:mm')}
                          </span>
                        </div>
                        <div className="flex-1 h-0.5 bg-primary relative">
                          <div className="absolute -left-1 -top-1 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(53,37,205,0.6)]"></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* FOOTER LEGEND */}
          <footer className="flex items-center justify-between pb-8">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-secondary-fixed-dim"></span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  AGENDADA
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary-container"></span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  LLEGÓ / CONFIRMADA
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-tertiary-container"></span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  EN ATENCIÓN
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-outline-variant"></span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  COMPLETADA
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-error"></span>
                <span className="font-label-caps text-[10px] text-on-surface-variant">
                  NO SHOW
                </span>
              </div>
            </div>
          </footer>
        </div>
      </main>

      {/* COMMAND PALETTE OVERLAY */}
      {isPaletteOpen && (
        <div
          className="fixed inset-0 bg-inverse-surface/20 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={() => setIsPaletteOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-outline-variant/20 flex items-center gap-3">
              <span className="material-symbols-outlined text-on-surface-variant">search</span>
              <input
                className="flex-1 border-none focus:ring-0 font-headline-sm text-headline-sm bg-transparent outline-none"
                placeholder="Escribe un comando o busca..."
                type="text"
                autoFocus
              />
              <kbd className="px-2 py-1 text-xs font-mono-label bg-surface-container-high border border-outline-variant rounded text-on-surface-variant">
                ESC
              </kbd>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-1">
                <p className="px-2 font-label-caps text-[10px] text-on-surface-variant mb-2">
                  ACCIONES
                </p>
                <div className="flex items-center gap-3 p-2 hover:bg-primary/5 rounded-lg cursor-pointer group transition-colors">
                  <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary">
                    calendar_clock
                  </span>
                  <span className="flex-1 font-body-md text-on-surface">Crear Nueva Cita</span>
                  <kbd className="text-[10px] font-mono-label text-on-surface-variant">N</kbd>
                </div>
                <div className="flex items-center gap-3 p-2 hover:bg-primary/5 rounded-lg cursor-pointer group transition-colors">
                  <span className="material-symbols-outlined text-on-surface-variant group-hover:text-primary">
                    person_add
                  </span>
                  <span className="flex-1 font-body-md text-on-surface">
                    Registrar Nuevo Paciente
                  </span>
                  <kbd className="text-[10px] font-mono-label text-on-surface-variant">P</kbd>
                </div>
              </div>
            </div>
            <div className="bg-surface-container-low px-4 py-2 flex justify-between items-center text-[10px] text-on-surface-variant">
              <div className="flex items-center gap-3">
                <span>↑↓ para navegar</span>
                <span>ENTER para seleccionar</span>
              </div>
              <span>Agenda</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
