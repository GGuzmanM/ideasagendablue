import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TURNOS_ALMUERZO, horasEnMinutos } from '@limablue/shared';
import { cn } from '../../utils/cn';
import type { BloqueoAlmuerzo } from '../../api/almuerzos';
import {
  useAlmuerzosData,
  useAsignarAlmuerzo,
  type ProfesionalConAlmuerzo,
  type BloqueDia,
} from '../../services/almuerzosService';

// ─── Mini-horario del día del especialista (visual: citas + zona de almuerzo) ─
function MiniHorarioDia({
  rango,
  bloques,
  turnoSel,
}: {
  rango: { iniMin: number; finMin: number };
  bloques: BloqueDia[];
  turnoSel: string;
}) {
  const total = rango.finMin - rango.iniMin;
  const pct = (min: number) => ((min - rango.iniMin) / total) * 100;
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  // Marcas de hora: inicio y fin del turno + las horas de la zona de almuerzo (12–15).
  const marcas = [...new Set([rango.iniMin, 12 * 60, 13 * 60, 14 * 60, 15 * 60, rango.finMin])]
    .filter((m) => m >= rango.iniMin && m <= rango.finMin)
    .sort((a, b) => a - b);

  const selIni = turnoSel ? horasEnMinutos(turnoSel) : null;

  return (
    <div className="mb-3">
      <p className="font-label-caps text-[10px] text-on-surface-variant uppercase tracking-wider mb-1.5">
        Franja de almuerzo hoy ({fmt(rango.iniMin)} – {fmt(rango.finMin)})
      </p>
      <div className="relative h-9 bg-tertiary-fixed/25 rounded-lg border border-outline-variant/40 overflow-hidden">
        {/* Divisores por hora (los 3 turnos de la franja) */}
        {marcas.slice(1, -1).map((m) => (
          <div key={m} className="absolute top-0 bottom-0 w-px bg-outline-variant/50" style={{ left: `${pct(m)}%` }} />
        ))}
        {/* Turno seleccionado resaltado */}
        {selIni != null && (
          <div
            className="absolute top-0 bottom-0 border-2 border-primary bg-primary/10 rounded-md z-10"
            style={{ left: `${pct(selIni)}%`, width: `${pct(selIni + 60) - pct(selIni)}%` }}
          />
        )}
        {/* Citas del día (ocupado) */}
        {bloques.map((b, i) => (
          <div
            key={i}
            title={b.label}
            className="absolute top-1 bottom-1 bg-primary/70 rounded-sm"
            style={{
              left: `${pct(Math.max(b.iniMin, rango.iniMin))}%`,
              width: `${Math.max(pct(Math.min(b.finMin, rango.finMin)) - pct(Math.max(b.iniMin, rango.iniMin)), 1)}%`,
            }}
          />
        ))}
      </div>
      {/* Marcas de hora */}
      <div className="relative h-4 mt-0.5">
        {marcas.map((m) => (
          <span
            key={m}
            className="absolute -translate-x-1/2 font-mono-label text-[9px] text-on-surface-variant"
            style={{ left: `${pct(m)}%` }}
          >
            {fmt(m)}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-on-surface-variant">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary/70 inline-block" /> Citas agendadas</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm border-2 border-primary bg-primary/10 inline-block" /> Turno elegido</span>
      </div>
    </div>
  );
}

// ─── Popover de asignación (turno + ocupación de HOY por franja) ──────────────
function PopoverAsignar({
  profesional,
  sedeId,
  onClose,
}: {
  profesional: ProfesionalConAlmuerzo;
  sedeId: string;
  onClose: () => void;
}) {
  const {
    turnoSel, setTurnoSel, ocupacion, cargandoOcupacion, crearMutation,
    rangoDia, bloquesDia, conflicto, citasEnTurnoSel, confirmar,
  } = useAsignarAlmuerzo(profesional, sedeId, onClose);

  return (
    <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-surface-container-lowest border border-outline-variant/50 rounded-xl shadow-xl p-4">
      <p className="font-headline-sm text-sm font-semibold text-on-surface mb-2">Turno de almuerzo</p>

      {/* Mini-visualización del calendario del día del especialista */}
      {cargandoOcupacion ? (
        <div className="h-14 mb-3 rounded-lg bg-surface-container-low animate-pulse" />
      ) : (
        <MiniHorarioDia rango={rangoDia} bloques={bloquesDia} turnoSel={turnoSel} />
      )}

      <p className="font-body-md text-xs text-on-surface-variant mb-2">
        Elige la franja (se marca en el horario de arriba):
      </p>
      <div className="space-y-1.5 mb-4">
        {ocupacion.map((t) => {
          const activo = turnoSel === t.horaInicio;
          const libre = t.citas === 0;
          return (
            <button
              key={t.id}
              onClick={() => setTurnoSel(t.horaInicio)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm border transition-all',
                activo
                  ? 'bg-primary/5 border-primary text-on-surface font-semibold'
                  : 'border-outline-variant/60 text-on-surface-variant hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              {/* Radio clásico */}
              <span
                className={cn(
                  'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                  activo ? 'border-primary' : 'border-outline-variant',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full bg-primary transition-transform', activo ? 'scale-100' : 'scale-0')} />
              </span>
              <span className="font-mono-label text-xs">{t.label}</span>
              {/* Semáforo de ocupación de HOY */}
              <span
                className={cn(
                  'ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                  cargandoOcupacion
                    ? 'bg-surface-container-high text-on-surface-variant'
                    : libre
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-800',
                )}
              >
                {cargandoOcupacion ? '…' : libre ? 'Libre hoy' : `${t.citas} cita${t.citas === 1 ? '' : 's'} hoy`}
              </span>
            </button>
          );
        })}
      </div>
      {/* Mini-banner: el turno elegido CHOCA con citas ya agendadas hoy → no se registra */}
      {conflicto && (
        <div className="mb-3 p-2.5 bg-error-container/60 border border-error/30 rounded-lg flex items-start gap-2">
          <span className="material-symbols-outlined text-error text-[18px] shrink-0">warning</span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-on-error-container">
              Tiene cita para la hora seleccionada
            </p>
            <p className="text-[11px] text-on-error-container/90 truncate">
              {citasEnTurnoSel.map((c) => c.label).join(' · ')} — elige otro turno.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 text-xs font-semibold text-on-surface border border-outline-variant rounded-lg hover:bg-surface-container-high transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={confirmar}
          disabled={!turnoSel || conflicto || crearMutation.isPending}
          className="flex-1 py-2 text-xs font-bold text-on-primary bg-primary hover:opacity-90 disabled:opacity-40 rounded-lg transition-all shadow-sm shadow-primary/20"
          title={conflicto ? 'Tiene cita en esa franja hoy — elige otro turno' : undefined}
        >
          {crearMutation.isPending ? '…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}

// ─── Modal de confirmación de eliminación ─────────────────────────────────────
function ModalEliminar({
  bloqueo,
  sedeName,
  onConfirm,
  onClose,
  pending,
}: {
  bloqueo: BloqueoAlmuerzo;
  sedeName: string;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  const turno = TURNOS_ALMUERZO.find((t) => t.horaInicio === bloqueo.horaInicio);
  const nombre = `${bloqueo.profesional.nombres.split(' ')[0]} ${bloqueo.profesional.apellidos.split(' ')[0]}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-[2px]">
      <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface mb-1">Eliminar horario de almuerzo</h3>
        <div className="mt-3 p-3 bg-surface-container-low rounded-xl border border-outline-variant/40 mb-4">
          <p className="font-semibold text-on-surface text-sm">{nombre}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{turno?.label}{sedeName ? ` · ${sedeName}` : ''}</p>
        </div>
        <p className="text-sm text-on-surface-variant mb-5">
          Se eliminará de todos los días restantes de su estancia en esta sede. Podrás volver a crearlo en cualquier momento.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 text-sm font-semibold text-on-surface border border-outline-variant rounded-xl hover:bg-surface-container-high transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 py-2 text-sm font-bold text-on-error bg-error hover:opacity-90 disabled:opacity-40 rounded-xl transition-all"
          >
            {pending ? 'Eliminando…' : 'Sí, eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fila de profesional (diseño mockup: avatar · nombre · estado · acción) ───
function FilaProfesional({
  prof,
  sedeId,
  onEliminar,
}: {
  prof: ProfesionalConAlmuerzo;
  sedeId: string;
  onEliminar: (b: BloqueoAlmuerzo) => void;
}) {
  const [mostrando, setMostrando] = useState(false);
  const iniciales = `${prof.nombres[0] ?? ''}${prof.apellidos[0] ?? ''}`.toUpperCase();
  const turno = prof.almuerzo ? TURNOS_ALMUERZO.find((t) => t.horaInicio === prof.almuerzo!.horaInicio) : null;
  const tipoLabel = prof.tipo === 'podologa' ? 'Podóloga' : 'Fisioterapeuta';
  const noDisponible = prof.noDisponibleMotivo !== null;

  return (
    <div
      className={cn(
        'flex items-center justify-between p-4 bg-surface-container-lowest hover:bg-surface-container-low transition-colors',
        noDisponible && 'opacity-75',
      )}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm text-white shrink-0"
          style={{ backgroundColor: prof.colorAvatar }}
        >
          {iniciales}
        </div>
        <div className="min-w-0">
          <div className="font-headline-sm text-sm text-on-background flex items-center gap-1 flex-wrap">
            {prof.nombres.split(' ')[0]} {prof.apellidos.split(' ')[0]}
            <span className="text-outline">·</span>
            <span className="text-on-surface-variant font-normal">{tipoLabel}</span>
            {prof.noDisponibleMotivo === 'vacaciones' && (
              <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300/70">
                🌴 Vacaciones
              </span>
            )}
            {prof.noDisponibleMotivo === 'no_trabaja' && (
              <span className="ml-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant border border-outline-variant/50">
                No trabaja hoy
              </span>
            )}
          </div>
          {prof.almuerzo ? (
            <div className="font-body-md text-sm mt-0.5">
              <span className="text-tertiary font-semibold">🍽 Almuerzo {turno?.label}</span>
              <span className="text-on-surface-variant text-xs ml-2">
                Registrado por {prof.almuerzo.creadoPorUsuario?.nombre ?? '—'} el{' '}
                {format(new Date(prof.almuerzo.creadoEn), "d 'de' MMM yyyy", { locale: es })}
              </span>
            </div>
          ) : (
            <div className="font-body-md text-sm text-on-surface-variant mt-0.5">Sin horario de almuerzo</div>
          )}
        </div>
      </div>

      {/* Acción */}
      {prof.almuerzo ? (
        <button
          onClick={() => onEliminar(prof.almuerzo!)}
          className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/40 rounded-lg transition-all shrink-0"
          title="Eliminar almuerzo"
        >
          <span className="material-symbols-outlined text-[20px]">delete</span>
        </button>
      ) : noDisponible ? null : (
        <div className="relative shrink-0">
          <button
            onClick={() => setMostrando((v) => !v)}
            className="px-4 py-2 rounded-lg border border-outline-variant text-primary font-headline-sm text-sm hover:bg-primary/5 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span> Asignar
          </button>
          {mostrando && (
            <PopoverAsignar profesional={prof} sedeId={sedeId} onClose={() => setMostrando(false)} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página (front — todo el back vive en almuerzosService) ──────────────────
export function AlmuerzosPage({
  hideHeader = false,
  hideSedeTabs = false,
  sedeId: externalSedeId,
}: {
  hideHeader?: boolean;
  hideSedeTabs?: boolean;
  sedeId?: string;
}) {
  const {
    sedes,
    sedeId,
    setSedeSelId,
    sedeActual,
    loading,
    disponibles,
    noDisponibles,
    conteos,
    maxConteo,
    confirmando,
    setConfirmando,
    eliminarMutation,
  } = useAlmuerzosData(externalSedeId);

  return (
    <div className="flex-1 overflow-y-auto bg-background text-on-background">
      <div className="max-w-4xl mx-auto p-container-padding">
        {/* Page Header */}
        {!hideHeader && (
          <div className="mb-8 flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-tertiary-fixed-dim/20 flex items-center justify-center text-tertiary shrink-0">
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                restaurant
              </span>
            </div>
            <div>
              <h2 className="font-headline-md text-headline-md text-on-background">Horarios de almuerzo</h2>
              <p className="font-body-md text-body-md text-on-surface-variant mt-1">
                Bloqueo de 1 hora fija en la agenda de cada profesional
              </p>
            </div>
          </div>
        )}

        {/* Location Tabs */}
        {!hideSedeTabs && (
          <div className="border-b border-outline-variant/30 mb-6 flex overflow-x-auto">
            {sedes.map((s) => (
              <button
                key={s.id}
                onClick={() => setSedeSelId(s.id)}
                className={cn(
                  'px-6 py-3 border-b-2 font-headline-sm text-sm whitespace-nowrap transition-colors',
                  sedeId === s.id
                    ? 'border-primary text-primary bg-surface-variant/10'
                    : 'border-transparent text-on-surface-variant font-medium hover:text-primary',
                )}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : disponibles.length === 0 && noDisponibles.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant">
            <p className="text-2xl mb-2">🍽</p>
            <p className="text-sm">No hay profesionales elegibles en esta sede</p>
          </div>
        ) : (
          <>
            {/* Staff List (disponibles hoy) */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/50 shadow-sm overflow-visible flex flex-col gap-[1px] bg-outline-variant/20">
              {disponibles.map((prof) => (
                <FilaProfesional key={prof.id} prof={prof} sedeId={sedeId} onEliminar={setConfirmando} />
              ))}
              {disponibles.length === 0 && (
                <div className="p-6 bg-surface-container-lowest text-center text-sm text-on-surface-variant">
                  Ningún profesional disponible hoy en esta sede.
                </div>
              )}
            </div>

            {/* No disponibles hoy (bug fix: vacaciones / sin turno hoy — colapsados) */}
            {noDisponibles.length > 0 && (
              <details className="mt-4 group">
                <summary className="cursor-pointer text-xs font-semibold text-on-surface-variant hover:text-on-surface select-none">
                  No disponibles hoy ({noDisponibles.length}) — vacaciones o sin turno ▾
                </summary>
                <div className="mt-2 bg-surface-container-lowest rounded-xl border border-outline-variant/50 shadow-sm overflow-visible flex flex-col gap-[1px] bg-outline-variant/20">
                  {noDisponibles.map((prof) => (
                    <FilaProfesional key={prof.id} prof={prof} sedeId={sedeId} onEliminar={setConfirmando} />
                  ))}
                </div>
              </details>
            )}

            {/* Distribución de almuerzos (siempre visible, según el mockup) */}
            <div className="mt-8 bg-surface-container-lowest rounded-xl border border-outline-variant/50 shadow-sm p-6">
              <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-6 uppercase">
                Distribución de almuerzos — {sedeActual?.nombre ?? ''}
              </h3>
              <div className="space-y-4">
                {conteos.map((c) => (
                  <div key={c.id} className="flex items-center gap-4">
                    <div className="w-20 font-mono-label text-mono-label text-on-surface-variant shrink-0">
                      {c.horaInicio} -<br />{c.horaFin}
                    </div>
                    <div className="flex-1 h-2 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className="h-full bg-tertiary-fixed-dim/80 rounded-full transition-all duration-300"
                        style={{ width: `${(c.count / maxConteo) * 100}%` }}
                      />
                    </div>
                    <div className="w-28 text-right font-body-md text-sm text-on-surface-variant shrink-0">
                      {c.count} {c.count === 1 ? 'profesional' : 'profesionales'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {confirmando && (
        <ModalEliminar
          bloqueo={confirmando}
          sedeName={sedeActual?.nombre ?? ''}
          onConfirm={() => eliminarMutation.mutate(confirmando.id)}
          onClose={() => setConfirmando(null)}
          pending={eliminarMutation.isPending}
        />
      )}
    </div>
  );
}
