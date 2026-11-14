// «Visor de Pacientes» (antes «Pacientes del día»): quiénes ya llegaron hoy a la sede, para que el médico se tome al paciente, entre a la
// historia clínica (inicia o continúa la atención) y emita la receta, sin pasar por la agenda.
// Vista PURA: la lógica vive en services/visorPacientesService.ts.
import { type CitaResumen } from '../api/citas';
import { type RecetaDelDia } from '../api/recetas';
import { type ResumenClinicoCita } from '../api/historiaClinica';
import { nombreMedico } from '../api/medicoCita';
import { Skeleton } from '../components/ui/Skeleton';
import { useVisorPacientes, TODAS_SEDES, type FiltroVisor } from '../services/visorPacientesService';
import { cn } from '../utils/cn';
import { AceboEsquina, GorritoNavideno, LucesEncabezado, SaludoNavideno } from '../components/navidad/Navidad';
import { useNavidadVisible } from '../stores/navidadStore';

const BTN = 'min-h-[40px] lg:min-h-0 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 disabled:opacity-50 transition-colors';
const BTN_SEC = `${BTN} border border-outline-variant text-on-surface hover:bg-surface-container-high`;
const BTN_PRI = `${BTN} bg-primary text-on-primary hover:bg-primary/90`;

/** «Con receta» (y cuántas si hay más de una); si solo hay indicaciones podológicas, lo dice. */
function ChipReceta({ rx }: { rx: RecetaDelDia }) {
  const texto = rx.recetasMedicas > 0
    ? `Con receta${rx.recetasMedicas > 1 ? ` (${rx.recetasMedicas})` : ''}${rx.indicaciones ? ' + indicaciones' : ''}`
    : 'Con indicaciones';
  return (
    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-600 text-white flex items-center gap-0.5" data-testid="visor-con-receta">
      <span className="material-symbols-outlined text-[13px]">prescriptions</span>{texto}
    </span>
  );
}

/** HC v2 (en validación): «Procedimiento realizado» y «Completado» (la historia de la visita quedó llena). */
function ChipsResumenHc({ r }: { r: ResumenClinicoCita | null }) {
  if (!r) return null;
  return (
    <>
      {r.procedimientos > 0 && (
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-600 text-white flex items-center gap-0.5" data-testid="visor-procedimiento">
          <span className="material-symbols-outlined text-[13px]">healing</span>Procedimiento realizado
        </span>
      )}
      {r.completada && (
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-teal-700 text-white flex items-center gap-0.5" data-testid="visor-completado"
          title="Historia completa: anamnesis, diagnóstico y procedimiento o receta">
          <span className="material-symbols-outlined text-[13px]">task_alt</span>Completado
        </span>
      )}
    </>
  );
}

/** Interruptor «Solo con procedimiento» (23-oct-2026): filtra la lista y el Excel. */
function InterruptorProcedimiento({ activo, onChange }: { activo: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer select-none transition-colors',
        activo ? 'bg-indigo-50 border-indigo-400 text-indigo-800' : 'bg-surface-container-low border-outline-variant text-on-surface-variant hover:bg-surface-container-high')}
      title="Muestra (y exporta) solo las visitas cuya atención tiene al menos un procedimiento"
      data-testid="visor-solo-procedimiento"
    >
      <input type="checkbox" className="sr-only" checked={activo} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn('relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors', activo ? 'bg-indigo-600' : 'bg-slate-300')}>
        <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', activo ? 'left-3.5' : 'left-0.5')} />
      </span>
      <span className="material-symbols-outlined text-[16px]">healing</span>Solo con procedimiento
    </label>
  );
}

/** Sede de la cita, visible cuando el visor muestra todas las sedes. */
function EtiquetaSede({ nombre }: { nombre: string }) {
  return <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-white" data-testid="visor-sede-cita">{nombre}</span>;
}

const TONO_FILA = {
  receta: 'border-emerald-500 bg-emerald-200/60 ring-1 ring-emerald-500/50',
  mio: 'border-blue-500 bg-blue-200/60 ring-1 ring-blue-500/50',
  con_medico: 'border-sky-400 bg-sky-100',
  en_atencion: 'border-amber-300/70 bg-amber-50/40',
  normal: 'border-outline-variant/20',
} as const;

const LEYENDA: { clase: string; texto: string; soloMedico?: boolean }[] = [
  { clase: 'bg-blue-200 border-blue-500', texto: 'Mis pacientes', soloMedico: true },
  { clase: 'bg-sky-100 border-sky-400', texto: 'Con médico asignado' },
  { clase: 'bg-emerald-200 border-emerald-500', texto: 'Con receta' },
  { clase: 'bg-amber-100 border-amber-300', texto: 'En atención sin médico' },
];

function nombrePaciente(c: CitaResumen) { return `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno ?? ''}`.trim(); }
const diaCorto = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const diaLargo = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });

/** Día o rango del visor (solo admin y auditor de médicos). */
function SelectorFechasVisor({ v }: { v: ReturnType<typeof useVisorPacientes> }) {
  const INPUT = 'bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-sm text-on-surface';
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="visor-fechas">
      <button onClick={() => v.moverDia(-1)} className={BTN_SEC} title="Día anterior" data-testid="visor-dia-anterior"><span className="material-symbols-outlined text-base">chevron_left</span></button>
      <label className="flex items-center gap-1 text-xs text-on-surface-variant">Desde
        <input type="date" value={v.desdeSel} onChange={(e) => v.setDesde(e.target.value)} className={INPUT} data-testid="visor-desde" />
      </label>
      <label className="flex items-center gap-1 text-xs text-on-surface-variant">Hasta
        <input type="date" value={v.hastaSel} onChange={(e) => v.setHasta(e.target.value)} className={INPUT} data-testid="visor-hasta" />
      </label>
      <button onClick={() => v.moverDia(1)} className={BTN_SEC} title="Día siguiente" data-testid="visor-dia-siguiente"><span className="material-symbols-outlined text-base">chevron_right</span></button>
      {!v.esHoy && <button onClick={v.irHoy} className={BTN_SEC} data-testid="visor-hoy">Hoy</button>}
    </div>
  );
}

export function VisorPacientesPage() {
  const v = useVisorPacientes();
  const navidad = useNavidadVisible();

  return (
    <div className="relative p-4 lg:p-6 space-y-4 max-w-[1200px] overflow-y-auto h-full" data-testid="visor-pacientes">
      {/* Aquí la guirnalda cuelga del borde de arriba de la pantalla: bajo el título vienen los filtros y los taparía. */}
      <LucesEncabezado className="top-0" />
      <header className="relative flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-headline-md text-headline-md font-bold text-on-surface flex items-center gap-2">
            <span className="relative inline-flex"><span className="material-symbols-outlined text-primary">clinical_notes</span><GorritoNavideno className="-top-2.5 -left-1.5 w-[19px] -rotate-[20deg]" /></span>Visor de Pacientes
            <SaludoNavideno className="ml-1" />
          </h1>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {v.esHoy
              ? <>Quienes ya llegaron hoy a {v.sedeNombre || 'la sede'}. Tómate al paciente, entra a su historia y emite la receta desde aquí.</>
              : v.esRango
                ? <>Pacientes de {v.sedeNombre || 'la sede'} del {diaCorto(v.fecha)} al {diaCorto(v.hasta!)}.</>
                : <>Pacientes de {v.sedeNombre || 'la sede'} del {diaLargo(v.fecha)}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {v.puedeRango && <SelectorFechasVisor v={v} />}
          {(v.sedes.length > 1 || v.puedeTodas) && (
            <select value={v.sedeId} onChange={(e) => v.setSedeId(e.target.value)} className={cn('border rounded-lg px-2 py-1.5 text-sm', v.esTodas ? 'bg-slate-800 text-white border-slate-800 font-semibold' : 'bg-surface-container-low border-outline-variant text-on-surface')} data-testid="visor-sede">
              {v.puedeTodas && <option value={TODAS_SEDES}>Todas las sedes</option>}
              {v.sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          {v.esTodas && (
            <select value={v.medicoFiltro} onChange={(e) => v.setMedicoFiltro(e.target.value)}
              className={cn('border rounded-lg px-2 py-1.5 text-sm max-w-[240px]', v.medicoFiltro ? 'bg-indigo-700 text-white border-indigo-700 font-semibold' : 'bg-surface-container-low border-outline-variant text-on-surface')}
              title="Los médicos rotan entre sedes: filtra sus visitas en todas las sedes" data-testid="visor-medico">
              <option value="">Todos los médicos</option>
              {v.medicosPeriodo.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.citas})</option>)}
            </select>
          )}
          <button onClick={v.refrescar} className={BTN_SEC}><span className="material-symbols-outlined text-base">refresh</span>Actualizar</button>
          {v.puedeExportar && (
            <button onClick={() => void v.exportar()} disabled={v.exportando} className={cn(BTN, 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm')}
              title="Descarga un Excel con las visitas del periodo: médico que atendió, diagnósticos, procedimientos y recetas" data-testid="visor-exportar">
              <span className={cn('material-symbols-outlined text-base', v.exportando && 'animate-spin')}>{v.exportando ? 'progress_activity' : 'download'}</span>
              {v.exportando ? 'Generando Excel…' : 'Exportar Excel'}
            </button>
          )}
        </div>
      </header>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-surface-container-low rounded-lg p-1">
          {([['todos', 'Todos'], ['mios', 'Mis pacientes'], ['sin_medico', 'Sin médico']] as [FiltroVisor, string][])
            .filter(([k]) => k !== 'mios' || v.soyMedico)
            .map(([k, l]) => (
              <button key={k} onClick={() => v.setFiltro(k)} className={cn('px-3 py-1 rounded-md text-xs font-semibold transition-colors', v.filtro === k ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-high')}>{l}</button>
            ))}
        </div>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-base text-on-surface-variant">search</span>
          <input value={v.busqueda} onChange={(e) => v.setBusqueda(e.target.value)} placeholder="Nombre o documento…" className="pl-8 pr-3 py-1.5 bg-surface-container-low border border-outline-variant rounded-lg text-sm text-on-surface w-56" />
        </div>
        {v.puedeVerHc && <InterruptorProcedimiento activo={v.soloConProcedimiento} onChange={v.setSoloConProcedimiento} />}
        <span className="flex-1" />
        <span className="text-xs text-on-surface-variant">{v.porVenir} por llegar · {v.atendidos.length} atendido{v.atendidos.length === 1 ? '' : 's'}{v.esHoy ? ' hoy' : ''}</span>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-on-surface-variant" data-testid="visor-leyenda">
        {LEYENDA.filter((l) => !l.soloMedico || v.soyMedico).map((l) => (
          <span key={l.texto} className="flex items-center gap-1"><span className={cn('w-3 h-3 rounded border', l.clase)} />{l.texto}</span>
        ))}
      </div>

      {v.cargando ? <Skeleton className="h-40 w-full" /> : v.error ? <p className="text-sm text-rose-700">{v.error.message}</p> : (
        <>
          <section className="relative rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 lg:p-5">
            <AceboEsquina />
            <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-emerald-600">how_to_reg</span>En la sede ({v.enSede.length})
            </h2>
            {v.enSede.length === 0 && (
              <p className="text-sm text-on-surface-variant py-4 text-center">
                {navidad && <span aria-hidden className="block text-3xl mb-1">☃️</span>}
                Ningún paciente en espera ni en atención ahora mismo.
              </p>
            )}
            <div className="space-y-2">
              {v.enSede.map((c) => {
                const a = v.acciones(c);
                const enAtencion = c.estado === 'en_atencion';
                // Color de la fila (26-sep-2026), de mayor a menor prioridad: con receta → VERDE; mi paciente (el médico
                // logueado) → AZUL fuerte; con otro médico asignado → AZUL claro; en atención sin médico → AMARILLO.
                const rx = v.recetaDe(c);
                const tono = rx ? 'receta' : a.esMia ? 'mio' : c.medicoId ? 'con_medico' : enAtencion ? 'en_atencion' : 'normal';
                return (
                  <div key={c.id} data-testid={`visor-cita-${c.id}`} data-tono={tono} className={cn('rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap', TONO_FILA[tono])}>
                    <span className="w-1 h-10 rounded-full shrink-0" style={{ background: c.servicio.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-on-surface">{nombrePaciente(c)}</span>
                        {v.esTodas && <EtiquetaSede nombre={c.sede.nombre} />}
                        {c.paciente.numeroDocumento && <span className="text-[11px] text-on-surface-variant font-mono">{c.paciente.numeroDocumento}</span>}
                        <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded', enAtencion ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700')}>
                          {enAtencion ? `En atención${a.enAtencionHora ? ` desde ${a.enAtencionHora}` : ''}` : `Llegó ${a.llegoHora}`}
                        </span>
                        {a.esperaMin !== null && a.esperaMin >= 15 && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-700">{a.esperaMin} min esperando</span>}
                        {c.consultorioNumero ? <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">C{c.consultorioNumero}</span> : null}
                        {rx && <ChipReceta rx={rx} />}
                        <ChipsResumenHc r={v.resumenDe(c)} />
                      </div>
                      <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                        {v.esRango ? `${diaCorto(c.fecha)} · ` : ''}{c.horaInicio} · {c.servicio.nombre}{c.subcategoria ? ` · ${c.subcategoria.nombre}` : ''} · {c.unidadNegocio.nombre}
                        {c.profesional ? ` · ${c.profesional.nombres.split(' ')[0]} ${c.profesional.apellidos.split(' ')[0]}` : ''}
                      </p>
                      {a.llevaMedico && (
                        <p className={cn('text-xs mt-0.5 flex items-center gap-1', c.medico ? (a.esMia ? 'text-primary font-semibold' : 'text-on-surface-variant') : 'text-amber-700')}>
                          <span className="material-symbols-outlined text-sm">stethoscope</span>
                          {c.medico ? (a.esMia ? 'Tu paciente' : `Médico: ${nombreMedico(c.medico)}`) : 'Sin médico asignado'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      {a.puedeAsignar && (
                        <select value={c.medicoId ?? ''} onChange={(e) => v.asignar(c, e.target.value || null)} disabled={v.pendiente} className="bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1.5 text-xs text-on-surface max-w-[180px]" title="Asignar médico">
                          <option value="">Sin médico</option>
                          {v.asignables.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.enEstaSede ? '' : ' (otra sede)'}</option>)}
                        </select>
                      )}
                      {a.puedeTomar && <button onClick={() => v.tomar(c)} disabled={v.pendiente} className={BTN_SEC} data-testid="visor-tomar"><span className="material-symbols-outlined text-base">person_add</span>Tomar</button>}
                      {a.puedeSoltar && !a.puedeAsignar && <button onClick={() => v.soltar(c)} disabled={v.pendiente} className={BTN_SEC} title="Dejar de ser el médico de esta cita"><span className="material-symbols-outlined text-base">person_remove</span>Soltar</button>}
                      {!a.puedeAtender && a.puedeVerHistoria && (
                        <button onClick={() => void v.atender(c)} className={BTN_SEC} title="Ver su historia clínica (solo lectura: la atiende otro médico)" data-testid="visor-ver-historia"><span className="material-symbols-outlined text-base">visibility</span>Ver historia</button>
                      )}
                      {a.puedeAtender && (
                        <>
                          <button onClick={() => void v.atender(c)} className={BTN_PRI} data-testid="visor-atender"><span className="material-symbols-outlined text-base">stethoscope</span>{enAtencion ? 'Continuar atención' : 'Atender'}</button>
                          <button onClick={() => void v.atender(c, 'receta')} className={BTN_SEC} title="Ir directo a la receta" data-testid="visor-receta"><span className="material-symbols-outlined text-base">prescriptions</span>Receta</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="relative rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 lg:p-5">
            <AceboEsquina />
            <button onClick={() => v.setVerAtendidos(!v.verAtendidos)} className="w-full flex items-center gap-2 text-left">
              <span className="material-symbols-outlined text-on-surface-variant">{navidad ? 'featured_seasonal_and_gifts' : 'task_alt'}</span>
              <h2 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex-1">Atendidos{v.esHoy ? ' hoy' : ''} ({v.atendidos.length})</h2>
              <span className="material-symbols-outlined text-on-surface-variant">{v.verAtendidos ? 'expand_less' : 'expand_more'}</span>
            </button>
            {v.verAtendidos && (
              <div className="space-y-1.5 mt-3">
                {v.atendidos.length === 0 && <p className="text-sm text-on-surface-variant">Todavía nadie.</p>}
                {v.atendidos.map((c) => (
                  <div key={c.id} className="rounded-xl border border-outline-variant/20 px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-on-surface">{nombrePaciente(c)}</span>
                    {v.esTodas && <EtiquetaSede nombre={c.sede.nombre} />}
                    <span className="text-xs text-on-surface-variant">{v.esRango ? `${diaCorto(c.fecha)} · ` : ''}{c.horaInicio} · {c.servicio.nombre}{c.medico ? ` · ${nombreMedico(c.medico)}` : ''}</span>
                    {v.recetaDe(c) && <ChipReceta rx={v.recetaDe(c)!} />}
                    <ChipsResumenHc r={v.resumenDe(c)} />
                    <span className="flex-1" />
                    {v.acciones(c).puedeAtender && <button onClick={() => void v.atender(c)} className={BTN_SEC}><span className="material-symbols-outlined text-base">description</span>Ver historia</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
