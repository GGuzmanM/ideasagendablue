import { useNavigate } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { type PersonaRoster, type SedeComposicion } from '../../api/composicionSede';
import {
  useComposicionSede,
  barraGantt,
  marcasEscala,
  esCoberturaPersona,
  etiquetaMotivo,
  iniciales,
  colorAvatar,
  totalPersonasSede,
  coberturasSede,
  CARGOS,
  type CargoMeta,
} from '../../services/composicionSedeService';

// ── Fila de persona en el timeline ───────────────────────────────────────────
function FilaPersona({ p, meta, dias }: { p: PersonaRoster; meta: CargoMeta; dias: number }) {
  const bar = barraGantt(p, dias);
  const cobertura = esCoberturaPersona(p);
  const etiquetaBarra = `${bar.diaDesde} — ${bar.diaHasta}${p.indefinido ? ' · indefinido' : ''}`;
  const mostrarTexto = bar.widthPct >= 22;

  return (
    <div className={cn('flex items-center px-4 py-2.5 transition', cobertura ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-surface-container-low/50')}>
      {/* Identidad */}
      <div className="w-60 shrink-0 flex items-center gap-2.5 min-w-0 pr-3">
        <span
          className="w-8 h-8 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0"
          style={{ backgroundColor: colorAvatar(p.nombre) }}
        >
          {iniciales(p.nombre)}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-on-surface truncate" title={p.nombre}>{p.nombre}</p>
          {cobertura ? (
            <p className="text-[10px] font-bold text-amber-700 flex items-center gap-0.5 truncate" title={etiquetaMotivo(p.motivo)}>
              <span className="material-symbols-outlined text-xs">swap_horiz</span>
              Cobertura · {etiquetaMotivo(p.motivo)}
            </p>
          ) : (
            <p className="text-[10px] text-on-surface-variant truncate">{p.notas || meta.subtitulo}</p>
          )}
        </div>
      </div>

      {/* Barra del mes */}
      <div className="flex-1 relative h-7 gantt-track rounded-lg">
        <div
          className={cn(
            'absolute inset-y-1 rounded-full flex items-center px-2.5 overflow-hidden',
            cobertura ? 'bg-amber-400' : bar.completo ? meta.barFull : meta.barPart,
          )}
          style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
          title={`${p.nombre}: ${p.desde} — ${p.hasta}${p.indefinido ? ' (indefinido)' : ''}${cobertura ? ` · Cobertura (${etiquetaMotivo(p.motivo)})` : ''}`}
        >
          {mostrarTexto && (
            <span className={cn('text-[10px] font-bold truncate', cobertura ? 'text-amber-950' : bar.completo ? 'text-white' : meta.barPartText)}>
              {etiquetaBarra}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Grupo de cargo dentro del panel de la sede ───────────────────────────────
function GrupoCargo({ sede, meta, dias }: { sede: SedeComposicion; meta: CargoMeta; dias: number }) {
  const personas = sede[meta.key];
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('material-symbols-outlined text-lg', meta.text)}>{meta.icon}</span>
        <h3 className={cn('text-xs font-bold uppercase tracking-wider', meta.text)}>{meta.titulo}</h3>
        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', personas.length > 0 ? meta.chipBg : 'bg-surface-container text-on-surface-variant')}>
          {personas.length}
        </span>
        <span className="text-[10px] text-on-surface-variant italic ml-1">· {meta.fuente}</span>
      </div>

      {personas.length === 0 ? (
        <div className="border border-dashed border-outline-variant/40 rounded-2xl py-5 text-center">
          <p className="text-xs text-on-surface-variant/60 italic">Sin {meta.titulo.toLowerCase()} este mes en esta sede</p>
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl divide-y divide-outline-variant/20 overflow-hidden">
          {personas.map((p, i) => (
            <FilaPersona key={`${p.id}-${i}`} p={p} meta={meta} dias={dias} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export function ComposicionSedePage() {
  const navigate = useNavigate();
  const {
    puedeGestionar,
    mesAnterior, mesSiguiente, etiquetaMesActual, dias,
    vista, setVista,
    setSedeSelId, sedeSeleccionada,
    comp, sedesComp, isLoading,
    colorPorSede,
    sedes, recepcionistas, asignaciones,
    totales,
    sedeDeRecepcionista,
    modalAsignarOpen, setModalAsignarOpen,
    modalRecepOpen, setModalRecepOpen,
    nuevoNombre, setNuevoNombre, crearRecMut, eliminarRecMut,
    cargo, setCargo, personaId, setPersonaId, sedeAsig, setSedeAsig,
    desde, setDesde, hasta, setHasta, notas, setNotas,
    opciones, asignacionValida, crearAsigMut, eliminarAsigMut,
    abrirImprimible,
  } = useComposicionSede();

  if (!puedeGestionar) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface text-on-surface-variant text-sm">
        Solo la Coordinadora de Sedes (y el admin) pueden ver la composición de sedes.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface" data-testid="composicion-sede-page">
      {/* Estilo local: rejilla semanal del gantt */}
      <style>{`
        .gantt-track {
          background-image: repeating-linear-gradient(to right, rgba(199,196,216,.35) 0 1px, transparent 1px calc(100%/${dias}*7));
          background-position: left;
        }
      `}</style>

      {/* ── Header ── */}
      <header className="px-8 py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">

          <button
            onClick={() => navigate('/herramientas')}
            className="w-9 h-9 rounded-xl grid place-items-center text-on-surface-variant hover:bg-surface-container transition"
            title="Volver a Herramientas"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="w-11 h-11 rounded-xl bg-primary/10 grid place-items-center shrink-0">
            <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>apartment</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-on-surface tracking-tight whitespace-nowrap">Composición de sedes</h1>
            <p className="text-sm text-on-surface-variant truncate hidden lg:block">Línea de tiempo del personal de cada sede durante el mes</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Navegador de mes */}
          <div className="inline-flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl overflow-hidden shadow-sm">
            <button onClick={mesAnterior} className="w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container transition" title="Mes anterior">
              <span className="material-symbols-outlined text-base">chevron_left</span>
            </button>
            <div className="flex items-center gap-2 px-3 h-9 border-x border-outline-variant/40">
              <span className="material-symbols-outlined text-base text-primary">calendar_month</span>
              <span className="text-sm font-semibold text-on-surface capitalize whitespace-nowrap" data-testid="comp-mes-label">{etiquetaMesActual}</span>
            </div>
            <button onClick={mesSiguiente} className="w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container transition" title="Mes siguiente">
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>

          <button
            onClick={() => setVista(vista === 'ver' ? 'roster' : 'ver')}
            className="px-4 py-2.5 rounded-xl font-bold text-sm border border-outline-variant/50 text-on-surface hover:bg-surface-container transition flex items-center gap-2"
            data-testid="comp-tab-roster"
          >
            <span className="material-symbols-outlined text-lg">{vista === 'ver' ? 'badge' : 'grid_view'}</span>
            {vista === 'ver' ? 'Gestionar roster' : 'Ver composición'}
          </button>

          <button
            onClick={abrirImprimible}
            disabled={!comp}
            className="bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40"
            data-testid="comp-btn-pdf"
          >
            <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
            PDF
          </button>
        </div>
      </header>

      {/* ══════════ VISTA: COMPOSICIÓN (rail + timeline) ══════════ */}
      {vista === 'ver' && (
        <div className="flex flex-1 overflow-hidden">
          {/* Rail de sedes */}
          <aside className="w-64 shrink-0 border-r border-outline-variant/30 bg-surface-container-lowest p-3 space-y-1.5 overflow-y-auto custom-scrollbar">
            <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider px-2 pt-1 pb-2 capitalize">
              Sedes · {etiquetaMesActual}
            </p>

            {isLoading && (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}

            {sedesComp.map(s => {
              const activa = sedeSeleccionada?.sedeId === s.sedeId;
              const cob = coberturasSede(s);
              return (
                <button
                  key={s.sedeId}
                  onClick={() => setSedeSelId(s.sedeId)}
                  data-testid={`comp-sede-${s.sedeId}`}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition border',
                    activa ? 'bg-primary/10 border-primary/30' : 'hover:bg-surface-container-low border-transparent',
                  )}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colorPorSede.get(s.sedeId) || '#0044ab' }} />
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm truncate', activa ? 'font-bold text-primary' : 'font-semibold text-on-surface')}>{s.nombre}</p>
                    <p className="text-[11px] text-on-surface-variant">
                      {totalPersonasSede(s)} persona{totalPersonasSede(s) === 1 ? '' : 's'}
                      {cob > 0 && ` · ${cob} cobertura${cob === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  {activa && <span className="material-symbols-outlined text-primary text-lg">chevron_right</span>}
                </button>
              );
            })}

            {/* Total del mes */}
            {!isLoading && sedesComp.length > 0 && (
              <div className="mt-3 mx-1 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total del mes</p>
                <p className="text-lg font-bold text-on-surface mt-0.5">
                  {totales.personas} <span className="text-xs font-semibold text-on-surface-variant">personas</span>
                </p>
                <div className="flex items-center gap-2.5 mt-2">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-primary" title="Podólogas"><span className="material-symbols-outlined text-sm">medical_services</span>{totales.podologas}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-cyan-700" title="Fisioterapeutas"><span className="material-symbols-outlined text-sm">fitness_center</span>{totales.fisioterapeutas}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-teal-700" title="Doctores"><span className="material-symbols-outlined text-sm">monitor_heart</span>{totales.doctores}</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-violet-700" title="Recepcionistas"><span className="material-symbols-outlined text-sm">support_agent</span>{totales.recepcionistas}</span>
                </div>
              </div>
            )}
          </aside>

          {/* Panel timeline */}
          <main className="flex-1 overflow-y-auto custom-scrollbar">
            {sedeSeleccionada ? (
              <>
                <div className="px-6 py-4 flex items-center justify-between gap-3 border-b border-outline-variant/30 bg-surface-container-lowest sticky top-0 z-10">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colorPorSede.get(sedeSeleccionada.sedeId) || '#0044ab' }} />
                    <h2 className="text-lg font-bold text-on-surface">{sedeSeleccionada.nombre}</h2>
                    <span className="text-xs text-on-surface-variant">
                      {comp?.inicio} — {comp?.fin} · {totalPersonasSede(sedeSeleccionada)} personas
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-on-surface-variant">
                    <span className="flex items-center gap-1.5"><span className="w-6 h-2 rounded-full bg-primary" /> Todo el mes</span>
                    <span className="flex items-center gap-1.5"><span className="w-6 h-2 rounded-full bg-primary/40" /> Parcial</span>
                    <span className="flex items-center gap-1.5"><span className="w-6 h-2 rounded-full bg-amber-400" /> Cobertura</span>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  {/* Escala de días */}
                  <div className="flex items-center">
                    <div className="w-64 shrink-0" />
                    <div className="flex-1 relative h-5 text-[10px] font-mono text-on-surface-variant/70 select-none">
                      {marcasEscala(dias).map(m => (
                        <span key={m.dia} className="absolute" style={m.dia === dias ? { right: 0 } : { left: `${m.leftPct}%` }}>
                          {m.dia}
                        </span>
                      ))}
                    </div>
                  </div>

                  {CARGOS.map(meta => (
                    <GrupoCargo key={meta.key} sede={sedeSeleccionada} meta={meta} dias={dias} />
                  ))}
                </div>
              </>
            ) : !isLoading ? (
              <div className="flex-1 flex items-center justify-center py-24 text-sm text-on-surface-variant">
                No hay sedes activas para mostrar.
              </div>
            ) : null}
          </main>
        </div>
      )}

      {/* ══════════ VISTA: ROSTER (tabla + chips + modales) ══════════ */}
      {vista === 'roster' && (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-8 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <button onClick={() => setVista('ver')} className="flex items-center gap-1.5 text-sm font-bold text-primary hover:underline">
                <span className="material-symbols-outlined text-lg">arrow_back</span>
                Volver a la composición
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalRecepOpen(true)}
                  className="px-4 py-2 rounded-xl font-bold text-sm border border-outline-variant/50 text-on-surface hover:bg-surface-container transition flex items-center gap-1.5"
                  data-testid="rec-crear-btn"
                >
                  <span className="material-symbols-outlined text-lg">person_add</span>
                  Nueva recepcionista
                </button>
                <button
                  onClick={() => setModalAsignarOpen(true)}
                  className="bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5"
                  data-testid="asig-abrir-btn"
                >
                  <span className="material-symbols-outlined text-lg">assignment_ind</span>
                  Asignar a sede
                </button>
              </div>
            </div>

            {/* Tabla de asignaciones */}
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="text-left px-4 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">Persona</th>
                    <th className="text-left px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">Cargo</th>
                    <th className="text-left px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">Sede</th>
                    <th className="text-left px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">Vigencia</th>
                    <th className="text-left px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">Notas</th>
                    <th className="text-right px-4 py-2.5 border-b border-outline-variant/40" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/25">
                  {asignaciones.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-sm text-on-surface-variant">
                        Sin asignaciones de doctores/recepcionistas este mes.
                      </td>
                    </tr>
                  ) : (
                    asignaciones.map(a => (
                      <tr key={a.id} className="hover:bg-primary/5 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-8 h-8 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0"
                              style={{ backgroundColor: colorAvatar(a.personaNombre) }}
                            >
                              {iniciales(a.personaNombre)}
                            </span>
                            <span className="text-[13px] font-bold text-on-surface">{a.personaNombre}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border',
                            a.cargo === 'doctor' ? 'bg-teal-50 text-teal-700 border-teal-200/70' : 'bg-violet-50 text-violet-700 border-violet-200/70',
                          )}>
                            <span className="material-symbols-outlined text-sm">{a.cargo === 'doctor' ? 'monitor_heart' : 'support_agent'}</span>
                            {a.cargo === 'doctor' ? 'Doctor' : 'Recep.'}
                          </span>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorPorSede.get(a.sedeId) || '#0044ab' }} />
                            <span className="text-[13px] font-semibold text-on-surface">{a.sedeNombre}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="text-xs font-mono text-on-surface">
                            {a.fechaFin ? `${a.fechaInicio} — ${a.fechaFin}` : `desde ${a.fechaInicio}`}
                          </span>
                          {!a.fechaFin && (
                            <span className="ml-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">INDEF.</span>
                          )}
                        </td>
                        <td className="px-3 py-3 max-w-[180px]">
                          {a.notas
                            ? <span className="text-xs text-on-surface-variant truncate block" title={a.notas}>{a.notas}</span>
                            : <span className="text-xs text-on-surface-variant/50 italic">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => eliminarAsigMut.mutate(a.id)}
                            disabled={eliminarAsigMut.isPending}
                            className="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-red-50 hover:text-red-600 transition"
                            title="Eliminar asignación"
                          >
                            <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="px-4 py-2.5 border-t border-outline-variant/30 bg-surface-container-low flex items-center justify-between">
                <p className="text-xs text-on-surface-variant">{asignaciones.length} asignación(es) vigente(s) en {etiquetaMesActual}</p>
                <p className="text-[11px] text-on-surface-variant/70">Las podólogas y fisios se gestionan desde <b>Movimientos</b></p>
              </div>
            </div>

            {/* Fichas de recepcionistas */}
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-outline-variant/30 flex items-center gap-2">
                <span className="material-symbols-outlined text-violet-700 text-lg">support_agent</span>
                <h3 className="text-sm font-bold text-on-surface">Fichas de recepcionistas</h3>
                <span className="text-[10px] font-bold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded-full">{recepcionistas.length}</span>
                <span className="text-[11px] text-on-surface-variant ml-1">— personal sin cuenta de acceso</span>
              </div>
              <div className="p-3 flex flex-wrap gap-2">
                {recepcionistas.map(r => {
                  const sedeAsignada = sedeDeRecepcionista.get(r.id);
                  return (
                    <span key={r.id} className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-full bg-surface-container-low border border-outline-variant/40">
                      <span
                        className="w-6 h-6 rounded-full text-white text-[9px] font-bold grid place-items-center"
                        style={{ backgroundColor: r.activo ? colorAvatar(r.nombre) : '#94a3b8' }}
                      >
                        {iniciales(r.nombre)}
                      </span>
                      <span className={cn('text-xs font-semibold', r.activo ? 'text-on-surface' : 'text-on-surface-variant line-through')}>{r.nombre}</span>
                      {sedeAsignada ? (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">{sedeAsignada}</span>
                      ) : (
                        <span className="text-[9px] font-bold text-on-surface-variant bg-surface-container rounded-full px-1.5 py-0.5">Sin asignar</span>
                      )}
                      <button
                        onClick={() => eliminarRecMut.mutate(r.id)}
                        disabled={eliminarRecMut.isPending}
                        className="text-on-surface-variant hover:text-red-600 grid place-items-center"
                        title="Eliminar recepcionista"
                      >
                        <span className="material-symbols-outlined text-base">close</span>
                      </button>
                    </span>
                  );
                })}
                <button
                  onClick={() => setModalRecepOpen(true)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-dashed border-primary/40 text-primary text-xs font-bold hover:bg-primary/5 transition"
                >
                  <span className="material-symbols-outlined text-base">add</span> Agregar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: ASIGNAR A SEDE ══════════ */}
      {modalAsignarOpen && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setModalAsignarOpen(false)}
        >
          <div
            className="bg-surface-container-lowest w-full max-w-md rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#0044ab] text-white p-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined">assignment_ind</span>
                  <h2 className="text-lg font-bold tracking-tight">Asignar a una sede</h2>
                </div>
                <p className="text-sm text-white/85 mt-1">Doctores y recepcionistas del roster</p>
              </div>
              <button onClick={() => setModalAsignarOpen(false)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="inline-flex items-center bg-surface-container-low border border-outline-variant/40 rounded-xl p-1 gap-1">
                {(['doctor', 'recepcionista'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => { setCargo(c); setPersonaId(''); }}
                    className={cn(
                      'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition',
                      cargo === c ? 'bg-primary text-white shadow-md shadow-primary/20' : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface font-semibold',
                    )}
                  >
                    <span className="material-symbols-outlined text-base">{c === 'doctor' ? 'monitor_heart' : 'support_agent'}</span>
                    {c === 'doctor' ? 'Doctor' : 'Recepcionista'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  {cargo === 'doctor' ? 'Doctor' : 'Recepcionista'}
                </label>
                <select value={personaId} onChange={e => setPersonaId(e.target.value)} className="input w-full text-sm" data-testid="asig-persona-select">
                  <option value="">— elegir —</option>
                  {opciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
                {opciones.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {cargo === 'doctor'
                      ? 'No hay doctores (créalos en Admin → Podólogas como tipo Médico).'
                      : 'Crea una recepcionista primero (botón "Nueva recepcionista").'}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Sede</label>
                <select value={sedeAsig} onChange={e => setSedeAsig(e.target.value)} className="input w-full text-sm" data-testid="asig-sede-select">
                  <option value="">— elegir —</option>
                  {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Desde</label>
                  <input type="date" value={desde} onChange={e => e.target.value && setDesde(e.target.value)} className="input w-full text-sm" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                    Hasta <span className="normal-case font-normal text-on-surface-variant/60">(vacío = indef.)</span>
                  </label>
                  <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} className="input w-full text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">
                  Notas <span className="normal-case font-normal text-on-surface-variant/60">(opcional)</span>
                </label>
                <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Motivo, referencia…" className="input w-full text-sm" maxLength={300} />
              </div>
            </div>

            <div className="p-4 border-t border-outline-variant/30 flex justify-end gap-2 bg-surface-container-low">
              <button
                onClick={() => setModalAsignarOpen(false)}
                className="px-4 py-2 rounded-xl border border-outline-variant/60 text-on-surface font-bold text-sm hover:bg-surface-container transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => crearAsigMut.mutate()}
                disabled={!asignacionValida || crearAsigMut.isPending}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 transition flex items-center gap-1.5 disabled:opacity-40"
                data-testid="asig-submit"
              >
                {crearAsigMut.isPending ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="material-symbols-outlined text-lg">add_circle</span>
                )}
                Asignar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ MODAL: NUEVA RECEPCIONISTA ══════════ */}
      {modalRecepOpen && (
        <div
          className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setModalRecepOpen(false)}
        >
          <div
            className="bg-surface-container-lowest w-full max-w-sm rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="bg-[#0044ab] text-white p-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined">person_add</span>
                  <h2 className="text-lg font-bold tracking-tight">Nueva recepcionista</h2>
                </div>
                <p className="text-sm text-white/85 mt-1">Ficha de personal, sin cuenta de acceso</p>
              </div>
              <button onClick={() => setModalRecepOpen(false)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-5">
              <label className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-1.5">Nombre completo</label>
              <input
                value={nuevoNombre}
                onChange={e => setNuevoNombre(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && nuevoNombre.trim().length >= 2) crearRecMut.mutate(); }}
                placeholder="Ej: Carmen Ríos"
                className="input w-full text-sm"
                maxLength={120}
                autoFocus
                data-testid="rec-nombre-input"
              />
            </div>
            <div className="p-4 border-t border-outline-variant/30 flex justify-end gap-2 bg-surface-container-low">
              <button
                onClick={() => setModalRecepOpen(false)}
                className="px-4 py-2 rounded-xl border border-outline-variant/60 text-on-surface font-bold text-sm hover:bg-surface-container transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => crearRecMut.mutate()}
                disabled={nuevoNombre.trim().length < 2 || crearRecMut.isPending}
                className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 transition disabled:opacity-40"
              >
                {crearRecMut.isPending ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
