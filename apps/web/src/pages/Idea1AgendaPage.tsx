import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, subDays, addDays } from 'date-fns';
import { Idea1Sidebar } from '../components/layout/Idea1Sidebar';
import { Idea1NuevaCitaModal } from '../components/agenda/Idea1NuevaCitaModal';
import { Idea1DetalleCitaModal } from '../components/agenda/Idea1DetalleCitaModal';
import { Idea1ModalHorarioSemanal } from '../components/agenda/Idea1ModalHorarioSemanal';
import {
  useIdea1AgendaData,
  getDefaultAvatar,
  formatearFechaAgenda,
  formatearNombreDoctor,
  timeToMinutes,
  esMismoDia,
} from '../services/idea1AgendaService';

export function Idea1AgendaPage() {
  const navigate = useNavigate();
  const {
    // Store
    sedeId,
    setSedeId,
    fecha,
    setFecha,
    unidadNegocioId,
    setUnidadNegocioId,
    fechaStr,
    // Sedes y Unidades
    sedesDb,
    unidadesDisponibles,
    activeSedeName,
    activeUnidadName,
    isSedeOpen,
    setIsSedeOpen,
    sedeDropdownRef,
    isPaletteOpen,
    setIsPaletteOpen,
    // Datos transformados
    citas,
    doctores,
    bloqueosAlmuerzo = [],
    permisosAgenda = [],
    turnosProfesionales = {},
    horarioEfectivo,
    horarios,
    horaInicioInt,
    horaFinInt,
    // Métricas
    totalCitas,
    llegadasCitas,
    completadasCitas,
    noShowCitas,
    // Scroll refs & sync
    topScrollRef,
    mainScrollRef,
    handleTopScroll,
    handleMainScroll,
    scrollContentWidth,
    hasHorizontalScroll,
    ROW_HEIGHT,
    now,
    // Render helpers
    quickShortcuts,
    currentTimeTopPx,
    isCurrentDayActive,
    gridTemplateColsCss,
    // Acciones
    handleMoverCita,
    isMoving,
  } = useIdea1AgendaData();

  // Estado del Modal de Nueva Cita y Detalle de Cita (Estilos Idea 1)
  const [isNuevaCitaOpen, setIsNuevaCitaOpen] = useState(false);
  const [nuevaCitaParams, setNuevaCitaParams] = useState<{ horaInicio?: string; profesionalId?: string } | undefined>(undefined);
  const [citaSeleccionada, setCitaSeleccionada] = useState<any>(null);
  const [modalHorarioOpen, setModalHorarioOpen] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<{ doctorId: string; hora: string } | null>(null);

  const handleAbrirNuevaCita = (params?: { horaInicio?: string; profesionalId?: string }) => {
    setNuevaCitaParams(params);
    setIsNuevaCitaOpen(true);
  };

  return (
    <div className="bg-background text-on-surface antialiased overflow-hidden flex h-screen w-full">
      {/* SIDE NAVBAR */}
      <Idea1Sidebar />

      {/* MAIN CANVAS */}
      <main className="flex-1 flex flex-col min-w-0 bg-surface">
        {/* TOP NAVBAR */}
        <header className="docked full-width top-0 sticky z-50 bg-surface/80 backdrop-blur-md border-b border-outline-variant/30 shadow-sm flex justify-between items-center w-full px-8 h-16 shrink-0">
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
                <div className="absolute left-0 mt-2 w-64 bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-2xl z-[100] py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
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

            {/* Filtro de Especialidades / Unidades de Negocio (listadas) */}
            {unidadesDisponibles.length > 0 && (
              <div className="hidden md:flex items-center gap-1.5 bg-surface-container-low border border-outline-variant/40 rounded-xl p-1 shadow-xs">
                {unidadesDisponibles.map((u) => {
                  const isSelected = u.id === unidadNegocioId;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUnidadNegocioId(u.id)}
                      className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs md:text-sm font-semibold transition-all whitespace-nowrap ${
                        isSelected
                          ? 'bg-primary text-white shadow-md shadow-primary/20 font-bold'
                          : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isSelected ? 'bg-white' : 'bg-primary/50'
                        }`}
                      />
                      <span>{u.nombre}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => handleAbrirNuevaCita()}
              className="bg-primary text-white px-4 py-2 rounded-lg font-body-md font-semibold hover:opacity-90 active:scale-95 transition-all shadow-md shadow-primary/20 flex items-center gap-2 cursor-pointer"
            >
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
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          {/* HEADER & CONTROLS */}
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Title & Badge */}
                <div className="flex items-center gap-3">
                  <h2 className="font-headline-md text-headline-md font-bold text-on-surface">
                    Horario Diario
                  </h2>
                  <span className="px-3 py-1 font-label-caps text-label-caps rounded-full bg-primary/10 text-primary border border-primary/20">
                    {activeSedeName} • {activeUnidadName}
                  </span>
                </div>

                {/* Selector de fecha con flechas e input date */}
                <div className="flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl p-1 shadow-sm gap-2">
                  <button
                    onClick={() => setFecha(subDays(fecha, 1))}
                    className="p-1.5 hover:bg-surface-container rounded-lg transition-colors"
                    title="Día anterior"
                  >
                    <span className="material-symbols-outlined text-base">chevron_left</span>
                  </button>

                  <div className="flex items-center gap-2 px-1.5">
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
                      className="bg-surface-container border border-outline-variant/40 rounded-lg px-2 py-0.5 text-xs font-mono text-on-surface cursor-pointer focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>

                  <button
                    onClick={() => setFecha(addDays(fecha, 1))}
                    className="p-1.5 hover:bg-surface-container rounded-lg transition-colors"
                    title="Día siguiente"
                  >
                    <span className="material-symbols-outlined text-base">chevron_right</span>
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
                        className={`px-3.5 py-1.5 rounded-lg font-body-md font-semibold text-sm transition-all ${
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

                {/* Horario efectivo de la sede — clic para ver y gestionar horarios */}
                {sedeId && horarioEfectivo && (
                  <button
                    onClick={() => navigate('/horarios')}
                    className="group flex items-center gap-2 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-3 py-1.5 shadow-sm hover:bg-surface-container transition-colors"
                    title="Ver y gestionar horarios de la sede"
                  >
                    {horarioEfectivo.abierto ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        <span className="text-xs font-mono font-semibold text-on-surface">
                          {horarioEfectivo.apertura} – {horarioEfectivo.cierre}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                        <span className="text-xs font-semibold text-red-600">Cerrado hoy</span>
                      </>
                    )}
                    {horarioEfectivo.esExcepcion && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded-full font-bold">
                        EXC
                      </span>
                    )}
                    <span className="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors">
                      edit
                    </span>
                  </button>
                )}
              </div>

              {/* Leyenda de Estados de Citas */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary-fixed-dim shrink-0"></span>
                  <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">
                    AGENDADA
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-container shrink-0"></span>
                  <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">
                    LLEGÓ / CONFIRMADA
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-tertiary-container shrink-0"></span>
                  <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">
                    EN ATENCIÓN
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-outline-variant shrink-0"></span>
                  <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">
                    COMPLETADA
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-error shrink-0"></span>
                  <span className="font-label-caps text-[11px] font-semibold text-on-surface-variant">
                    NO SHOW
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* CALENDAR GRID CONTAINER */}
          <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/40 shadow-sm flex flex-col h-[calc(100vh-145px)] min-h-[650px] w-full overflow-hidden">
            {/* BARRA DE SCROLL HORIZONTAL SUPERIOR SINCRONIZADA */}
            {hasHorizontalScroll && (
              <div className="bg-surface-container-low border-b border-outline-variant/30 px-3 py-1 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant shrink-0">
                  <span className="material-symbols-outlined text-sm text-primary">swap_horiz</span>
                  <span className="text-[11px] font-bold">{doctores.length} doctores</span>
                </div>

                {/* PISTA DE SCROLL SUPERIOR VISIBLE Y SINCRONIZADA */}
                <div
                  ref={topScrollRef}
                  onScroll={handleTopScroll}
                  className="flex-1 overflow-x-scroll top-scrollbar-visible h-[14px]"
                >
                  <div
                    style={{
                      width: scrollContentWidth > 0 ? `${scrollContentWidth}px` : `calc(80px + ${doctores.length} * 200px)`,
                      minWidth: '100%',
                      height: '1px',
                    }}
                  />
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
                          className={`py-2 px-1 md:py-3 md:px-1.5 text-center min-w-0 transition-all ${
                            doc.enVacaciones ? 'bg-amber-500/5' : 'bg-surface-container-lowest'
                          } ${idx < doctores.length - 1 ? 'border-r border-outline-variant/20' : ''}`}
                        >
                          <div className="relative inline-block mx-auto mb-1">
                            <img
                              alt={`${doc.nombres} ${doc.apellidos}`}
                              className={`w-8 h-8 md:w-11 md:h-11 rounded-full mx-auto border-2 object-cover ${
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
                            className="font-headline-sm text-headline-sm text-[11px] md:text-sm font-bold text-on-surface truncate px-0.5 leading-tight"
                            title={`${doc.nombres} ${doc.apellidos}`}
                          >
                            {nombreCorto}
                          </p>
                          <p className="hidden md:block font-label-caps text-[9px] md:text-[10px] text-on-surface-variant tracking-wider uppercase truncate">
                            {doc.especialidad}
                          </p>

                          {/* Insignias de Estadía o Vacaciones */}
                          {doc.enVacaciones ? (
                            <div className="mt-1 flex items-center justify-center max-w-full">
                              <span className="inline-flex items-center gap-0.5 px-1.5 md:px-2 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold bg-amber-500/15 text-amber-700 border border-amber-500/30 truncate max-w-full">
                                🌴 Vacaciones
                              </span>
                            </div>
                          ) : doc.estadiaLabel ? (
                            <div className="mt-1 flex items-center justify-center max-w-full">
                              <span className="inline-flex items-center gap-1 px-1.5 md:px-2 py-0.5 rounded-md text-[9px] md:text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300/80 shadow-xs truncate max-w-full">
                                {doc.estadiaLabel}
                              </span>
                            </div>
                          ) : null}
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
                <div className="relative min-w-full z-[5]">
                  {horarios.map((slot) => {
                    const isMediaHora = slot.esMediaHora;
                    return (
                      <div
                        key={slot.hora}
                        className={`grid h-[50px] min-w-full ${
                          isMediaHora ? 'border-b border-outline-variant/30' : 'border-b border-dashed border-outline-variant/20'
                        }`}
                        style={{
                          gridTemplateColumns: gridTemplateColsCss,
                        }}
                      >
                        <div
                          className={`flex items-center justify-center font-mono-label border-r border-outline-variant/20 sticky left-0 z-20 bg-surface-container-lowest ${
                            isMediaHora
                              ? 'text-[10px] font-medium text-on-surface-variant/60'
                              : 'text-xs font-bold text-on-surface-variant'
                          }`}
                        >
                          {slot.hora}
                        </div>
                        {doctores.map((doc, idx) => {
                          const isHoveredSlot = dragOverSlot?.doctorId === doc.id && dragOverSlot?.hora === slot.hora;
                          const slotMin = timeToMinutes(slot.hora);

                          // Verificar si el slot cae en un almuerzo o permiso del doctor
                          const isAlmuerzo = bloqueosAlmuerzo.some((b) => {
                            if (b.profesionalId !== doc.id || !b.horaInicio || !b.horaFin) return false;
                            const s = timeToMinutes(b.horaInicio);
                            const e = timeToMinutes(b.horaFin);
                            return slotMin >= s && slotMin < e;
                          });

                          const permisoCoincidente = permisosAgenda.find((p) => {
                            if (p.profesionalId !== doc.id || !p.horaInicio || !p.horaFin || p.esVacaciones) return false;
                            const s = timeToMinutes(p.horaInicio);
                            const e = timeToMinutes(p.horaFin);
                            return slotMin >= s && slotMin < e;
                          });

                          // Verificar si el doctor trabaja en este slot (según su turno del día)
                          const turnoDoc = turnosProfesionales[doc.id];
                          const isFueraDeTurno =
                            !doc.enVacaciones &&
                            (!turnoDoc ||
                              slotMin < timeToMinutes(turnoDoc.horaInicio) ||
                              slotMin >= timeToMinutes(turnoDoc.horaFin));

                          const isBloqueado = doc.enVacaciones || isFueraDeTurno || isAlmuerzo || !!permisoCoincidente;

                          return (
                            <div
                              key={doc.id}
                              onClick={() => {
                                if (!isBloqueado) {
                                  handleAbrirNuevaCita({ horaInicio: slot.hora, profesionalId: doc.id });
                                }
                              }}
                              onDragOver={(e) => {
                                if (isBloqueado) return;
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                                if (dragOverSlot?.doctorId !== doc.id || dragOverSlot?.hora !== slot.hora) {
                                  setDragOverSlot({ doctorId: doc.id, hora: slot.hora });
                                }
                              }}
                              onDragLeave={() => {
                                setDragOverSlot((prev) => (prev?.doctorId === doc.id && prev?.hora === slot.hora ? null : prev));
                              }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                setDragOverSlot(null);
                                if (isBloqueado) return;
                                try {
                                  const rawData = e.dataTransfer.getData('text/plain');
                                  if (!rawData) return;
                                  const payload = JSON.parse(rawData);
                                  if (!payload || !payload.citaId) return;

                                  // No mover si es el mismo profesional y hora
                                  if (payload.profesionalId === doc.id && payload.horaInicio === slot.hora) return;

                                  // Advertencia si el paciente eligió el profesional y se cambia
                                  if (payload.origenAsignacion === 'elegida_por_paciente' && payload.profesionalId !== doc.id) {
                                    const confirmMove = window.confirm(
                                      `⚠️ El paciente eligió expresamente atenderse con ${payload.profesionalNombre || 'su profesional original'}.\n\n¿Mover a la columna de ${doc.nombres} a las ${slot.hora}?`
                                    );
                                    if (!confirmMove) return;
                                  }

                                  await handleMoverCita({
                                    citaId: payload.citaId,
                                    slotGrupoId: payload.slotGrupoId,
                                    profesionalId: doc.id,
                                    fecha: fechaStr(),
                                    horaInicio: slot.hora,
                                    origenAsignacion: payload.origenAsignacion,
                                  });
                                } catch (err) {
                                  console.error('Error al soltar la cita:', err);
                                }
                              }}
                              title={
                                doc.enVacaciones
                                  ? 'Horario bloqueado por vacaciones'
                                  : isFueraDeTurno
                                  ? 'No labora en este horario'
                                  : isAlmuerzo
                                  ? 'Horario reservado para almuerzo'
                                  : permisoCoincidente
                                  ? `Horario bloqueado: ${permisoCoincidente.motivo}`
                                  : `Agendar a las ${slot.hora} con ${doc.nombres}`
                              }
                              className={`h-full min-w-0 transition-all flex items-center justify-center relative ${
                                isFueraDeTurno
                                  ? 'bg-surface-container-high/40 opacity-50 cursor-not-allowed'
                                  : isBloqueado
                                  ? 'bg-amber-500/5 cursor-not-allowed'
                                  : isHoveredSlot
                                  ? 'bg-primary/20 border-2 border-dashed border-primary z-30'
                                  : 'hover:bg-primary/5 cursor-pointer group'
                              } ${idx < doctores.length - 1 ? 'border-r border-outline-variant/15' : ''}`}
                            >
                              {isHoveredSlot && (
                                <div className="absolute inset-0 bg-primary/20 border-2 border-dashed border-primary rounded-xl flex items-center justify-center pointer-events-none z-30 animate-pulse">
                                  <div className="bg-primary text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow-lg flex items-center gap-1">
                                    <span className="material-symbols-outlined text-xs font-bold">move_item</span>
                                    <span>Mover a {slot.hora}</span>
                                  </div>
                                </div>
                              )}

                              {isFueraDeTurno && !isHoveredSlot && (
                                <span className="text-[9px] font-semibold text-on-surface-variant/40 select-none pointer-events-none">
                                  No labora
                                </span>
                              )}

                              {!isBloqueado && !isHoveredSlot && (
                                <div className="opacity-0 group-hover:opacity-100 transition-all duration-200 scale-90 group-hover:scale-100 flex items-center gap-1 bg-[#0044ab] text-white text-[10px] font-bold px-2 py-1 rounded-lg shadow-md shadow-primary/30 z-20 pointer-events-none select-none">
                                  <span className="material-symbols-outlined text-xs font-bold">add</span>
                                  <span>{slot.hora}</span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

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
                      const docAlmuerzos = bloqueosAlmuerzo.filter((b) => b.profesionalId === doc.id);
                      const docPermisos = permisosAgenda.filter((p) => p.profesionalId === doc.id && !p.esVacaciones);
                      const startMinGrid = horaInicioInt * 60;
                      const endMinGrid = horaFinInt * 60;

                      return (
                        <div key={`citas-col-${doc.id}`} className="relative h-full pointer-events-none">
                          {/* BLOQUEOS DE ALMUERZO */}
                          {docAlmuerzos.map((almuerzo) => {
                            if (!almuerzo.horaInicio || !almuerzo.horaFin) return null;
                            // Se recorta al horario visible de la agenda (apertura → cierre efectivo)
                            // para no dibujar por debajo del cierre cuando el bloqueo lo excede.
                            const startMin = Math.max(timeToMinutes(almuerzo.horaInicio), startMinGrid);
                            const endMin = Math.min(timeToMinutes(almuerzo.horaFin), endMinGrid);
                            if (endMin <= startMin) return null;
                            const topPx = ((startMin - startMinGrid) / 60) * ROW_HEIGHT;
                            const duracion = Math.max(endMin - startMin, 30);
                            const heightPx = Math.max((duracion / 60) * ROW_HEIGHT - 4, 36);

                            return (
                              <div
                                key={`almuerzo-${almuerzo.id}`}
                                style={{
                                  position: 'absolute',
                                  top: `${topPx}px`,
                                  height: `${heightPx}px`,
                                  left: '3px',
                                  right: '3px',
                                }}
                                className="pointer-events-auto rounded-xl p-2 flex flex-col justify-center items-center text-center transition-all bg-amber-500/15 border border-amber-500/40 text-amber-900 shadow-xs overflow-hidden select-none z-15 backdrop-blur-[2px]"
                                title={`Almuerzo: ${almuerzo.horaInicio} - ${almuerzo.horaFin}`}
                              >
                                <div className="flex items-center gap-1 font-bold text-xs text-amber-800 truncate">
                                  <span>🍽️</span>
                                  <span className="truncate font-semibold">Almuerzo</span>
                                </div>
                                <span className="text-[10px] font-mono font-bold text-amber-800/90 mt-0.5">
                                  {almuerzo.horaInicio} – {almuerzo.horaFin}
                                </span>
                              </div>
                            );
                          })}

                          {/* PERMISOS, REUNIONES Y ENFERMEDAD */}
                          {docPermisos.map((permiso) => {
                            if (!permiso.horaInicio || !permiso.horaFin) return null;
                            // Aunque el permiso/enfermedad se registre hasta las 20:00, si la
                            // sede cierra antes (ej. 18:00) el bloque visual se recorta al
                            // horario efectivo. Los datos en BD quedan intactos.
                            const startMin = Math.max(timeToMinutes(permiso.horaInicio), startMinGrid);
                            const endMin = Math.min(timeToMinutes(permiso.horaFin), endMinGrid);
                            if (endMin <= startMin) return null;
                            const topPx = ((startMin - startMinGrid) / 60) * ROW_HEIGHT;
                            const duracion = Math.max(endMin - startMin, 30);
                            const heightPx = Math.max((duracion / 60) * ROW_HEIGHT - 4, 36);
                            const esReunion = !!permiso.esReunion;
                            const esEnfermedad =
                              !!permiso.esEnfermedad ||
                              permiso.motivo?.toLowerCase().includes('enfermedad') ||
                              permiso.motivo?.startsWith('🤒');

                            const config = esReunion
                              ? {
                                  bg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-950 font-semibold',
                                  icono: '🤝',
                                  titulo: 'Reunión',
                                }
                              : esEnfermedad
                              ? {
                                  bg: 'bg-amber-500/20 border-amber-500/50 text-amber-950 font-semibold',
                                  icono: '🤒',
                                  titulo: 'Enfermedad',
                                }
                              : {
                                  bg: 'bg-rose-500/15 border-rose-500/40 text-rose-950 font-semibold',
                                  icono: '🚫',
                                  titulo: 'Permiso',
                                };

                            return (
                              <div
                                key={`permiso-${permiso.id}`}
                                style={{
                                  position: 'absolute',
                                  top: `${topPx}px`,
                                  height: `${heightPx}px`,
                                  left: '3px',
                                  right: '3px',
                                }}
                                className={`pointer-events-auto rounded-xl p-2 flex flex-col justify-center items-center text-center transition-all shadow-xs overflow-hidden select-none z-15 backdrop-blur-[2px] border ${config.bg}`}
                                title={`${config.titulo}: ${permiso.horaInicio} - ${permiso.horaFin}${permiso.motivo ? ` (${permiso.motivo})` : ''}`}
                              >
                                <div className="flex items-center gap-1 font-bold text-xs truncate">
                                  <span>{config.icono}</span>
                                  <span className="truncate font-bold">{config.titulo}</span>
                                </div>
                                <span className="text-[10px] font-mono font-bold mt-0.5 opacity-90">
                                  {permiso.horaInicio} – {permiso.horaFin}
                                </span>
                                {heightPx >= 55 && permiso.motivo && (
                                  <span className="text-[10px] truncate max-w-full font-medium mt-0.5 opacity-90 px-1">
                                    {permiso.motivo}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {docCitas.map((cita) => {
                            const citaStart = timeToMinutes(cita.horaInicio);
                            const topPx = ((citaStart - startMinGrid) / 60) * ROW_HEIGHT;
                            const duracion = cita.duracionMinutos || 30;
                            const heightPx = Math.max((duracion / 60) * ROW_HEIGHT - 4, 40);
                            const isCompact = heightPx < 60;
                            const isMicro = heightPx < 42;
                            const esDraggable =
                              cita.estado !== 'COMPLETADA' &&
                              cita.estado !== 'NO SHOW' &&
                              cita.estado !== 'CANCELADA';

                            const esCancelada = cita.estado === 'CANCELADA';
                            // Patrón inline: rayas diagonales rojas sobre fondo cremita —
                            // se diferencia a un vistazo de cualquier otro estado.
                            const canceladaBgStyle = esCancelada
                              ? {
                                  backgroundColor: '#fff5f5',
                                  backgroundImage:
                                    'repeating-linear-gradient(135deg, rgba(220, 38, 38, 0.14) 0, rgba(220, 38, 38, 0.14) 6px, transparent 6px, transparent 14px)',
                                }
                              : {};

                            return (
                              <div
                                key={cita.id}
                                draggable={esDraggable}
                                onClick={() => { if (!esCancelada) setCitaSeleccionada(cita.raw); }}
                                onDragStart={(e) => {
                                  if (!esDraggable) return;
                                  const payload = {
                                    citaId: cita.id,
                                    slotGrupoId: cita.raw?.slotGrupoId,
                                    profesionalId: doc.id,
                                    horaInicio: cita.horaInicio,
                                    duracionMinutos: cita.duracionMinutos || 30,
                                    origenAsignacion: cita.raw?.origenAsignacion,
                                    pacienteNombre: cita.paciente,
                                    profesionalNombre: `${doc.nombres} ${doc.apellidos}`,
                                  };
                                  e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => setDragOverSlot(null)}
                                title={
                                  esDraggable
                                    ? 'Arrastra para mover esta cita a otro médico u horario'
                                    : esCancelada
                                    ? 'Cita cancelada · pasá el mouse para ver acciones'
                                    : undefined
                                }
                                style={{
                                  position: 'absolute',
                                  top: `${topPx}px`,
                                  height: `${heightPx}px`,
                                  left: '3px',
                                  right: '3px',
                                  ...canceladaBgStyle,
                                }}
                                className={`group appointment-card pointer-events-auto rounded-xl p-2 flex flex-col justify-between transition-all border overflow-hidden relative ${
                                  esCancelada ? 'is-cancelada' : 'hover:scale-[1.01] hover:shadow-lg'
                                } ${
                                  esDraggable ? 'cursor-grab active:cursor-grabbing hover:border-primary/50' : esCancelada ? 'cursor-default' : 'cursor-pointer'
                                } ${
                                  cita.estado === 'EN ATENCIÓN'
                                    ? 'bg-tertiary-fixed/30 border-tertiary-container/30 text-on-surface'
                                    : cita.estado === 'LLEGÓ'
                                    ? 'bg-emerald-50/60 border-emerald-300 text-on-surface'
                                    : cita.estado === 'CONFIRMADA'
                                    ? 'bg-primary-container/20 border-primary/30 text-on-surface'
                                  : cita.estado === 'COMPLETADA'
                                    ? 'bg-surface-container-high/60 border-outline-variant/40 text-on-surface-variant opacity-75'
                                    : cita.estado === 'NO SHOW'
                                    ? 'bg-error-container/70 border-error/60 text-on-surface opacity-90'
                                  : esCancelada
                                    ? 'border-dashed border-2 border-red-400/60 text-red-900/80 line-through'
                                    : 'bg-surface-container-lowest border-outline-variant/30 text-on-surface shadow-sm'
                                }`}
                              >
                                {/* Barra lateral acento según estado */}
                                <div
                                  className={`absolute left-0 top-1 bottom-1 w-1 rounded-r-full ${
                                    cita.estado === 'EN ATENCIÓN'
                                      ? 'bg-tertiary-container'
                                      : cita.estado === 'LLEGÓ'
                                      ? 'bg-emerald-500'
                                      : cita.estado === 'CONFIRMADA'
                                      ? 'bg-primary'
                                      : cita.estado === 'COMPLETADA'
                                      ? 'bg-outline'
                                      : cita.estado === 'NO SHOW'
                                      ? 'bg-error'
                                      : cita.estado === 'CANCELADA'
                                      ? 'bg-red-500'
                                      : 'bg-primary'
                                  }`}
                                />

                                {/* Overlay de acciones para citas CANCELADAS: al pasar el mouse
                                    aparecen 2 botones compactos centrados en la card — ver la
                                    cita cancelada o agendar una nueva en el slot liberado. */}
                                {esCancelada && (
                                  <div
                                    className="absolute inset-0 rounded-xl bg-surface-container-lowest/70 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 z-30"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCitaSeleccionada(cita.raw);
                                      }}
                                      title="Ver detalle de la cita cancelada"
                                      className="w-8 h-8 grid place-items-center rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:text-on-surface hover:border-outline shadow-sm hover:shadow-md transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[18px]">visibility</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAbrirNuevaCita({
                                          horaInicio: cita.horaInicio,
                                          profesionalId: doc.id,
                                        });
                                      }}
                                      title="Agendar una nueva cita en este slot"
                                      className="w-8 h-8 grid place-items-center rounded-full bg-primary text-white shadow-md shadow-primary/30 hover:shadow-lg hover:opacity-90 transition-all"
                                    >
                                      <span className="material-symbols-outlined text-[18px]">add_circle</span>
                                    </button>
                                  </div>
                                )}

                                <div className="pl-1.5 flex flex-col gap-0.5 min-w-0">
                                  <div className="flex justify-between items-center gap-1">
                                    <span className="font-headline-sm text-headline-sm text-xs font-bold text-on-surface truncate leading-tight">
                                      {cita.paciente}
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {cita.esCombinada && (
                                        <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200 flex items-center gap-0.5" title="Bloque combinado: 2 servicios">
                                          <span>🔗</span>
                                          <span className="hidden sm:inline">Combinada</span>
                                        </span>
                                      )}
                                      <span
                                        className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 shrink-0 ${
                                          cita.estado === 'EN ATENCIÓN'
                                            ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                                            : cita.estado === 'LLEGÓ'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : cita.estado === 'CONFIRMADA'
                                            ? 'bg-primary-fixed text-on-primary-fixed-variant'
                                            : cita.estado === 'COMPLETADA'
                                            ? 'bg-surface-variant text-on-surface-variant'
                                            : cita.estado === 'NO SHOW'
                                            ? 'bg-error-container text-on-error-container'
                                            : cita.estado === 'CANCELADA'
                                            ? 'bg-surface-container-high text-on-surface-variant'
                                            : 'bg-secondary-container text-on-secondary-container'
                                        }`}
                                      >
                                        <span
                                          className={`w-1 h-1 rounded-full ${
                                            cita.estado === 'EN ATENCIÓN'
                                              ? 'bg-tertiary-container animate-pulse'
                                              : cita.estado === 'LLEGÓ'
                                              ? 'bg-emerald-600'
                                              : cita.estado === 'CONFIRMADA'
                                              ? 'bg-primary-container'
                                              : cita.estado === 'NO SHOW'
                                              ? 'bg-error'
                                              : cita.estado === 'CANCELADA'
                                              ? 'bg-outline'
                                              : 'bg-secondary-fixed-dim'
                                          }`}
                                        />
                                        <span className="truncate">{cita.estado}</span>
                                      </span>
                                    </div>
                                  </div>

                                  {/* Servicio(s) y Subcategoría(s) */}
                                  {cita.esCombinada ? (
                                    <div className="flex flex-col gap-1 mt-1">
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCitaSeleccionada(cita.raw);
                                        }}
                                        className="px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-all flex items-center justify-between gap-1 border border-primary/30 text-[11px] font-bold text-primary cursor-pointer shadow-xs"
                                        title="Clic para ver detalle del Servicio 1 (Ancla)"
                                      >
                                        <span className="truncate">
                                          1. {cita.servicioNombre || cita.motivo}
                                          {cita.subcategoriaNombre ? ` (${cita.subcategoriaNombre})` : ''}
                                        </span>
                                        <span className="text-[9px] bg-primary text-white font-mono px-1 rounded shrink-0">Ancla</span>
                                      </div>

                                      <div
                                        onClick={(e) => {
                                          if (cita.secundarioRaw) {
                                            e.stopPropagation();
                                            setCitaSeleccionada(cita.secundarioRaw);
                                          }
                                        }}
                                        className="px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 transition-all flex items-center justify-between gap-1 border border-amber-500/40 text-[11px] font-bold text-amber-900 cursor-pointer shadow-xs"
                                        title="Clic para ver detalle del Servicio 2 (Extra)"
                                      >
                                        <span className="truncate">
                                          2. {cita.extraServicioNombre}
                                          {cita.extraSubcategoriaNombre ? ` (${cita.extraSubcategoriaNombre})` : ''}
                                        </span>
                                        <span className="text-[9px] bg-amber-600 text-white font-mono px-1 rounded shrink-0">Extra</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <>
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
                                    </>
                                  )}
                                </div>

                                {/* Hora de la Cita */}
                                {!isMicro && (
                                  <div className="flex items-center justify-between text-[9px] md:text-[10px] text-on-surface-variant font-mono pl-1.5 mt-auto pt-0.5 border-t border-outline-variant/10">
                                    <span className="truncate font-bold">
                                      {cita.horaInicio} - {cita.horaFin}
                                    </span>
                                    {cita.esCombinada && (
                                      <span className="text-[9px] font-sans font-bold text-indigo-700">2 Servicios</span>
                                    )}
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

      {/* Modal de Nueva Cita (Estilos Idea 1) */}
      {isNuevaCitaOpen && (
        <Idea1NuevaCitaModal
          sedeId={sedeId || ''}
          unidadNegocioId={unidadNegocioId || ''}
          fecha={fecha}
          horaInicio={nuevaCitaParams?.horaInicio}
          profesionalId={nuevaCitaParams?.profesionalId}
          onClose={() => setIsNuevaCitaOpen(false)}
        />
      )}

      {/* Modal de Detalle de Cita (Estilos Idea 1) */}
      {citaSeleccionada && (
        <Idea1DetalleCitaModal
          cita={citaSeleccionada}
          onClose={() => setCitaSeleccionada(null)}
        />
      )}

      {/* Modal de gestión de horarios de la sede (semana + excepciones) */}
      {modalHorarioOpen && sedeId && (
        <Idea1ModalHorarioSemanal
          sedeId={sedeId}
          sedeName={activeSedeName || ''}
          onClose={() => setModalHorarioOpen(false)}
        />
      )}
    </div>
  );
}
