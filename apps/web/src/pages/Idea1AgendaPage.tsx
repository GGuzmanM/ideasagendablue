import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { sedesApi, profesionalesApi, citasApi, horariosApi } from '../api';
import {
  obtenerHorariosAgenda,
  obtenerSedes,
  obtenerDoctoresActivosPorSede,
  obtenerCitasEjemplo,
  getDefaultAvatar,
  formatearFechaAgenda,
  SedeAgenda,
  DoctorAgenda,
  CitaAgenda,
  SlotHorario,
} from '../services/idea1AgendaService';

export function Idea1AgendaPage() {
  // Estado para la fecha actual seleccionada en la agenda
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const fechaStr = format(currentDate, 'yyyy-MM-dd');

  // 1. Obtención de Sedes (con fallback a lista fija)
  const { data: sedesDb } = useQuery({
    queryKey: ['sedes'],
    queryFn: sedesApi.listar,
  });

  const sedesList: SedeAgenda[] =
    sedesDb && sedesDb.length > 0
      ? sedesDb.map((s) => ({ id: s.id, nombre: s.nombre, activa: s.activa }))
      : obtenerSedes();

  const [selectedSedeId, setSelectedSedeId] = useState<string>('principal');

  useEffect(() => {
    if (sedesDb && sedesDb.length > 0 && !sedesDb.find((s) => s.id === selectedSedeId)) {
      setSelectedSedeId(sedesDb[0].id);
    }
  }, [sedesDb, selectedSedeId]);

  const activeSede = sedesList.find((s) => s.id === selectedSedeId) || sedesList[0];
  const activeSedeDb = sedesDb?.find((s) => s.id === selectedSedeId);
  const unidadNegocioId = activeSedeDb?.unidadesNegocio?.[0]?.id;

  // 2. Horario efectivo de la sede en la fecha seleccionada
  const { data: horarioData } = useQuery({
    queryKey: ['horario', selectedSedeId, fechaStr],
    queryFn: () => horariosApi.efectivo(selectedSedeId, fechaStr),
    enabled: !!selectedSedeId,
  });

  let horaInicioInt = 9;
  let horaFinInt = 18;
  if (horarioData?.efectivo?.abierto && horarioData.efectivo.apertura && horarioData.efectivo.cierre) {
    const aperturaH = parseInt(horarioData.efectivo.apertura.split(':')[0], 10);
    const cierreH = parseInt(horarioData.efectivo.cierre.split(':')[0], 10);
    if (!isNaN(aperturaH) && !isNaN(cierreH) && aperturaH < cierreH) {
      horaInicioInt = aperturaH;
      horaFinInt = cierreH;
    }
  }

  const horarios: SlotHorario[] = obtenerHorariosAgenda(horaInicioInt, horaFinInt);

  // 3. Doctores/Profesionales filtrados por Sede (con fallback si la BD está vacía)
  const { data: profesionalesDb } = useQuery({
    queryKey: ['profesionales-sede', selectedSedeId, unidadNegocioId, fechaStr],
    queryFn: () =>
      profesionalesApi.listar({
        sedeId: selectedSedeId,
        unidadNegocioId,
        fecha: fechaStr,
        activo: true,
      }),
    enabled: !!selectedSedeId,
  });

  const doctores: DoctorAgenda[] =
    profesionalesDb && profesionalesDb.length > 0
      ? profesionalesDb.map((p) => ({
          id: p.id,
          nombres: p.nombres,
          apellidos: p.apellidos,
          especialidad: p.tipo || 'Podología',
          activo: p.activo,
          sedeId: p.sedeActual?.id || selectedSedeId,
          avatarUrl: undefined,
        }))
      : obtenerDoctoresActivosPorSede(selectedSedeId);

  // 4. Citas (con fallback visual si la BD está vacía para esa fecha)
  const { data: citasDb } = useQuery({
    queryKey: ['citas', selectedSedeId, fechaStr, unidadNegocioId],
    queryFn: () =>
      citasApi.listar({
        sedeId: selectedSedeId,
        fecha: fechaStr,
        unidadNegocioId,
      }),
    enabled: !!selectedSedeId,
    refetchInterval: 30_000,
  });

  const citas: CitaAgenda[] =
    citasDb && citasDb.length > 0
      ? citasDb.map((c) => {
          const hInicio = c.horaInicio || '09:00';
          const [h, m] = hInicio.split(':').map(Number);
          const totalMin = (h || 0) * 60 + (m || 0) + (c.duracionMinutos || 30);
          const endH = Math.floor(totalMin / 60);
          const endM = totalMin % 60;
          const hFin = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

          let estadoNormalizado: CitaAgenda['estado'] = 'AGENDADA';
          const st = (c.estado || '').toUpperCase();
          if (st === 'EN_ATENCION' || st === 'EN ATENCIÓN') estadoNormalizado = 'EN ATENCIÓN';
          else if (st === 'CONFIRMADA' || st === 'LLEGO') estadoNormalizado = 'CONFIRMADA';
          else if (st === 'COMPLETADA') estadoNormalizado = 'COMPLETADA';
          else if (st === 'NO_SHOW' || st === 'NO SHOW') estadoNormalizado = 'NO SHOW';

          return {
            id: c.id,
            doctorId: c.profesionalId || (doctores[0] ? doctores[0].id : 'doc-1'),
            horaInicio: hInicio,
            horaFin: hFin,
            paciente: c.paciente
              ? `${c.paciente.nombres} ${c.paciente.apellidoPaterno || ''}`.trim()
              : 'Paciente',
            motivo: c.servicio?.nombre || 'Consulta Médica',
            estado: estadoNormalizado,
          };
        })
      : obtenerCitasEjemplo(selectedSedeId);

  // 5. Estadísticas del día
  const { data: statsDb } = useQuery({
    queryKey: ['stats', selectedSedeId, fechaStr],
    queryFn: () => citasApi.stats(selectedSedeId, fechaStr),
    enabled: !!selectedSedeId,
  });

  const totalCitas = statsDb?.total ?? 42;
  const llegadasCitas = (statsDb?.llegaron ?? 0) + (statsDb?.confirmadas ?? 0) || 28;
  const completadasCitas = statsDb?.completadas ?? 15;
  const noShowCitas = statsDb?.noShows ?? 3;

  // Estado del modal de comando (⌘K / Ctrl+K)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  // Atajo de teclado Ctrl+K / Cmd+K y Escape
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

  const getCitasParaSlotYDoctor = (hora: string, doctorId: string) => {
    return citas.filter((c) => c.horaInicio === hora && c.doctorId === doctorId);
  };

  return (
    <div className="bg-background text-on-surface antialiased overflow-hidden flex h-screen w-full">
      {/* SIDE NAVBAR */}
      <aside className="h-screen sticky top-0 left-0 w-sidebar-expanded bg-on-secondary-fixed border-r border-outline-variant/20 flex flex-col py-8 px-4 z-50 shrink-0">
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
          {/* Agenda is Active */}
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
          <div className="flex items-center gap-8 flex-1">
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

            {/* Listado dinámico de Sedes */}
            <nav className="hidden lg:flex items-center gap-6">
              {sedesList.map((sede) => {
                const isActive = sede.id === selectedSedeId;
                return (
                  <button
                    key={sede.id}
                    onClick={() => setSelectedSedeId(sede.id)}
                    className={`font-body-md transition-colors ${
                      isActive
                        ? 'text-primary font-bold border-b-2 border-primary pb-1'
                        : 'text-on-surface-variant font-medium hover:text-primary'
                    }`}
                  >
                    {sede.nombre}
                  </button>
                );
              })}
            </nav>
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
                  {activeSede.nombre}
                </span>
              </div>
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl p-1 shadow-sm">
                  <button
                    onClick={() =>
                      setCurrentDate((prev) => {
                        const d = new Date(prev);
                        d.setDate(d.getDate() - 1);
                        return d;
                      })
                    }
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors"
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  <span className="px-4 font-body-lg text-body-lg font-semibold text-on-surface">
                    {formatearFechaAgenda(currentDate)}
                  </span>
                  <button
                    onClick={() =>
                      setCurrentDate((prev) => {
                        const d = new Date(prev);
                        d.setDate(d.getDate() + 1);
                        return d;
                      })
                    }
                    className="p-2 hover:bg-surface-container rounded-lg transition-colors"
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
                <button
                  onClick={() => setCurrentDate(new Date())}
                  className="px-4 py-2 bg-surface-container-lowest border border-outline-variant/50 rounded-xl font-body-md font-medium text-on-surface-variant shadow-sm hover:border-primary/30 transition-all"
                >
                  Hoy
                </button>
                <div className="flex items-center bg-surface-container-high rounded-xl p-1">
                  <button className="px-4 py-1.5 bg-surface-container-lowest rounded-lg shadow-sm text-primary font-semibold text-sm">
                    Día
                  </button>
                  <button className="px-4 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-medium text-sm transition-colors">
                    Semana
                  </button>
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
                    {totalCitas > 0 ? Math.round((llegadasCitas / totalCitas) * 100) : 66}%
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
                    {totalCitas > 0 ? Math.round((completadasCitas / totalCitas) * 100) : 35}%
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
                    {totalCitas > 0 ? Math.round((noShowCitas / totalCitas) * 100) : 7}%
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* CALENDAR GRID */}
          <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/40 shadow-sm overflow-hidden flex flex-col h-[700px]">
            {/* GRID HEADER (PROFESSIONALS DINÁMICOS POR SEDE Y DÍA) */}
            <div
              className="grid border-b border-outline-variant/20 bg-surface-container-lowest sticky top-0 z-10"
              style={{
                gridTemplateColumns: `80px repeat(${Math.max(doctores.length, 1)}, minmax(0, 1fr))`,
              }}
            >
              <div className="flex items-center justify-center border-r border-outline-variant/10">
                <span className="material-symbols-outlined text-on-surface-variant">schedule</span>
              </div>

              {doctores.length > 0 ? (
                doctores.map((doc, idx) => (
                  <div
                    key={doc.id}
                    className={`py-4 px-2 text-center ${
                      idx < doctores.length - 1 ? 'border-r border-outline-variant/10' : ''
                    }`}
                  >
                    <img
                      alt={`${doc.nombres} ${doc.apellidos}`}
                      className="w-12 h-12 rounded-full mx-auto mb-2 border-2 border-primary/10 object-cover"
                      src={doc.avatarUrl || getDefaultAvatar(doc.nombres)}
                    />
                    <p className="font-headline-sm text-headline-sm text-sm">
                      {doc.nombres} {doc.apellidos}
                    </p>
                    <p className="font-label-caps text-[10px] text-on-surface-variant tracking-wider uppercase">
                      {doc.especialidad}
                    </p>
                  </div>
                ))
              ) : (
                <div className="py-4 px-4 text-center text-on-surface-variant text-sm col-span-full">
                  No hay doctores activos asignados a esta sede el día de hoy.
                </div>
              )}
            </div>

            {/* GRID CONTENT */}
            <div className="flex-1 overflow-y-auto custom-scrollbar relative">
              {/* TIME EJE BACKDROP */}
              <div
                className="absolute inset-0 grid pointer-events-none"
                style={{
                  gridTemplateColumns: `80px repeat(${Math.max(doctores.length, 1)}, minmax(0, 1fr))`,
                }}
              >
                <div className="col-start-1 bg-surface-container-lowest"></div>
                {doctores.map((doc, idx) => (
                  <div
                    key={`col-${doc.id}`}
                    className={`col-start-${idx + 2} border-r border-outline-variant/5`}
                  ></div>
                ))}
              </div>

              {/* TIME ROWS */}
              <div className="relative">
                {horarios.map((slot) => (
                  <div
                    key={slot.hora}
                    className="grid grid-cols-[80px_1fr] h-20 border-b border-outline-variant/5"
                  >
                    <div className="flex items-center justify-center font-mono-label text-on-surface-variant border-r border-outline-variant/10">
                      {slot.hora}
                    </div>

                    <div
                      className="relative grid h-full"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(doctores.length, 1)}, minmax(0, 1fr))`,
                      }}
                    >
                      {doctores.map((doc, colIndex) => {
                        const citasSlot = getCitasParaSlotYDoctor(slot.hora, doc.id);
                        return (
                          <div
                            key={doc.id}
                            style={{ gridColumnStart: colIndex + 1 }}
                            className="relative h-full p-2"
                          >
                            {citasSlot.map((cita) => {
                              if (cita.estado === 'AGENDADA') {
                                return (
                                  <div
                                    key={cita.id}
                                    className="appointment-card absolute top-2 left-2 right-2 h-[150px] z-20 bg-surface border border-outline-variant/30 rounded-xl p-3 flex flex-col gap-1 cursor-pointer"
                                  >
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r-full"></div>
                                    <div className="flex justify-between items-start">
                                      <span className="font-headline-sm text-headline-sm text-xs text-on-surface">
                                        {cita.paciente}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary-container text-[10px] font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-secondary-fixed-dim rounded-full"></span>
                                        AGENDADA
                                      </span>
                                    </div>
                                    <p className="font-body-md text-xs text-on-surface-variant">
                                      {cita.motivo}
                                    </p>
                                    <div className="mt-auto flex items-center justify-between text-[10px] text-on-surface-variant font-medium">
                                      <span>
                                        {cita.horaInicio} - {cita.horaFin}
                                      </span>
                                      <span className="material-symbols-outlined text-sm">
                                        more_vert
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              if (cita.estado === 'EN ATENCIÓN') {
                                return (
                                  <div
                                    key={cita.id}
                                    className="appointment-card h-full bg-tertiary-fixed/30 border border-tertiary-container/20 rounded-xl p-3 flex flex-col gap-1 cursor-pointer relative"
                                  >
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-tertiary-container rounded-r-full"></div>
                                    <div className="flex justify-between items-start">
                                      <span className="font-headline-sm text-headline-sm text-xs text-on-surface">
                                        {cita.paciente}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed-variant text-[10px] font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-tertiary-container rounded-full animate-pulse"></span>
                                        EN ATENCIÓN
                                      </span>
                                    </div>
                                    <p className="font-body-md text-xs text-on-surface-variant">
                                      {cita.motivo}
                                    </p>
                                  </div>
                                );
                              }

                              if (cita.estado === 'CONFIRMADA') {
                                return (
                                  <div
                                    key={cita.id}
                                    className="appointment-card h-full bg-primary-container/10 border border-primary/20 rounded-xl p-3 flex flex-col gap-1 cursor-pointer relative"
                                  >
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-r-full"></div>
                                    <div className="flex justify-between items-start">
                                      <span className="font-headline-sm text-headline-sm text-xs text-on-surface">
                                        {cita.paciente}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed-variant text-[10px] font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-primary-container rounded-full"></span>
                                        LLEGÓ
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              if (cita.estado === 'COMPLETADA') {
                                return (
                                  <div
                                    key={cita.id}
                                    className="appointment-card h-full bg-surface-container-high/50 border border-outline-variant/40 rounded-xl p-3 flex flex-col gap-1 cursor-pointer grayscale opacity-70 relative"
                                  >
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-outline rounded-r-full"></div>
                                    <div className="flex justify-between items-start">
                                      <span className="font-headline-sm text-headline-sm text-xs text-on-surface">
                                        {cita.paciente}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full bg-surface-variant text-on-surface-variant text-[10px] font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-outline rounded-full"></span>{' '}
                                        COMPLETADA
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              if (cita.estado === 'NO SHOW') {
                                return (
                                  <div
                                    key={cita.id}
                                    className="appointment-card h-full bg-error-container/30 border border-error/20 rounded-xl p-3 flex flex-col gap-1 cursor-pointer relative"
                                  >
                                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-error rounded-r-full"></div>
                                    <div className="flex justify-between items-start">
                                      <span className="font-headline-sm text-headline-sm text-xs text-on-surface">
                                        {cita.paciente}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-full bg-error-container text-on-error-container text-[10px] font-bold flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 bg-error rounded-full"></span>{' '}
                                        NO SHOW
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              return null;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* CURRENT TIME INDICATOR */}
              <div className="absolute top-[220px] left-0 right-0 pointer-events-none z-30">
                <div className="flex items-center gap-2">
                  <div className="w-20 flex justify-end pr-2">
                    <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm">
                      11:15
                    </span>
                  </div>
                  <div className="flex-1 h-0.5 bg-primary relative">
                    <div className="absolute -left-1 -top-1 w-2.5 h-2.5 bg-primary rounded-full shadow-[0_0_8px_rgba(53,37,205,0.6)]"></div>
                  </div>
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
            <div className="flex items-center gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-sm">info</span>
              <p className="font-body-md text-[11px]">Sistema actualizado en tiempo real con la BD</p>
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
