import { useCompetenciasData } from '../../services/competenciasService';
import { AdminHeaderNav } from './AdminHeaderNav';
import { Avatar } from '../../components/ui/Avatar';
import { cn } from '../../utils/cn';

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
        {/* Filtros */}
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
                <div className="h-full bg-limablue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-limablue-700 font-semibold text-right mt-0.5">{pct}%</p>
            </div>
          </div>
        </div>

        {profsFiltrados.length === 0 || servsFiltrados.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <p className="text-lg mb-1">Sin resultados</p>
            <p className="text-sm">Ajusta los filtros para ver profesionales y servicios.</p>
          </div>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-320px)] bg-white rounded-xl border border-slate-200">
            <table className="text-sm border-collapse w-full">
              <thead>
                <tr>
                  {/* Celda esquina */}
                  <th className="sticky left-0 top-0 z-30 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 min-w-[200px]">
                    <span className="text-xs text-slate-400 font-normal">
                      {profsFiltrados.length} prof. · {servsFiltrados.length} servicios
                    </span>
                  </th>
                  {servsFiltrados.map(s => {
                    const todosActivos = profsFiltrados.every(p => tieneCompetencia(p.id, s.id));
                    return (
                      <th key={s.id} className="sticky top-0 z-20 bg-white border-b border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 min-w-[110px]">
                        <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ backgroundColor: s.color }} />
                        <div className="truncate text-center leading-tight">{s.nombre}</div>
                        <div className="text-slate-400 font-normal text-center">{s.duracionMinutos}min</div>
                        {/* Bulk columna */}
                        <button
                          onClick={() => toggleColumna(s.id, !todosActivos, s.nombre)}
                          className={cn(
                            'mt-1.5 mx-auto block text-xxs px-2 py-0.5 rounded-full border transition-all',
                            todosActivos
                              ? 'border-red-200 text-red-500 hover:bg-red-50'
                              : 'border-limablue-200 text-limablue-600 hover:bg-limablue-50'
                          )}
                        >
                          {todosActivos ? 'Quitar todas' : 'Agregar todas'}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {profsFiltrados.map(prof => {
                  const todosActivos = servsFiltrados.every(s => tieneCompetencia(prof.id, s.id));
                  const algunoActivo = servsFiltrados.some(s => tieneCompetencia(prof.id, s.id));
                  const count = servsFiltrados.filter(s => tieneCompetencia(prof.id, s.id)).length;

                  return (
                    <tr key={prof.id} className="hover:bg-slate-50/70 group">
                      {/* Nombre profesional + bulk fila */}
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50/70 border-b border-r border-slate-200 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar iniciales={prof.iniciales} color={prof.colorAvatar} size="xs" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-slate-800 leading-tight truncate">
                              {prof.nombres.split(' ')[0]} {prof.apellidos.split(' ')[0]}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-xxs text-slate-400">{count}/{servsFiltrados.length}</span>
                              <button
                                onClick={() => toggleFila(prof.id, !todosActivos, `${prof.nombres.split(' ')[0]} ${prof.apellidos.split(' ')[0]}`)}
                                className={cn(
                                  'text-xxs px-1.5 py-0.5 rounded-full border transition-all',
                                  todosActivos
                                    ? 'border-red-200 text-red-500 hover:bg-red-50'
                                    : algunoActivo
                                    ? 'border-amber-200 text-amber-600 hover:bg-amber-50'
                                    : 'border-limablue-200 text-limablue-600 hover:bg-limablue-50'
                                )}
                              >
                                {todosActivos ? 'Quitar todas' : 'Agregar todas'}
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
                          <td key={srv.id} className="border-b border-slate-100 text-center py-2 px-1">
                            <button
                              onClick={() => !isPending && toggle(prof.id, srv.id, !activa)}
                              disabled={isPending}
                              title={activa ? `Quitar "${srv.nombre}" de ${prof.nombres}` : `Agregar "${srv.nombre}" a ${prof.nombres}`}
                              className={cn(
                                'w-7 h-7 rounded-lg transition-all border flex items-center justify-center mx-auto',
                                isPending && 'opacity-50 cursor-wait',
                                activa
                                  ? 'bg-limablue-500 border-limablue-600 text-white hover:bg-red-500 hover:border-red-600'
                                  : 'bg-white border-slate-200 hover:border-limablue-400 hover:bg-limablue-50'
                              )}
                              aria-label={`${activa ? 'Quitar' : 'Agregar'} ${srv.nombre}`}
                            >
                              {isPending ? (
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                                </svg>
                              ) : activa ? (
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <svg className="w-3 h-3 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
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
        )}

        <p className="text-xs text-slate-400">
          Haz clic en una celda para agregar o quitar la competencia. Hover sobre una celda azul la marca en rojo = quitar.
          Usa los botones de fila/columna para operaciones masivas.
        </p>
      </div>
    </div>
  );
}
