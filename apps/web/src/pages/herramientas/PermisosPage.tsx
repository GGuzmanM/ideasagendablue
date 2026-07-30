import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  usePermisosData,
  HORAS_PERMISOS,
  tipoLabel,
  hoyISO,
} from '../../services/permisosService';
import { type Permiso } from '../../api/permisos';
import { cn } from '../../utils/cn';

export function PermisosPage() {
  const navigate = useNavigate();
  const {
    puedeGestionar,
    sedes,
    sedeId,
    setSedeSelId,
    fecha,
    setFecha,
    modo,
    cambiarModo,
    profesionalIds,
    toggleProf,
    selectAllProfs,
    clearSelectedProfs,
    elegibles,
    desde,
    setDesde,
    hasta,
    setHasta,
    motivo,
    setMotivo,
    vacInicio,
    setVacInicio,
    vacFin,
    setVacFin,
    destinatario,
    setDestinatario,
    citasConflicto,
    pacientesAfectados,
    permisos,
    loadingPermisos,
    vacacionesVigentes,
    vacPreview,
    vacRangoOk,
    valido,
    enviando,
    enviar,
    eliminarMut,
    // Edit & delete vacacion
    editVac,
    setEditVac,
    editIni,
    setEditIni,
    editFin,
    setEditFin,
    editMotivo,
    setEditMotivo,
    eliminarVacMut,
    editarVacMut,
  } = usePermisosData();

  if (!puedeGestionar) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background text-on-surface-variant text-sm h-full">
        Solo la Coordinadora de Sedes (y el admin) pueden gestionar permisos.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
      {/* Header Bar */}
      <header className="flex justify-between items-center px-6 py-4 bg-surface-container-lowest border-b border-outline-variant/50 sticky top-0 z-20 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/herramientas')}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all"
            title="Volver a Herramientas"
          >
            <span className="material-symbols-outlined text-[20px]">arrow_back</span>
          </button>
          <div className="w-10 h-10 rounded-xl bg-error/10 text-error flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">block</span>
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-on-surface leading-tight">
              Permisos / Bloqueos
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant/80">
              Bloquea a una podóloga, fisioterapeuta o baropodometría en un rango horario
            </p>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 overflow-y-auto p-6 bg-background">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Bento Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Form Area (Left - 8 cols) */}
            <div className="lg:col-span-8 space-y-6">
              {/* Location Tabs Card */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-1.5 shadow-xs overflow-x-auto">
                <div className="flex items-center min-w-max gap-1">
                  {sedes.map((s) => {
                    const act = sedeId === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSedeSelId(s.id)}
                        className={cn(
                          'px-5 py-2 rounded-lg font-label-caps text-label-caps transition-all relative cursor-pointer',
                          act
                            ? 'bg-surface-container-high text-on-surface font-bold shadow-xs'
                            : 'hover:bg-surface-container-low text-on-surface-variant',
                        )}
                      >
                        {s.nombre}
                        {act && (
                          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-5 h-0.5 bg-primary rounded-t-full" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Main Form Card */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-6 shadow-xs space-y-6">
                {/* Date Selector (Día Único) - visible salvo en Vacaciones */}
                {modo !== 'vacaciones' && (
                  <div className="flex items-center justify-between pb-4 border-b border-outline-variant/40">
                    <span className="font-label-caps text-label-caps text-on-surface-variant font-bold uppercase tracking-wider">
                      FECHA DEL BLOQUEO
                    </span>
                    <div className="flex items-center gap-3 bg-surface-container-low border border-outline-variant/60 rounded-xl p-1 shadow-2xs">
                      <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-lowest border border-outline-variant/40 rounded-lg shadow-2xs">
                        <span className="material-symbols-outlined text-[18px] text-primary">
                          calendar_month
                        </span>
                        <input
                          type="date"
                          value={fecha}
                          onChange={(e) => e.target.value && setFecha(e.target.value)}
                          className="bg-transparent border-none text-xs font-semibold text-on-surface focus:ring-0 outline-none cursor-pointer"
                        />
                      </div>
                      <span className="text-xs text-on-surface-variant font-medium pr-2 capitalize">
                        {format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })}
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  {/* Block Type Radio Chips */}
                  <div>
                    <label className="block font-label-caps text-label-caps text-on-surface-variant mb-3 font-bold">
                      TIPO DE BLOQUEO
                    </label>
                    <div className="flex flex-wrap gap-2.5">
                      {[
                        { id: 'individual', label: '🚫 Permiso', icon: 'block' },
                        { id: 'enfermedad', label: '🤒 Enfermedad', icon: 'sick' },
                        { id: 'reunion', label: '🤝 Reunión', icon: 'groups' },
                        { id: 'vacaciones', label: '🌴 Vacaciones', icon: 'beach_access' },
                      ].map((opt) => {
                        const isSelected = modo === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => cambiarModo(opt.id as any)}
                            className={cn(
                              'px-4 py-2 rounded-full border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer',
                              isSelected
                                ? opt.id === 'enfermedad'
                                  ? 'bg-[#d97706] text-white border-[#d97706] shadow-xs'
                                  : opt.id === 'reunion'
                                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                  : opt.id === 'vacaciones'
                                  ? 'bg-teal-600 text-white border-teal-600 shadow-xs'
                                  : 'bg-rose-600 text-white border-rose-600 shadow-xs'
                                : 'bg-surface-container-lowest border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-low',
                            )}
                          >
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Professional Selection */}
                  {modo !== 'reunion' ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="block font-label-caps text-label-caps text-on-surface-variant font-bold">
                          {modo === 'enfermedad'
                            ? 'PROFESIONAL ENFERMO (SELECCIONAR UNO)'
                            : 'SELECCIONAR PROFESIONAL(ES)'}
                        </label>
                        {(modo === 'individual' || modo === 'vacaciones') &&
                          elegibles.length > 0 && (
                            <div className="flex items-center gap-3 text-xs">
                              <button
                                type="button"
                                onClick={selectAllProfs}
                                className="text-primary font-bold hover:underline cursor-pointer"
                              >
                                Marcar todos
                              </button>
                              {profesionalIds.length > 0 && (
                                <button
                                  type="button"
                                  onClick={clearSelectedProfs}
                                  className="text-on-surface-variant/70 hover:underline cursor-pointer"
                                >
                                  Ninguno
                                </button>
                              )}
                            </div>
                          )}
                      </div>

                      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-1.5 max-h-56 overflow-y-auto space-y-1 custom-scrollbar shadow-2xs">
                        {elegibles.map((p) => {
                          const marcado = profesionalIds.includes(p.id);
                          const iniciales = `${p.nombres[0] ?? ''}${
                            p.apellidos[0] ?? ''
                          }`.toUpperCase();

                          return (
                            <label
                              key={p.id}
                              onClick={() => toggleProf(p.id)}
                              className={cn(
                                'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors border',
                                marcado
                                  ? 'bg-primary/5 border-primary/30 shadow-2xs'
                                  : 'border-transparent hover:bg-surface-container-low/60',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={marcado}
                                onChange={() => {}} // handled by row onClick
                                className="w-4 h-4 rounded text-primary border-outline-variant focus:ring-primary/20 cursor-pointer"
                              />
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ backgroundColor: p.colorAvatar || '#0044ab' }}
                              >
                                {iniciales}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p
                                  className={cn(
                                    'font-body-md text-body-md truncate',
                                    marcado
                                      ? 'font-bold text-on-surface'
                                      : 'font-medium text-on-surface-variant',
                                  )}
                                >
                                  {p.nombres.split(' ')[0]} {p.apellidos.split(' ')[0]}
                                </p>
                                <p className="font-mono-label text-[10px] text-on-surface-variant/70 truncate">
                                  {tipoLabel(p.tipo)}
                                </p>
                              </div>
                            </label>
                          );
                        })}

                        {elegibles.length === 0 && (
                          <p className="text-xs text-on-surface-variant/60 p-3 text-center">
                            No hay profesionales bloqueables en esta sede.
                          </p>
                        )}
                      </div>

                      {modo === 'enfermedad' && profesionalIds.length > 0 && (
                        <p className="mt-2 text-xs text-[#d97706] font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">warning</span>
                          Se cancelarán sus citas en el rango y se bloqueará su agenda.
                        </p>
                      )}
                      {modo === 'individual' && profesionalIds.length > 0 && (
                        <p className="mt-2 text-xs text-on-surface-variant font-medium">
                          {profesionalIds.length} profesional(es) seleccionado(s) — se
                          bloquearán en el rango elegido.
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Reunión (Daniel/Yasica) */
                    <div className="space-y-3 bg-emerald-500/5 border border-emerald-500/20 p-4 rounded-xl">
                      <label className="block font-label-caps text-label-caps text-emerald-900 font-bold">
                        ¿PARA QUIÉN ES LA REUNIÓN?
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'daniel', label: 'Solo Daniel' },
                          { id: 'yasica', label: 'Solo Yasica' },
                          { id: 'ambos', label: 'Ambos juntos' },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setDestinatario(opt.id as any)}
                            className={cn(
                              'py-2 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer',
                              destinatario === opt.id
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                                : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant/60 hover:bg-surface-container-low',
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-emerald-800 leading-relaxed font-medium">
                        🤝 Se bloqueará el horario en{' '}
                        {destinatario === 'ambos' ? (
                          <>
                            las agendas de <b>Daniel Doy</b> y <b>Yasica Doy</b>
                          </>
                        ) : (
                          <>
                            la agenda de{' '}
                            <b>{destinatario === 'daniel' ? 'Daniel Doy' : 'Yasica Doy'}</b>
                          </>
                        )}{' '}
                        en su sede correspondiente.
                      </p>
                    </div>
                  )}

                  {/* Time Ranges or Date Ranges (Vacaciones) */}
                  {modo === 'vacaciones' ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 font-bold">
                          DESDE (FECHA)
                        </label>
                        <input
                          type="date"
                          value={vacInicio}
                          min={hoyISO()}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v) {
                              setVacInicio(v);
                              if (vacFin < v) setVacFin(v);
                            }
                          }}
                          className="w-full p-2.5 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                        />
                      </div>
                      <div>
                        <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 font-bold">
                          HASTA (FECHA)
                        </label>
                        <input
                          type="date"
                          value={vacFin}
                          min={vacInicio}
                          onChange={(e) => e.target.value && setVacFin(e.target.value)}
                          className="w-full p-2.5 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 font-bold">
                          DESDE (HORA)
                        </label>
                        <div className="relative">
                          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                            schedule
                          </span>
                          <select
                            value={desde}
                            onChange={(e) => setDesde(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none cursor-pointer appearance-none"
                          >
                            {HORAS_PERMISOS.slice(0, -1).map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-sm">
                            expand_more
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 font-bold">
                          HASTA (HORA)
                        </label>
                        <div className="relative">
                          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
                            schedule
                          </span>
                          <select
                            value={hasta}
                            onChange={(e) => setHasta(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none cursor-pointer appearance-none"
                          >
                            {HORAS_PERMISOS.filter((h) => h > desde).map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-sm">
                            expand_more
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Reason Input */}
                  <div>
                    <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 font-bold">
                      {modo === 'reunion' ? 'TEXTO DE LA REUNIÓN' : 'MOTIVO'}
                    </label>
                    <input
                      type="text"
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder={
                        modo === 'reunion'
                          ? 'Ej: Reunión de coordinación mensual'
                          : modo === 'enfermedad'
                          ? 'Enfermedad (por defecto)'
                          : modo === 'vacaciones'
                          ? 'Vacaciones (por defecto)'
                          : 'Permiso médico, trámite personal...'
                      }
                      className="w-full p-3 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-medium text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none placeholder:text-on-surface-variant/50"
                      maxLength={200}
                    />
                  </div>

                  {/* Notice Banner - Enfermedad con color #d97706 específico solicitado por el usuario */}
                  {modo === 'enfermedad' && (
                    <div className="rounded-xl border border-[#d97706]/40 bg-[#d97706]/10 p-4 text-xs font-semibold text-[#d97706] leading-relaxed shadow-2xs">
                      🤒 Al reportar la enfermedad se cancelarán automáticamente las citas activas
                      del profesional entre {desde} y {hasta}, y se bloqueará su agenda ese rango.
                      Los pacientes afectados aparecerán listados para que los contactes y reagendes.
                    </div>
                  )}

                  {/* Vacaciones preview check */}
                  {modo === 'vacaciones' &&
                    (profesionalIds.length === 0 || !vacRangoOk ? (
                      <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-3.5 text-xs text-on-surface-variant leading-relaxed">
                        🌴 Elige profesional(es) y un rango de fechas. Se bloqueará el{' '}
                        <b>día completo</b> (08:00–20:00) de cada fecha. El sistema verifica que no
                        haya citas antes de permitir el bloqueo — <b>no se cancela nada</b>.
                      </div>
                    ) : vacPreview.isFetching ? (
                      <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-3.5 text-xs text-on-surface-variant flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        Revisando disponibilidad en el rango...
                      </div>
                    ) : vacPreview.isError ? (
                      <div className="rounded-xl border border-error/30 bg-error/10 p-3.5 text-xs text-error font-semibold">
                        No se pudo revisar el rango. Reintenta.
                      </div>
                    ) : vacPreview.data ? (
                      <div
                        className={cn(
                          'rounded-xl border p-4 space-y-2.5',
                          vacPreview.data.ok
                            ? 'border-teal-500/30 bg-teal-500/10'
                            : 'border-error/30 bg-error/10',
                        )}
                      >
                        <p
                          className={cn(
                            'text-xs font-bold flex items-center justify-between gap-2',
                            vacPreview.data.ok ? 'text-teal-900' : 'text-error',
                          )}
                        >
                          <span>
                            {vacPreview.data.ok
                              ? '✓ Todo libre — se puede bloquear'
                              : '✗ Hay citas en el rango'}
                          </span>
                          <span className="font-semibold text-on-surface-variant">
                            {vacPreview.data.dias} día(s) · {vacPreview.data.profesionales.length}{' '}
                            prof.
                          </span>
                        </p>
                        <ul className="space-y-1.5">
                          {vacPreview.data.profesionales.map((pr) => (
                            <li
                              key={pr.profesionalId}
                              className={cn(
                                'rounded-lg border px-3 py-2 text-xs bg-surface-container-lowest',
                                pr.bloqueable ? 'border-teal-500/30' : 'border-error/30',
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-on-surface">{pr.nombre}</span>
                                <span
                                  className={cn(
                                    'font-bold',
                                    pr.bloqueable ? 'text-teal-700' : 'text-error',
                                  )}
                                >
                                  {pr.bloqueable
                                    ? 'Libre ✓'
                                    : `${pr.conflictos.length} cita(s) ✗`}
                                </span>
                              </div>
                              {pr.conflictos.length > 0 && (
                                <ul className="mt-1.5 space-y-1 text-on-surface-variant/80 text-[11px]">
                                  {pr.conflictos.slice(0, 5).map((c, i) => (
                                    <li key={i} className="flex items-center gap-2 font-mono">
                                      <span>
                                        {c.fecha} {c.horaInicio}
                                      </span>
                                      <span className="font-sans font-medium truncate">
                                        {c.paciente}
                                      </span>
                                      <span className="font-sans text-on-surface-variant/60 truncate">
                                        {c.servicio}
                                      </span>
                                    </li>
                                  ))}
                                  {pr.conflictos.length > 5 && (
                                    <li className="text-on-surface-variant/60 italic font-sans">
                                      …y {pr.conflictos.length - 5} más
                                    </li>
                                  )}
                                </ul>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null)}

                  {/* Main Action Button */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => navigate('/herramientas')}
                      className="px-6 py-2.5 rounded-xl border border-outline-variant/70 text-on-surface font-body-md font-semibold hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={enviar}
                      disabled={!valido || enviando}
                      style={
                        modo === 'enfermedad'
                          ? { backgroundColor: '#d97706' }
                          : undefined
                      }
                      className={cn(
                        'px-6 py-2.5 rounded-xl font-body-md font-bold text-white shadow-xs transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                        modo === 'reunion'
                          ? 'bg-emerald-600 hover:bg-emerald-700'
                          : modo === 'enfermedad'
                          ? 'hover:opacity-90'
                          : modo === 'vacaciones'
                          ? 'bg-teal-600 hover:bg-teal-700'
                          : 'bg-rose-600 hover:bg-rose-700',
                      )}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {modo === 'reunion'
                          ? 'groups'
                          : modo === 'enfermedad'
                          ? 'sick'
                          : modo === 'vacaciones'
                          ? 'beach_access'
                          : 'block'}
                      </span>
                      <span>
                        {enviando
                          ? 'Procesando...'
                          : modo === 'reunion'
                          ? destinatario === 'ambos'
                            ? 'Agendar reunión en ambas agendas'
                            : `Agendar reunión de ${
                                destinatario === 'daniel' ? 'Daniel' : 'Yasica'
                              }`
                          : modo === 'enfermedad'
                          ? 'Reportar enfermedad y liberar el día'
                          : modo === 'vacaciones'
                          ? `Bloquear vacaciones${
                              profesionalIds.length > 1 ? ` (${profesionalIds.length})` : ''
                            }`
                          : `Bloquear horario${
                              profesionalIds.length > 1 ? ` (${profesionalIds.length})` : ''
                            }`}
                      </span>
                    </button>
                  </div>

                  {/* Conflict list */}
                  {citasConflicto.length > 0 && (
                    <div className="rounded-xl border border-error/30 bg-error/10 p-4 space-y-2">
                      <p className="text-xs font-bold text-error">
                        No se pudo bloquear por citas existentes ({citasConflicto.length} cita(s)).
                        Reprograma o cancela primero:
                      </p>
                      <ul className="space-y-1">
                        {citasConflicto.map((c, i) => (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-2 text-xs bg-surface-container-lowest border border-error/20 rounded-lg p-2 font-medium"
                          >
                            <span className="font-bold text-on-surface font-mono">
                              {c.horaInicio}
                            </span>
                            <span className="flex-1 text-on-surface truncate font-semibold">
                              {c.paciente}
                            </span>
                            <span className="text-on-surface-variant/70 truncate">
                              {c.servicio}
                            </span>
                            <span className="text-on-surface-variant font-mono">
                              {c.telefono}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Affected Patients Banner */}
                  {pacientesAfectados && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                      <p className="text-xs font-bold text-emerald-900">
                        {pacientesAfectados.length > 0
                          ? `Día liberado · ${pacientesAfectados.length} cita(s) cancelada(s). Contacta a estos pacientes para reagendar:`
                          : 'Día liberado. El profesional no tenía citas en el rango.'}
                      </p>
                      {pacientesAfectados.length > 0 && (
                        <ul className="space-y-1">
                          {pacientesAfectados.map((c, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between gap-2 text-xs bg-surface-container-lowest border border-emerald-500/20 rounded-lg p-2"
                            >
                              <span className="font-bold text-on-surface font-mono">
                                {c.horaInicio}
                              </span>
                              <span className="flex-1 text-on-surface font-semibold truncate">
                                {c.paciente}
                              </span>
                              <span className="text-on-surface-variant/70 truncate">
                                {c.servicio}
                              </span>
                              <a
                                href={`tel:${c.telefono}`}
                                className="text-emerald-700 font-bold hover:underline"
                              >
                                {c.telefono}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Side Panel (Right - 4 cols) - Permisos del Día & Vacaciones Vigentes */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-5 shadow-xs flex flex-col h-full space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40">
                  <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[20px]">
                      view_agenda
                    </span>
                    <span>
                      {modo === 'vacaciones' ? 'Vacaciones Vigentes' : 'Permisos del Día'}
                    </span>
                  </h3>
                  <span className="bg-surface-container-high text-on-surface-variant font-mono-label text-[11px] font-bold px-2 py-0.5 rounded">
                    {modo === 'vacaciones' ? 'Total' : format(parseISO(fecha), 'dd MMM')}
                  </span>
                </div>

                {/* List of Vacaciones Vigentes when mode === 'vacaciones' */}
                {modo === 'vacaciones' ? (
                  <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
                    {vacacionesVigentes.isLoading ? (
                      <div className="flex justify-center py-8">
                        <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : (vacacionesVigentes.data ?? []).length === 0 ? (
                      <p className="text-xs text-on-surface-variant/60 text-center py-8">
                        No hay vacaciones registradas.
                      </p>
                    ) : (
                      (vacacionesVigentes.data ?? []).map((v) => {
                        const editando = editVac?.ids[0] === v.ids[0];
                        const iniciales = `${v.profesional.nombres[0] ?? ''}${
                          v.profesional.apellidos[0] ?? ''
                        }`.toUpperCase();

                        return (
                          <div
                            key={v.ids[0]}
                            className="p-3.5 bg-teal-500/10 border border-teal-500/30 rounded-xl space-y-2"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{
                                  backgroundColor: v.profesional.colorAvatar ?? '#14b8a6',
                                }}
                              >
                                {iniciales}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-on-surface truncate">
                                  {v.profesional.nombres.split(' ')[0]}{' '}
                                  {v.profesional.apellidos.split(' ')[0]}
                                </p>
                                <p className="text-[11px] text-teal-800 font-semibold">
                                  🌴 {format(parseISO(v.fechaInicio), 'd MMM', { locale: es })} –{' '}
                                  {format(parseISO(v.fechaFin), 'd MMM yyyy', { locale: es })} ·{' '}
                                  {v.dias} día(s)
                                </p>
                                <p className="text-[11px] text-on-surface-variant/70 truncate">
                                  {v.motivo}
                                </p>
                              </div>
                              {!editando && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => {
                                      setEditVac({ ids: v.ids, sedeId: v.sedeId ?? '' });
                                      setEditIni(v.fechaInicio);
                                      setEditFin(v.fechaFin);
                                      setEditMotivo(v.motivo);
                                    }}
                                    className="p-1.5 text-xs font-bold text-teal-800 hover:bg-teal-500/20 rounded-lg transition-colors cursor-pointer"
                                    title="Editar vacación"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">
                                      edit
                                    </span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (
                                        window.confirm(
                                          `¿Eliminar las vacaciones de ${
                                            v.profesional.nombres.split(' ')[0]
                                          } (${v.dias} día(s))?`,
                                        )
                                      )
                                        eliminarVacMut.mutate(v.ids);
                                    }}
                                    disabled={eliminarVacMut.isPending}
                                    className="p-1.5 text-on-surface-variant/60 hover:text-error hover:bg-error/10 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                    title="Eliminar vacación"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">
                                      delete
                                    </span>
                                  </button>
                                </div>
                              )}
                            </div>

                            {editando && (
                              <div className="mt-3 pt-3 border-t border-teal-500/30 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase">
                                      Desde
                                    </label>
                                    <input
                                      type="date"
                                      value={editIni}
                                      onChange={(e) => setEditIni(e.target.value)}
                                      className="w-full p-1.5 bg-surface-container-lowest border border-outline-variant/60 rounded-lg text-xs font-semibold text-on-surface"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-on-surface-variant mb-1 uppercase">
                                      Hasta
                                    </label>
                                    <input
                                      type="date"
                                      value={editFin}
                                      min={editIni}
                                      onChange={(e) => setEditFin(e.target.value)}
                                      className="w-full p-1.5 bg-surface-container-lowest border border-outline-variant/60 rounded-lg text-xs font-semibold text-on-surface"
                                    />
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  value={editMotivo}
                                  onChange={(e) => setEditMotivo(e.target.value)}
                                  placeholder="Motivo"
                                  className="w-full p-1.5 bg-surface-container-lowest border border-outline-variant/60 rounded-lg text-xs text-on-surface"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() =>
                                      editarVacMut.mutate({
                                        ids: v.ids,
                                        sedeId: v.sedeId ?? '',
                                        fechaInicio: editIni,
                                        fechaFin: editFin,
                                        motivo: editMotivo.trim() || 'Vacaciones',
                                      })
                                    }
                                    disabled={
                                      editarVacMut.isPending ||
                                      !editIni ||
                                      !editFin ||
                                      editFin < editIni ||
                                      !v.sedeId
                                    }
                                    className="flex-1 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold py-1.5 rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
                                  >
                                    {editarVacMut.isPending ? 'Guardando...' : 'Guardar'}
                                  </button>
                                  <button
                                    onClick={() => setEditVac(null)}
                                    className="px-3 text-xs font-medium text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors cursor-pointer"
                                  >
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : (
                  /* List of Permisos del Día for active fecha */
                  <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar pr-1">
                    {loadingPermisos ? (
                      <div className="flex justify-center py-8">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : permisos.length === 0 ? (
                      <p className="text-xs text-on-surface-variant/60 text-center py-8">
                        Sin permisos registrados para este día.
                      </p>
                    ) : (
                      permisos.map((p: Permiso) => {
                        const iniciales = `${p.profesional.nombres[0] ?? ''}${
                          p.profesional.apellidos[0] ?? ''
                        }`.toUpperCase();
                        const reunion = !!p.esReunion;
                        const vacaciones = !!p.esVacaciones;
                        const enfermedad =
                          !!p.esEnfermedad ||
                          p.motivo?.toLowerCase().includes('enfermedad') ||
                          p.motivo?.startsWith('🤒');

                        return (
                          <div
                            key={p.id}
                            className={cn(
                              'p-3.5 bg-surface-container-low border border-outline-variant/50 rounded-xl space-y-2 hover:border-outline-variant transition-colors group relative',
                            )}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-2xs"
                                  style={{
                                    backgroundColor: p.profesional.colorAvatar || '#0044ab',
                                  }}
                                >
                                  {iniciales}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-body-md text-xs font-bold text-on-surface leading-tight truncate">
                                    {p.profesional.nombres.split(' ')[0]}{' '}
                                    {p.profesional.apellidos.split(' ')[0]}
                                  </p>
                                  <p className="font-mono-label text-[10px] text-on-surface-variant/70 truncate">
                                    {tipoLabel(p.profesional.tipo)}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => eliminarMut.mutate(p.id)}
                                disabled={eliminarMut.isPending}
                                className="text-on-surface-variant/50 hover:text-error transition-colors p-1 rounded hover:bg-surface-container-high cursor-pointer disabled:opacity-50"
                                title="Eliminar bloqueo"
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  delete
                                </span>
                              </button>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-label-caps text-[10px] font-bold leading-none',
                                  vacaciones
                                    ? 'bg-teal-500/20 text-teal-800'
                                    : reunion
                                    ? 'bg-emerald-500/20 text-emerald-800'
                                    : enfermedad
                                    ? 'bg-[#d97706]/20 text-[#b45309]'
                                    : 'bg-rose-500/20 text-rose-800',
                                )}
                              >
                                {vacaciones
                                  ? '🌴 Vacaciones'
                                  : reunion
                                  ? '🤝 Reunión'
                                  : enfermedad
                                  ? '🤒 Enfermedad'
                                  : '🚫 Permiso'}
                              </span>
                              <span className="font-mono-label text-[11px] font-bold text-on-surface-variant flex items-center gap-1">
                                <span className="material-symbols-outlined text-[14px]">
                                  schedule
                                </span>
                                {p.horaInicio} – {p.horaFin}
                              </span>
                            </div>

                            <div className="pt-1.5 border-t border-outline-variant/30">
                              <p className="text-[11px] text-on-surface-variant font-medium truncate">
                                {p.motivo}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
