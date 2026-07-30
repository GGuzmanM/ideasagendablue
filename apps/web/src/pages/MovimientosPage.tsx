import { format, parseISO, differenceInCalendarDays, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../utils/cn';
import { type Sede } from '../api';
import { MOTIVO_LABELS, type Movimiento } from '../api/movimientos';
import { MovimientoModal } from '../components/movimientos/MovimientoModal';
import {
  useMovimientosData,
  type Vista,
  MOTIVO_STYLE,
  esCobertura,
  soloFecha,
  rangoFechas,
  cuentaRegresiva,
  iniciales,
} from '../services/movimientosService';

// ─── Piezas visuales ──────────────────────────────────────────────────────────

function Avatar({ prof, size = 'md' }: { prof: Movimiento['profesional']; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'rounded-full flex items-center justify-center text-white font-bold shrink-0 shadow-sm',
        size === 'sm' ? 'w-8 h-8 text-[11px]' : 'w-10 h-10 text-xs',
      )}
      style={{ backgroundColor: prof.colorAvatar }}
    >
      {iniciales(prof)}
    </span>
  );
}

function BadgeMotivo({ motivo }: { motivo: string }) {
  const label = MOTIVO_LABELS[motivo as keyof typeof MOTIVO_LABELS] ?? motivo;
  const style = MOTIVO_STYLE[motivo] ?? MOTIVO_STYLE.OTRO;
  return (
    <span className={cn('font-label-caps text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap uppercase tracking-wider', style.badge)}>
      {label}
    </span>
  );
}

function IconBtn({ label, onClick, danger, icon }: {
  label: string; onClick: () => void; danger?: boolean; icon: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant transition-colors',
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-primary/10 hover:text-primary',
      )}
    >
      <span className="material-symbols-outlined text-base">{icon}</span>
    </button>
  );
}

// ─── Tarjeta de podóloga (tablero) ────────────────────────────────────────────

function PodologaCard({ mov, canWrite, onEditar, onEliminar }: {
  mov: Movimiento; canWrite: boolean;
  onEditar: (m: Movimiento) => void; onEliminar: (m: Movimiento) => void;
}) {
  const cobertura = esCobertura(mov);
  const style = MOTIVO_STYLE[mov.motivo] ?? MOTIVO_STYLE.OTRO;
  const puedeEliminar = canWrite && mov.estadoCalc !== 'historial';

  return (
    <div className={cn(
      'group relative bg-surface-container-lowest rounded-xl border border-outline-variant/40 py-3 pl-3 pr-1.5 flex items-start gap-2.5 transition-all hover:shadow-md hover:border-outline-variant',
      cobertura && cn('border-l-[3px]', style.accent),
    )}>
      <Avatar prof={mov.profesional} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[13px] text-on-surface leading-tight truncate">
          {mov.profesional.nombres} {mov.profesional.apellidos}
        </p>
        {mov.esRetorno ? (
          <p className="text-[11px] text-sky-700 mt-0.5 flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">undo</span>
            Retorno a sede matriz · {rangoFechas(mov)}
          </p>
        ) : cobertura ? (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <BadgeMotivo motivo={mov.motivo} />
            <span className="text-[11px] text-on-surface-variant font-medium">{rangoFechas(mov)}</span>
          </div>
        ) : (
          <p className="text-[11px] text-on-surface-variant/70 mt-0.5 italic">Asignación fija</p>
        )}
        {mov.reemplazaProfesional && (
          <p className="text-[11px] text-on-surface-variant/80 mt-0.5 truncate">
            Cubre a {mov.reemplazaProfesional.nombres} {mov.reemplazaProfesional.apellidos}
          </p>
        )}
      </div>
      {canWrite && (
        <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconBtn label="Editar" onClick={() => onEditar(mov)} icon="edit" />
          {puedeEliminar && <IconBtn label="Eliminar" danger onClick={() => onEliminar(mov)} icon="delete" />}
        </div>
      )}
    </div>
  );
}

// ─── Columna de sede (tablero) ────────────────────────────────────────────────

function SedeColumn({ sede, movs, proximos, canWrite, onNuevo, onEditar, onEliminar, onVerProximos }: {
  sede: Sede;
  movs: Movimiento[];
  proximos: number;
  canWrite: boolean;
  onNuevo: (sede: Sede) => void;
  onEditar: (m: Movimiento) => void;
  onEliminar: (m: Movimiento) => void;
  onVerProximos: () => void;
}) {
  // Coberturas temporales arriba (lo que hay que vigilar), luego las fijas; ambas alfabéticas.
  const ordenados = [...movs].sort((a, b) => {
    const ca = esCobertura(a) ? 0 : 1;
    const cb = esCobertura(b) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.profesional.nombres.localeCompare(b.profesional.nombres);
  });

  return (
    <div className="flex flex-col bg-surface-container-low rounded-2xl border border-outline-variant/40 lg:w-72 lg:shrink-0 overflow-hidden">
      {/* Encabezado */}
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-outline-variant/30 bg-surface-container-lowest">
        <span className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: sede.color }} />
        <span className="font-headline-sm font-bold text-sm text-on-surface flex-1 truncate">{sede.nombre}</span>
        <span className="text-[11px] font-bold text-on-surface-variant bg-surface-container border border-outline-variant/40 rounded-full px-2 py-0.5 min-w-[24px] text-center">
          {movs.length}
        </span>
        {canWrite && (
          <button
            onClick={() => onNuevo(sede)}
            title={`Agregar movimiento en ${sede.nombre}`}
            aria-label={`Agregar movimiento en ${sede.nombre}`}
            className="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
        )}
      </div>

      {/* Lista de podólogas */}
      <div className="p-2 space-y-2 lg:overflow-y-auto lg:max-h-[calc(100vh-19rem)]">
        {ordenados.length ? (
          ordenados.map(m => (
            <PodologaCard key={m.id} mov={m} canWrite={canWrite} onEditar={onEditar} onEliminar={onEliminar} />
          ))
        ) : (
          <p className="text-xs text-on-surface-variant/60 text-center py-8 italic">Sin podólogas asignadas</p>
        )}
      </div>

      {/* Pie: próximos cambios en esta sede */}
      {proximos > 0 && (
        <button
          onClick={onVerProximos}
          className="text-[11px] font-bold text-primary hover:bg-primary/10 text-left px-3.5 py-2.5 border-t border-outline-variant/30 transition-colors flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined text-sm">schedule</span>
          <span className="flex-1">{proximos === 1 ? '1 cambio programado' : `${proximos} cambios programados`}</span>
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </button>
      )}
    </div>
  );
}

// ─── Fila de lista (Próximos / Historial) ─────────────────────────────────────

function MovimientoFila({ mov, canWrite, onEditar, onEliminar, atenuado }: {
  mov: Movimiento; canWrite: boolean;
  onEditar: (m: Movimiento) => void; onEliminar: (m: Movimiento) => void;
  atenuado?: boolean;
}) {
  const inicio = soloFecha(mov.fechaInicio);
  const countdown = cuentaRegresiva(mov);
  const puedeEliminar = canWrite && mov.estadoCalc !== 'historial';

  return (
    <div className={cn(
      'group bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-4 flex items-center gap-4 transition-all hover:shadow-md hover:border-outline-variant',
      atenuado && 'opacity-70',
    )}>
      {/* Riel de fecha */}
      <div className="text-center w-14 shrink-0">
        <div className={cn('text-2xl font-headline-md font-bold leading-none', atenuado ? 'text-on-surface-variant' : 'text-primary')}>
          {format(inicio, 'd')}
        </div>
        <div className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mt-0.5">
          {format(inicio, 'MMM', { locale: es })}
        </div>
        {!atenuado && countdown && (
          <div className="text-[10px] font-bold text-amber-700 mt-1">{countdown}</div>
        )}
      </div>

      <div className="w-px self-stretch bg-outline-variant/30 shrink-0" />

      <Avatar prof={mov.profesional} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-on-surface leading-tight truncate">
          {mov.profesional.nombres} {mov.profesional.apellidos}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: mov.sede.color }} />
          <span className="text-xs font-semibold text-on-surface truncate">{mov.sede.nombre}</span>
          <span className="text-xs text-on-surface-variant">· {rangoFechas(mov)}</span>
        </div>
        {mov.reemplazaProfesional && (
          <p className="text-xs text-on-surface-variant/80 mt-0.5 truncate">
            Cubre a {mov.reemplazaProfesional.nombres} {mov.reemplazaProfesional.apellidos}
          </p>
        )}
        {mov.notas && <p className="text-xs text-on-surface-variant/70 mt-0.5 italic truncate">{mov.notas}</p>}
      </div>

      <BadgeMotivo motivo={mov.motivo} />

      {canWrite && (
        <div className="flex shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <IconBtn label="Editar" onClick={() => onEditar(mov)} icon="edit" />
          {puedeEliminar && <IconBtn label="Eliminar" danger onClick={() => onEliminar(mov)} icon="delete" />}
        </div>
      )}
    </div>
  );
}

// ─── Navegador de fecha (tablero) ─────────────────────────────────────────────

function NavegadorFecha({ fecha, hoy, onChange }: {
  fecha: string; hoy: string; onChange: (f: string) => void;
}) {
  const d = parseISO(fecha);
  const esHoy = fecha === hoy;
  const dias = differenceInCalendarDays(d, parseISO(hoy));
  const relativo = esHoy ? 'Hoy' : dias === 1 ? 'Mañana' : dias > 0 ? `En ${dias} días` : null;

  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      <div className="inline-flex items-center bg-surface-container-lowest border border-outline-variant/50 rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => onChange(format(addDays(d, -1), 'yyyy-MM-dd'))}
          disabled={esHoy}
          aria-label="Día anterior"
          className="w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-base">chevron_left</span>
        </button>
        <label className="relative flex items-center gap-2 px-3 h-9 border-x border-outline-variant/40 cursor-pointer hover:bg-surface-container transition-colors">
          <span className="material-symbols-outlined text-base text-primary">calendar_today</span>
          <span className="text-sm font-semibold text-on-surface first-letter:uppercase whitespace-nowrap">
            {format(d, "EEE d 'de' MMM", { locale: es })}
          </span>
          <input
            type="date"
            value={fecha}
            min={hoy}
            onChange={e => e.target.value && onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            aria-label="Elegir fecha"
          />
        </label>
        <button
          onClick={() => onChange(format(addDays(d, 1), 'yyyy-MM-dd'))}
          aria-label="Día siguiente"
          className="w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container transition-colors"
        >
          <span className="material-symbols-outlined text-base">chevron_right</span>
        </button>
      </div>

      {relativo && (
        <span className={cn(
          'font-label-caps text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider',
          esHoy ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800',
        )}>
          {relativo}
        </span>
      )}

      {!esHoy && (
        <button onClick={() => onChange(hoy)} className="text-xs font-bold text-primary hover:underline">
          Volver a hoy
        </button>
      )}
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function MovimientosPage() {
  const {
    canWrite,
    vista, setVista,
    busqueda, setBusqueda, query,
    modalAbierto, editando, sedePrefill,
    abrirNuevo, abrirEditar, cerrarModal,
    hoyStr, fechaVista, setFechaVista,
    sedesActivas,
    tableroMovs,
    cambiosPorSede,
    proximos,
    historial,
    proximosCount,
    cargando,
    handleEliminar,
  } = useMovimientosData();

  const VISTAS: { id: Vista; label: string; icon: string; count?: number }[] = [
    { id: 'hoy',       label: 'Hoy',       icon: 'today' },
    { id: 'proximo',   label: 'Próximos',  icon: 'schedule', count: proximosCount },
    { id: 'historial', label: 'Historial', icon: 'history' },
  ];

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <header className="px-8 py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <h1 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight">
            Movimientos de personal
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            Quién atiende en cada sede. Los cambios se reflejan al instante en la agenda.
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => abrirNuevo()}
            className="bg-primary text-white px-4 py-2.5 rounded-xl font-body-md font-bold shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2 shrink-0"
          >
            <span className="material-symbols-outlined text-lg">add_circle</span>
            Nuevo movimiento
          </button>
        )}
      </header>

      {/* Barra de control: cambio de vista + buscador */}
      <div className="px-8 py-4 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-wrap items-center gap-4 shrink-0">
        <div className="inline-flex items-center bg-surface-container-low border border-outline-variant/40 rounded-xl p-1 shadow-xs gap-1">
          {VISTAS.map(v => {
            const activo = vista === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setVista(v.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all',
                  activo
                    ? 'bg-primary text-white shadow-md shadow-primary/20'
                    : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface',
                )}
              >
                <span className="material-symbols-outlined text-base">{v.icon}</span>
                {v.label}
                {typeof v.count === 'number' && v.count > 0 && (
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    activo ? 'bg-white/25 text-white' : 'bg-primary/15 text-primary',
                  )}>
                    {v.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar podóloga..."
            className="w-full bg-surface-container-low border border-outline-variant/50 rounded-xl pl-10 pr-9 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface w-5 h-5 grid place-items-center"
              aria-label="Limpiar búsqueda"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        {cargando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : vista === 'hoy' ? (
          // ── Tablero por sede ──
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <NavegadorFecha fecha={fechaVista} hoy={hoyStr} onChange={setFechaVista} />
              {fechaVista !== hoyStr && (
                <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm">visibility</span>
                  Proyección: así quedará la asignación de cada sede ese día.
                </p>
              )}
            </div>
            <div className="flex flex-col lg:flex-row gap-4 lg:overflow-x-auto pb-2 custom-scrollbar">
              {sedesActivas.map(sede => (
                <SedeColumn
                  key={sede.id}
                  sede={sede}
                  movs={tableroMovs.filter(m => m.sedeId === sede.id)}
                  proximos={cambiosPorSede[sede.id] ?? 0}
                  canWrite={canWrite}
                  onNuevo={s => abrirNuevo(s.id)}
                  onEditar={abrirEditar}
                  onEliminar={handleEliminar}
                  onVerProximos={() => setVista('proximo')}
                />
              ))}
              {!sedesActivas.length && (
                <p className="text-sm text-on-surface-variant py-16 text-center w-full">No hay sedes activas.</p>
              )}
            </div>
          </div>
        ) : vista === 'proximo' ? (
          // ── Próximos ──
          proximos.length ? (
            <div className="grid gap-3 max-w-3xl">
              {proximos.map(m => (
                <MovimientoFila key={m.id} mov={m} canWrite={canWrite} onEditar={abrirEditar} onEliminar={handleEliminar} />
              ))}
            </div>
          ) : (
            <EstadoVacio
              icon="event_note"
              titulo={query ? `Sin resultados para "${busqueda}"` : 'No hay movimientos programados'}
              accion={canWrite && !query ? { label: 'Programar movimiento', onClick: () => abrirNuevo() } : undefined}
            />
          )
        ) : (
          // ── Historial ──
          historial.length ? (
            <div className="grid gap-3 max-w-3xl">
              {historial.map(m => (
                <MovimientoFila key={m.id} mov={m} canWrite={canWrite} onEditar={abrirEditar} onEliminar={handleEliminar} atenuado />
              ))}
            </div>
          ) : (
            <EstadoVacio icon="folder_open" titulo={query ? `Sin resultados para "${busqueda}"` : 'Sin historial de movimientos'} />
          )
        )}
      </div>

      {modalAbierto && (
        <MovimientoModal onClose={cerrarModal} movimientoEditar={editando} prefillSedeId={sedePrefill} />
      )}
    </div>
  );
}

function EstadoVacio({ icon, titulo, accion }: {
  icon: string; titulo: string; accion?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-surface-container-low grid place-items-center mb-4">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant">{icon}</span>
      </div>
      <p className="font-headline-sm text-headline-sm font-bold text-on-surface">{titulo}</p>
      {accion && (
        <button
          onClick={accion.onClick}
          className="mt-5 bg-primary text-white px-4 py-2.5 rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          {accion.label}
        </button>
      )}
    </div>
  );
}
