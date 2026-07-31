import { useCompetenciasData } from '../../services/competenciasService';
import { AdminHeaderNav } from './AdminHeaderNav';
import { cn } from '../../utils/cn';

// ── Helpers de presentación ──────────────────────────────────────────────────

/** Ícono material representativo según el nombre del servicio. */
function iconoDeServicio(nombre: string): string {
  const n = nombre.toLowerCase();
  if (n.includes('profilaxis')) return 'spa';
  if (n.includes('láser') || n.includes('laser')) return 'bolt';
  if (n.includes('matrisec')) return 'content_cut';
  if (n.includes('curación') || n.includes('curacion')) return 'healing';
  if (n.includes('evaluac')) return 'medical_information';
  if (n.includes('extracción') || n.includes('extraccion')) return 'medical_services';
  if (n.includes('bleom')) return 'science';
  if (n.includes('infilt')) return 'vaccines';
  if (n.includes('baro')) return 'monitor_heart';
  if (n.includes('ortésic') || n.includes('ortesic') || n.includes('ortoniquia')) return 'stethoscope';
  return 'health_and_safety';
}

/** Traduce un color hex del servicio a un tint suave (bg) + borde. */
function tintDeColor(hex?: string): { background: string; borderColor: string } {
  if (!hex) return { background: 'rgba(0, 68, 171, 0.10)', borderColor: 'rgba(0, 68, 171, 0.30)' };
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return {
    background: `rgba(${r}, ${g}, ${b}, 0.15)`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}

// ── Página ───────────────────────────────────────────────────────────────────

export function CompetenciasPage() {
  const {
    sedes,
    filtroProf,
    setFiltroProf,
    sedeIdFiltro,
    setSedeIdFiltro,
    unidadFiltro,
    setUnidadFiltro,
    pendientes,
    toggle,
    tieneCompetencia,
    profsFiltrados,
    unidades,
    servsFiltrados,
    toggleFila,
    toggleColumna,
    totalCeldas,
    totalActivas,
    pct,
  } = useCompetenciasData();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Filtros (como el original) */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Sede</label>
            <select className="input text-sm" value={sedeIdFiltro} onChange={e => setSedeIdFiltro(e.target.value)}>
              <option value="todas">Todas las sedes</option>
              {sedes?.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Área</label>
            <select className="input text-sm" value={unidadFiltro} onChange={e => setUnidadFiltro(e.target.value)}>
              <option value="todas">Todas las áreas</option>
              {unidades.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar profesional</label>
            <input className="input text-sm w-52" placeholder="Nombre..." value={filtroProf} onChange={e => setFiltroProf(e.target.value)} />
          </div>
          <div className="flex-1" />
          {/* Resumen cobertura */}
          <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-2">
            <div>
              <p className="text-xs text-slate-500">Cobertura</p>
              <p className="text-sm font-bold text-slate-800">{totalActivas}/{totalCeldas} competencias</p>
            </div>
            <div className="w-24">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-primary font-semibold text-right mt-0.5">{pct}%</p>
            </div>
          </div>
        </div>

        {profsFiltrados.length === 0 || servsFiltrados.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-container-low grid place-items-center mx-auto mb-3">
              <span className="material-symbols-outlined text-3xl text-on-surface-variant">search_off</span>
            </div>
            <p className="text-base font-bold text-on-surface">Sin resultados</p>
            <p className="text-sm text-on-surface-variant mt-1">Ajusta los filtros para ver profesionales y servicios.</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
            <div className="overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <table className="text-sm border-collapse w-full">
                <thead>
                  <tr>
                    {/* Esquina: columna Profesional angosta */}
                    <th className="sticky left-0 top-0 z-40 bg-surface-container-low border-b border-r border-outline-variant/40 px-3 py-3 w-[200px] min-w-[200px] max-w-[200px] text-left">
                      <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Profesional</p>
                      <p className="text-[10px] text-on-surface-variant/70 mt-0.5">
                        {profsFiltrados.length} prof · {servsFiltrados.length} serv
                      </p>
                    </th>

                    {/* Columnas de servicios */}
                    {servsFiltrados.map(s => {
                      const todosActivos = profsFiltrados.every(p => tieneCompetencia(p.id, s.id));
                      const tint = tintDeColor(s.color);
                      return (
                        <th key={s.id} className="sticky top-0 z-30 bg-surface-container-lowest border-b border-outline-variant/40 px-2 py-3 min-w-[110px]">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-8 h-8 rounded-lg border grid place-items-center shrink-0" style={tint}>
                              <span className="material-symbols-outlined text-base" style={{ color: s.color || '#0044ab' }}>
                                {iconoDeServicio(s.nombre)}
                              </span>
                            </div>
                            <div className="text-center leading-tight">
                              <p className="text-xs font-bold text-on-surface truncate max-w-[90px]" title={s.nombre}>
                                {s.nombre}
                              </p>
                              <p className="text-[10px] text-on-surface-variant/70 font-mono">{s.duracionMinutos} min</p>
                            </div>
                            <button
                              onClick={() => toggleColumna(s.id, !todosActivos, s.nombre)}
                              className={cn(
                                'mt-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition',
                                todosActivos
                                  ? 'border-red-300/50 bg-red-50 text-red-700 hover:bg-red-100'
                                  : 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20',
                              )}
                            >
                              {todosActivos ? 'Quitar todas' : 'Agregar todas'}
                            </button>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {profsFiltrados.map(prof => {
                    const todosActivos = servsFiltrados.every(s => tieneCompetencia(prof.id, s.id));
                    const count = servsFiltrados.filter(s => tieneCompetencia(prof.id, s.id)).length;
                    const nombreCorto = `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`;
                    const enVacaciones = (prof as unknown as { enVacaciones?: boolean }).enVacaciones ?? false;

                    // Color del chip contador según cobertura del profesional
                    const chipCount =
                      count === servsFiltrados.length && count > 0
                        ? 'bg-primary/10 text-primary'
                        : count > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-surface-container text-on-surface-variant';

                    return (
                      <tr
                        key={prof.id}
                        className={cn(
                          'group transition-colors',
                          enVacaciones ? 'bg-amber-50/50 hover:bg-amber-100/40' : 'hover:bg-primary/5',
                        )}
                      >
                        {/* Columna nombre profesional */}
                        <td
                          className={cn(
                            'sticky left-0 z-20 border-b border-r border-outline-variant/30 px-3 py-2.5 w-[200px] min-w-[200px] max-w-[200px]',
                            enVacaciones
                              ? 'bg-amber-50 group-hover:bg-amber-100/60'
                              : 'bg-surface-container-lowest group-hover:bg-primary/5',
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className={cn(
                                'w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-[11px] shadow-sm shrink-0',
                                enVacaciones && 'grayscale-[30%]',
                              )}
                              style={{ backgroundColor: prof.colorAvatar || '#0044ab' }}
                            >
                              {prof.iniciales}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-bold text-on-surface leading-tight truncate">
                                {nombreCorto}
                              </p>
                              <div className="flex items-center gap-1 mt-0.5">
                                {enVacaciones && (
                                  <span
                                    className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300/50 px-1.5 py-0.5 rounded-full"
                                    title="En vacaciones"
                                  >
                                    🌴
                                  </span>
                                )}
                                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', chipCount)}>
                                  {count}/{servsFiltrados.length}
                                </span>
                                <button
                                  onClick={() => toggleFila(prof.id, !todosActivos, nombreCorto)}
                                  className={cn(
                                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wider transition',
                                    todosActivos
                                      ? 'text-red-700 bg-red-50 border-red-200/70 hover:bg-red-100'
                                      : 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/20',
                                  )}
                                >
                                  {todosActivos ? 'Quitar' : 'Agregar'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Celdas de competencia */}
                        {servsFiltrados.map(srv => {
                          const activa = tieneCompetencia(prof.id, srv.id);
                          const key = `${prof.id}::${srv.id}`;
                          const isPending = !!pendientes[key];

                          return (
                            <td key={srv.id} className="border-b border-outline-variant/20 text-center py-2.5 px-2">
                              <button
                                onClick={() => !isPending && toggle(prof.id, srv.id, !activa)}
                                disabled={isPending}
                                title={
                                  activa
                                    ? `Quitar "${srv.nombre}" de ${nombreCorto}`
                                    : `Agregar "${srv.nombre}" a ${nombreCorto}`
                                }
                                className={cn(
                                  'cell-btn w-9 h-9 rounded-full border-2 grid place-items-center mx-auto',
                                  enVacaciones && 'opacity-70',
                                  isPending
                                    ? 'bg-primary/40 text-white border-primary/40 cursor-wait'
                                    : activa
                                    ? 'active bg-primary text-white border-primary shadow-md shadow-primary/20'
                                    : 'bg-surface-container-low border-outline-variant/40 text-outline-variant hover:border-primary/50 hover:bg-primary/5 hover:text-primary',
                                )}
                                aria-label={`${activa ? 'Quitar' : 'Agregar'} ${srv.nombre}`}
                              >
                                {isPending ? (
                                  <span className="material-symbols-outlined text-lg animate-spin">progress_activity</span>
                                ) : activa ? (
                                  <>
                                    <span className="material-symbols-outlined text-lg icon-check">check</span>
                                    <span className="material-symbols-outlined text-lg icon-remove">close</span>
                                  </>
                                ) : (
                                  <span className="material-symbols-outlined text-lg">add</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Instrucción + leyenda */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Haz clic en una celda para agregar o quitar la competencia. Hover sobre una celda azul la marca en rojo = quitar. Usa los botones de fila/columna para operaciones masivas.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-primary shadow-sm" />
              <span className="font-semibold">Puede atender</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-4 h-4 rounded-full bg-surface-container-low border-2 border-outline-variant/40" />
              <span className="font-semibold">No configurado</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-400" />
              <span className="font-semibold">Vacaciones</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
