import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import toast from 'react-hot-toast';
import { format, parseISO, differenceInCalendarDays, addDays, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../utils/cn';
import { type Sede } from '../api';
import { composicionSedeApi } from '../api/composicionSede';
import { baroSolicitudApi } from '../api/baroSolicitud';
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

// ─── Grupos de personal (selector) ────────────────────────────────────────────
type Grupo = 'podologas' | 'recepcion' | 'doctores';
const GRUPOS: { id: Grupo; label: string; icon: string }[] = [
  { id: 'podologas', label: 'Podólogas', icon: 'medical_services' },
  { id: 'recepcion', label: 'Recepción', icon: 'support_agent' },
  { id: 'doctores',  label: 'Doctores (baro)', icon: 'footprint' },
];

// Persona en el tablero de un grupo (recepción / doctores-baro).
interface PersonaGrupo { id: string; nombre: string; nota?: string; asignacionId?: string }

// Tarjeta de persona ARRASTRABLE: se puede arrastrar y soltar en otra sede para MOVERLA.
function TarjetaArrastrable({ persona, sedeId, sedeNombre, canWrite, onQuitar }: {
  persona: PersonaGrupo; sedeId: string; sedeNombre: string; canWrite: boolean;
  onQuitar: (persona: PersonaGrupo, sedeId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `p-${sedeId}-${persona.id}`, data: { persona, sedeId }, disabled: !canWrite,
  });
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 50 : undefined };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(canWrite ? { ...attributes, ...listeners } : {})}
      className={cn('group bg-surface-container-lowest rounded-xl px-3 py-2.5 border border-outline-variant/40 flex items-center gap-2.5', canWrite && 'cursor-grab active:cursor-grabbing')}
    >
      <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[11px] shrink-0">
        {(persona.nombre[0] ?? '?').toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-[13px] text-on-surface leading-tight truncate">{persona.nombre}</p>
        {persona.nota && <p className="text-[11px] text-on-surface-variant/70 truncate">{persona.nota}</p>}
      </div>
      {canWrite && (
        <button
          onClick={() => onQuitar(persona, sedeId)}
          onPointerDown={(e) => e.stopPropagation()}
          title={`Quitar de ${sedeNombre}`}
          aria-label="Quitar"
          className="w-7 h-7 grid place-items-center rounded-lg text-on-surface-variant opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-all shrink-0"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      )}
    </div>
  );
}

// Columna de sede: zona DROPPABLE (se ilumina al arrastrar una tarjeta encima).
function ColumnaSede({ sede, gente, vacio, canWrite, onAsignar, onQuitar }: {
  sede: Sede; gente: PersonaGrupo[]; vacio: string; canWrite: boolean;
  onAsignar: (sede: Sede) => void; onQuitar: (persona: PersonaGrupo, sedeId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `sede-${sede.id}`, data: { sedeId: sede.id } });
  return (
    <div ref={setNodeRef} className={cn('flex flex-col bg-surface-container-low rounded-2xl border lg:w-72 lg:shrink-0 overflow-hidden transition-all', isOver ? 'border-primary ring-2 ring-primary/40' : 'border-outline-variant/40')}>
      <div className="flex items-center gap-2 px-3.5 py-3 border-b border-outline-variant/30 bg-surface-container-lowest">
        <span className="w-1.5 h-6 rounded-full shrink-0" style={{ backgroundColor: sede.color }} />
        <span className="font-headline-sm font-bold text-sm text-on-surface flex-1 truncate">{sede.nombre}</span>
        <span className="text-[11px] font-bold text-on-surface-variant bg-surface-container border border-outline-variant/40 rounded-full px-2 py-0.5 min-w-[24px] text-center">{gente.length}</span>
        {canWrite && (
          <button onClick={() => onAsignar(sede)} title={`Asignar a ${sede.nombre}`} aria-label={`Asignar a ${sede.nombre}`} className="w-8 h-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
        )}
      </div>
      <div className="p-2 space-y-2 lg:overflow-y-auto lg:max-h-[calc(100vh-19rem)] min-h-[76px]">
        {gente.length ? gente.map(p => (
          <TarjetaArrastrable key={p.id} persona={p} sedeId={sede.id} sedeNombre={sede.nombre} canWrite={canWrite} onQuitar={onQuitar} />
        )) : (
          <p className="text-xs text-on-surface-variant/60 text-center py-8 italic">{vacio}</p>
        )}
      </div>
    </div>
  );
}

// Tablero por sede para Recepción / Doctores-baro. Además de + (asignar) y ✕ (quitar), permite
// ARRASTRAR una tarjeta a otra sede → la mueve (sale de la vieja, entra a la nueva) en un gesto.
function GrupoTablero({ sedes, porSede, vacio, ayuda, canWrite, onAsignar, onQuitar, onMover }: {
  sedes: Sede[];
  porSede: Record<string, PersonaGrupo[]>;
  vacio: string;
  ayuda: string;
  canWrite: boolean;
  onAsignar: (sede: Sede) => void;
  onQuitar: (persona: PersonaGrupo, sedeId: string) => void;
  onMover: (persona: PersonaGrupo, fromSedeId: string, toSedeId: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const from = e.active.data.current as { persona: PersonaGrupo; sedeId: string } | undefined;
    const to = e.over?.data.current as { sedeId: string } | undefined;
    if (from && to && from.sedeId !== to.sedeId) onMover(from.persona, from.sedeId, to.sedeId);
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-on-surface-variant flex items-center gap-1.5">
        <span className="material-symbols-outlined text-sm">info</span>
        {ayuda}
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex flex-col lg:flex-row gap-4 lg:overflow-x-auto pb-2 custom-scrollbar">
          {sedes.map(sede => (
            <ColumnaSede key={sede.id} sede={sede} gente={porSede[sede.id] ?? []} vacio={vacio} canWrite={canWrite} onAsignar={onAsignar} onQuitar={onQuitar} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

// Modal para ASIGNAR a una persona (recepcionista o doctor de baro) a una sede, con rango de
// fechas (fin opcional = indefinido) y, para baro, motivo. Reutilizado por ambas pestañas.
function AsignarPersonaModal({ titulo, sedeNombre, candidatos, conMotivo, guardando, fechaBase, onGuardar, onCerrar }: {
  titulo: string;
  sedeNombre: string;
  candidatos: { id: string; nombre: string }[];
  conMotivo: boolean;
  guardando: boolean;
  fechaBase: string;
  onGuardar: (d: { personaId: string; fechaInicio: string; fechaFin: string | null; motivo: string }) => void;
  onCerrar: () => void;
}) {
  const [personaId, setPersonaId] = useState('');
  const [fechaInicio, setFechaInicio] = useState(fechaBase);
  const [fechaFin, setFechaFin] = useState('');
  const [motivo, setMotivo] = useState('OTRO');

  const submit = () => {
    if (!personaId) { toast.error('Elige a la persona'); return; }
    if (fechaFin && fechaFin < fechaInicio) { toast.error('La fecha de fin no puede ser anterior a la de inicio'); return; }
    onGuardar({ personaId, fechaInicio, fechaFin: fechaFin || null, motivo });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl border border-outline-variant/40 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/30 bg-surface-container-low">
          <div>
            <h3 className="text-sm font-bold text-on-surface">{titulo}</h3>
            <p className="text-[11px] text-on-surface-variant">Sede: {sedeNombre}</p>
          </div>
          <button onClick={onCerrar} className="w-8 h-8 rounded-lg grid place-items-center text-on-surface-variant hover:bg-surface-container">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-5 space-y-3.5">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Persona *</label>
            <select className="input w-full text-sm" value={personaId} onChange={e => setPersonaId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {candidatos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            {candidatos.length === 0 && <p className="text-[11px] text-on-surface-variant/70 mt-1">No hay más personas disponibles para esta sede.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Desde *</label>
              <input type="date" className="input w-full text-sm [color-scheme:light]" value={fechaInicio} onChange={e => e.target.value && setFechaInicio(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Hasta (opcional)</label>
              <input type="date" className="input w-full text-sm [color-scheme:light]" value={fechaFin} min={fechaInicio} onChange={e => setFechaFin(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-on-surface-variant/70 -mt-1.5">Sin fecha de fin = asignación indefinida.</p>
          {conMotivo && (
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Motivo</label>
              <select className="input w-full text-sm" value={motivo} onChange={e => setMotivo(e.target.value)}>
                {Object.entries(MOTIVO_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-outline-variant/30 bg-surface-container-low/50">
          <button onClick={onCerrar} className="btn btn-secondary btn-sm">Cancelar</button>
          <button onClick={submit} disabled={guardando || !personaId} className="btn btn-primary btn-sm">
            {guardando ? 'Asignando…' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lista de Próximos / Historial para Recepción o Doctores (cambios con fecha).
function ListaGrupo({ items, atenuado, vacio }: {
  items: { key: string; nombre: string; sedeNombre: string; color: string; desde: string; hasta: string | null }[];
  atenuado?: boolean;
  vacio: string;
}) {
  if (!items.length) return <EstadoVacio icon="event_note" titulo={vacio} />;
  return (
    <div className="grid gap-3 max-w-3xl">
      {items.map(i => {
        const ini = parseISO(i.desde);
        return (
          <div key={i.key} className={cn('bg-surface-container-lowest rounded-2xl border border-outline-variant/40 p-4 flex items-center gap-4', atenuado && 'opacity-70')}>
            <div className="text-center w-14 shrink-0">
              <div className={cn('text-2xl font-headline-md font-bold leading-none', atenuado ? 'text-on-surface-variant' : 'text-primary')}>{format(ini, 'd')}</div>
              <div className="text-[10px] uppercase tracking-wider text-on-surface-variant font-bold mt-0.5">{format(ini, 'MMM', { locale: es })}</div>
            </div>
            <div className="w-px self-stretch bg-outline-variant/30 shrink-0" />
            <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">{(i.nombre[0] ?? '?').toUpperCase()}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-on-surface leading-tight truncate">{i.nombre}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: i.color }} />
                <span className="text-xs font-semibold text-on-surface truncate">{i.sedeNombre}</span>
                <span className="text-xs text-on-surface-variant">· desde {format(ini, 'd MMM', { locale: es })}{i.hasta ? ` → ${format(parseISO(i.hasta), 'd MMM', { locale: es })}` : ''}</span>
              </div>
            </div>
          </div>
        );
      })}
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

  // Mes a exportar en el PDF de cambios (por defecto, el mes actual).
  const [mesExport, setMesExport] = useState(() => hoyStr.slice(0, 7));
  const abrirPdfCambios = () =>
    window.open(`/imprimir/movimientos?mes=${mesExport}`, '_blank', 'noopener');
  // PDF de cambios PRÓXIMOS: desde el día seleccionado (fechaVista) hasta fin de mes.
  const abrirPdfDesde = () =>
    window.open(`/imprimir/movimientos?desde=${fechaVista}`, '_blank', 'noopener');

  // Grupo de personal en vista: podólogas (principal), recepción o doctores de baro.
  const qc = useQueryClient();
  const [grupo, setGrupo] = useState<Grupo>('podologas');
  const [asignarSede, setAsignarSede] = useState<Sede | null>(null);
  const mesVista = fechaVista.slice(0, 7); // recepción: mes de la fecha elegida (no solo el actual)

  const { data: compRecep } = useQuery({
    queryKey: ['composicion-mov', mesVista],
    queryFn: () => composicionSedeApi.composicion(mesVista),
    enabled: grupo === 'recepcion',
  });
  const { data: baroRoster } = useQuery({
    queryKey: ['baro-roster-mov', fechaVista],
    queryFn: () => baroSolicitudApi.obtener(undefined, fechaVista),
    enabled: grupo === 'doctores',
  });
  // Catálogos para asignar (todas las recepcionistas / todos los doctores de baro tipo=medico).
  const { data: recepTodas } = useQuery({ queryKey: ['recepcionistas-todas'], queryFn: composicionSedeApi.recepcionistas, enabled: grupo === 'recepcion' });
  const { data: doctoresTodos } = useQuery({ queryKey: ['doctores-baro-todos'], queryFn: composicionSedeApi.doctores, enabled: grupo === 'doctores' });

  // Recepción por sede (roster del mes desde Composición) — con asignacionId para poder quitar.
  const recepPorSede: Record<string, PersonaGrupo[]> = {};
  (compRecep?.sedes ?? []).forEach(s => { recepPorSede[s.sedeId] = s.recepcionistas.map(r => ({ id: r.id, nombre: r.nombre, asignacionId: r.asignacionId })); });
  // Doctores de baro por sede (solo tipo=medico; las podólogas por-solicitud no cuentan aquí).
  const doctoresPorSede: Record<string, PersonaGrupo[]> = {};
  (baroRoster?.porSolicitud ?? []).filter(p => p.tipo === 'medico' && p.sedeId).forEach(p => {
    (doctoresPorSede[p.sedeId!] ??= []).push({ id: p.id, nombre: p.nombre });
  });

  const invalidarGrupos = () => {
    qc.invalidateQueries({ queryKey: ['composicion-mov'] });
    qc.invalidateQueries({ queryKey: ['baro-roster-mov'] });
    qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
    qc.invalidateQueries({ queryKey: ['citas'] });
  };

  // Asignar (recepción → AsignacionAdministrativa; doctores → roster de baro temporal).
  const asignarMut = useMutation({
    mutationFn: async (d: { personaId: string; fechaInicio: string; fechaFin: string | null; motivo: string }) => {
      const sedeId = asignarSede!.id;
      if (grupo === 'recepcion') {
        await composicionSedeApi.crearAsignacion({ sedeId, fechaInicio: d.fechaInicio, fechaFin: d.fechaFin, recepcionistaId: d.personaId });
      } else {
        await baroSolicitudApi.agregar(d.personaId, sedeId, { fechaInicio: d.fechaInicio, fechaFin: d.fechaFin, motivo: d.motivo });
      }
    },
    onSuccess: () => { invalidarGrupos(); setAsignarSede(null); toast.success('Asignación guardada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const quitarPersona = (persona: PersonaGrupo, sedeId: string) => {
    if (!confirm(`¿Quitar a ${persona.nombre} de esta sede?`)) return;
    const accion = grupo === 'recepcion'
      ? (persona.asignacionId ? composicionSedeApi.eliminarAsignacion(persona.asignacionId) : Promise.reject(new Error('No hay asignación de este mes que quitar')))
      : baroSolicitudApi.quitar(persona.id, sedeId);
    accion.then(() => { invalidarGrupos(); toast.success('Quitado de la sede'); }).catch((e: Error) => toast.error(e.message));
  };

  // Mover por DRAG & DROP: DATE-FORWARD (respeta el historial). El cambio rige DESDE la fecha
  // elegida: la sede vieja se CIERRA el día anterior (sin borrar el pasado) y la nueva arranca
  // en la fecha elegida. Nunca se toca nada antes de esa fecha.
  const moverMut = useMutation({
    mutationFn: async ({ persona, fromSedeId, toSedeId }: { persona: PersonaGrupo; fromSedeId: string; toSedeId: string }) => {
      const cierre = format(addDays(parseISO(fechaVista), -1), 'yyyy-MM-dd'); // último día en la sede vieja
      const finMes = format(endOfMonth(parseISO(fechaVista)), 'yyyy-MM-dd'); // el arrastre rige hasta fin de mes (28/29/30/31); la auto-renovación lo continúa
      if (grupo === 'recepcion') {
        // Atómico en backend: cierra la vieja + crea la nueva [fechaVista → fin de mes] en una tx.
        if (persona.asignacionId) await composicionSedeApi.moverAsignacion(persona.asignacionId, { sedeId: toSedeId, desde: fechaVista });
        else await composicionSedeApi.crearAsignacion({ sedeId: toSedeId, fechaInicio: fechaVista, fechaFin: finMes, recepcionistaId: persona.id });
      } else {
        await baroSolicitudApi.quitar(persona.id, fromSedeId, cierre); // cierra, no borra
        await baroSolicitudApi.agregar(persona.id, toSedeId, { fechaInicio: fechaVista, fechaFin: finMes, motivo: 'OTRO' });
      }
    },
    onSuccess: () => { invalidarGrupos(); toast.success('Movido de sede'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const onMover = (persona: PersonaGrupo, fromSedeId: string, toSedeId: string) => moverMut.mutate({ persona, fromSedeId, toSedeId });

  // Candidatos para el modal (los que aún no están en esa sede).
  const candidatosAsignar = (() => {
    if (!asignarSede) return [] as { id: string; nombre: string }[];
    if (grupo === 'recepcion') {
      const ya = new Set((recepPorSede[asignarSede.id] ?? []).map(p => p.id));
      return (recepTodas ?? []).filter(r => r.activo && !ya.has(r.id)).map(r => ({ id: r.id, nombre: r.nombre }));
    }
    const ya = new Set((doctoresPorSede[asignarSede.id] ?? []).map(p => p.id));
    return (doctoresTodos ?? []).filter(d => !ya.has(d.id)).map(d => ({ id: d.id, nombre: d.nombre }));
  })();

  // ── Próximos / Historial por grupo (recepción y doctores) desde sus propias fuentes ──
  const sedeColorMap = new Map(sedesActivas.map(s => [s.id, s.color] as const));
  const ddmmyyyyAYmd = (s: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(s) ? s.split('/').reverse().join('-') : s);
  // Se cargan apenas se elige el grupo (no solo en la vista Próximos/Historial) para que el
  // CONTADOR del tab "Próximos" aparezca de una, sin tener que entrar a esa vista.
  const { data: recepAsigs } = useQuery({ queryKey: ['recep-asigs-mov'], queryFn: () => composicionSedeApi.asignaciones(), enabled: grupo === 'recepcion' });
  const { data: baroTodos } = useQuery({ queryKey: ['baro-todos-mov'], queryFn: () => baroSolicitudApi.obtener(), enabled: grupo === 'doctores' });
  const listaGrupo: { key: string; nombre: string; sedeNombre: string; color: string; desde: string; hasta: string | null }[] =
    grupo === 'recepcion'
      ? (recepAsigs ?? []).filter(a => a.cargo === 'recepcionista').map(a => ({ key: a.id, nombre: a.personaNombre, sedeNombre: a.sedeNombre, color: sedeColorMap.get(a.sedeId) ?? '#94a3b8', desde: ddmmyyyyAYmd(a.fechaInicio), hasta: a.fechaFin ? ddmmyyyyAYmd(a.fechaFin) : null }))
      : grupo === 'doctores'
        ? (baroTodos?.porSolicitud ?? []).filter(p => p.tipo === 'medico' && p.sedeId).map(p => ({ key: `${p.id}-${p.sedeId}-${p.fechaInicio ?? ''}`, nombre: p.nombre, sedeNombre: p.sedeNombre ?? '', color: sedeColorMap.get(p.sedeId!) ?? '#94a3b8', desde: p.fechaInicio ?? '', hasta: p.fechaFin ?? null }))
        : [];
  const proximosGrupo = listaGrupo.filter(i => i.desde && i.desde > hoyStr).sort((a, b) => a.desde.localeCompare(b.desde));
  const historialGrupo = listaGrupo.filter(i => i.hasta && i.hasta < hoyStr).sort((a, b) => (b.hasta ?? '').localeCompare(a.hasta ?? ''));

  const VISTAS: { id: Vista; label: string; icon: string; count?: number }[] = [
    { id: 'hoy',       label: 'Hoy',       icon: 'today' },
    { id: 'proximo',   label: 'Próximos',  icon: 'schedule', count: grupo === 'podologas' ? proximosCount : proximosGrupo.length },
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
        <div className="flex items-center gap-2 shrink-0">
          {/* Exportar cambios del mes a PDF (reutiliza la vista de impresión /imprimir/movimientos). */}
          <div className="flex items-center bg-surface-container-low border border-outline-variant/50 rounded-xl overflow-hidden shadow-xs">
            <input
              type="month"
              value={mesExport}
              onChange={e => e.target.value && setMesExport(e.target.value)}
              className="bg-transparent text-sm text-on-surface px-3 py-2 outline-none [color-scheme:light]"
              aria-label="Mes a exportar"
            />
            <button
              onClick={abrirPdfCambios}
              title="Exportar los cambios del mes a PDF"
              className="flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-bold text-primary border-l border-outline-variant/50 hover:bg-primary/10 transition-colors"
            >
              <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
              Exportar PDF
            </button>
          </div>
          <button
            onClick={abrirPdfDesde}
            title="PDF de los cambios próximos: desde el día seleccionado hasta fin de mes"
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-outline-variant/50 bg-surface-container-low text-sm font-bold text-primary hover:bg-primary/10 transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-lg">event_upcoming</span>
            PDF próximos
          </button>
          {canWrite && (
            <button
              onClick={() => abrirNuevo()}
              className="bg-primary text-white px-4 py-2.5 rounded-xl font-body-md font-bold shadow-md shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">add_circle</span>
              Nuevo movimiento
            </button>
          )}
        </div>
      </header>

      {/* Barra de control: grupo + cambio de vista + buscador */}
      <div className="px-8 py-4 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-wrap items-center gap-4 shrink-0">
        {/* Selector de GRUPO de personal (podólogas / recepción / doctores baro) */}
        <div className="inline-flex items-center bg-surface-container-low border border-outline-variant/40 rounded-xl p-1 shadow-xs gap-1">
          {GRUPOS.map(g => {
            const activo = grupo === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setGrupo(g.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all',
                  activo ? 'bg-primary text-white shadow-md shadow-primary/20' : 'text-on-surface-variant hover:bg-surface-container-lowest hover:text-on-surface',
                )}
              >
                <span className="material-symbols-outlined text-base">{g.icon}</span>
                {g.label}
              </button>
            );
          })}
        </div>
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
        {grupo === 'recepcion' ? (
          vista === 'hoy' ? (
            <div className="flex flex-col gap-5">
              <NavegadorFecha fecha={fechaVista} hoy={hoyStr} onChange={setFechaVista} />
              <GrupoTablero
                sedes={sedesActivas}
                porSede={recepPorSede}
                vacio="Sin recepcionistas"
                ayuda="Recepción por sede. Arrastra una tarjeta a otra sede para MOVERLA; o usa el + para asignar y la ✕ para quitar."
                canWrite={canWrite}
                onAsignar={setAsignarSede}
                onQuitar={quitarPersona}
                onMover={onMover}
              />
            </div>
          ) : (
            <ListaGrupo
              items={vista === 'proximo' ? proximosGrupo : historialGrupo}
              atenuado={vista === 'historial'}
              vacio={vista === 'proximo' ? 'No hay recepcionistas con cambios próximos' : 'Sin historial de recepción'}
            />
          )
        ) : grupo === 'doctores' ? (
          vista === 'hoy' ? (
            <div className="flex flex-col gap-5">
              <NavegadorFecha fecha={fechaVista} hoy={hoyStr} onChange={setFechaVista} />
              <GrupoTablero
                sedes={sedesActivas}
                porSede={doctoresPorSede}
                vacio="Sin doctores de baro"
                ayuda="Doctores de baro por sede (vigentes al día elegido). Arrastra una tarjeta a otra sede para MOVERLA; o usa el + para asignar y la ✕ para quitar."
                canWrite={canWrite}
                onAsignar={setAsignarSede}
                onQuitar={quitarPersona}
                onMover={onMover}
              />
            </div>
          ) : (
            <ListaGrupo
              items={vista === 'proximo' ? proximosGrupo : historialGrupo}
              atenuado={vista === 'historial'}
              vacio={vista === 'proximo' ? 'No hay doctores con cambios próximos' : 'Sin historial de doctores'}
            />
          )
        ) : cargando ? (
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

      {asignarSede && (grupo === 'recepcion' || grupo === 'doctores') && (
        <AsignarPersonaModal
          titulo={grupo === 'recepcion' ? 'Asignar recepcionista' : 'Asignar doctor de baro'}
          sedeNombre={asignarSede.nombre}
          candidatos={candidatosAsignar}
          conMotivo={grupo === 'doctores'}
          guardando={asignarMut.isPending}
          fechaBase={fechaVista}
          onGuardar={(d) => asignarMut.mutate(d)}
          onCerrar={() => setAsignarSede(null)}
        />
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
