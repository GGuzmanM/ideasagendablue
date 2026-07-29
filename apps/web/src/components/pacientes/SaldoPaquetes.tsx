// UN solo componente de saldos de paquetes/membresías con tres variantes:
//   compact — ícono + saldo total (búsqueda de pacientes), tooltip con desglose.
//   chip    — pastillas por paquete (PopoverCita), con semáforo y resaltado.
//   detalle — tarjetas con anillo de progreso + timeline (ficha del paciente).
// TODAS las vistas consumen usePaquetesPaciente (misma queryKey) — el saldo llega
// derivado del servidor y se actualiza en todas a la vez tras cada consumo.
// Cero edición de saldos en toda la UI: solo consumos/anulaciones trazables.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import { Skeleton } from '../ui/Skeleton';
import { useAuthStore } from '../../stores/authStore';
import {
  usePaquetesPaciente,
  useInvalidarPaquetes,
  paquetesSesionesApi,
  type PaquetePacienteSaldo,
} from '../../api/paquetesSesiones';
import { VisorHistorialGenexis } from './HistorialGenexis';

const fmtFecha = (f: string) => format(new Date(f + 'T12:00:00'), 'd MMM yyyy', { locale: es });

function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null;
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return Math.ceil((new Date(fecha + 'T12:00:00').getTime() - hoy.getTime()) / 86_400_000);
}

// Semáforo: verde saldo >2 · ámbar ≤2 o vigencia <15 días · rojo agotado/vencido.
export function semaforo(p: PaquetePacienteSaldo): 'verde' | 'ambar' | 'rojo' {
  if (p.estado === 'AGOTADO' || p.estado === 'VENCIDO' || p.estado === 'ANULADO') return 'rojo';
  const dias = diasHasta(p.vigenciaFin);
  if (p.saldo <= 2 || (dias !== null && dias < 15)) return 'ambar';
  return 'verde';
}

const CLASE_SEMAFORO: Record<string, string> = {
  verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ambar: 'bg-amber-50 text-amber-700 border-amber-300',
  rojo: 'bg-red-50 text-red-600 border-red-200',
};

interface SaldoPaquetesProps {
  pacienteId: string;
  variante: 'compact' | 'chip' | 'detalle';
  /** detalle: para abrir el visor Genexis desde la evidencia de una apertura. */
  nombrePaciente?: string;
  documento?: string;
  /** chip: servicio+sede de la cita actual → resalta el chip que puede consumir. */
  servicioActualId?: string;
  sedeActualId?: string;
  onChipClick?: (paquete: PaquetePacienteSaldo) => void;
}

export function SaldoPaquetes({ pacienteId, variante, servicioActualId, sedeActualId, onChipClick, nombrePaciente, documento }: SaldoPaquetesProps) {
  const { data: paquetes, isLoading, isError, refetch } = usePaquetesPaciente(pacienteId);

  if (isLoading) {
    return variante === 'detalle' ? <Skeleton className="h-24 w-full" /> : <span className="text-[10px] text-slate-300">…</span>;
  }
  if (isError) {
    return variante === 'detalle' ? (
      <button onClick={() => refetch()} className="text-xs text-red-500 hover:underline">Error al cargar paquetes — reintentar</button>
    ) : null;
  }
  const activos = (paquetes ?? []).filter((p) => p.estado === 'ACTIVO');

  // ── compact: búsqueda — saldo total + tooltip con desglose ──
  if (variante === 'compact') {
    if (activos.length === 0) return null;
    const total = activos.reduce((s, p) => s + p.saldo, 0);
    const desglose = activos.map((p) => `${p.nombre}: ${p.saldo} rest. (${p.sede?.nombre ?? 's/sede'})`).join('\n');
    return (
      <span
        title={desglose}
        className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-limablue-700 bg-limablue-50 border border-limablue-200 rounded-full px-1.5 py-0.5"
      >
        📦 {total}
      </span>
    );
  }

  // ── chip: PopoverCita — pastilla por paquete activo, resaltada si aplica a la cita ──
  if (variante === 'chip') {
    if (activos.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {activos.map((p) => {
          const sem = semaforo(p);
          const aplicaAqui =
            !!servicioActualId &&
            p.sede?.id === sedeActualId &&
            (p.servicioNuevoId === servicioActualId || (p.composicion ?? []).some((i) => i.servicioId === servicioActualId));
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChipClick?.(p)}
              title={aplicaAqui ? 'Esta cita puede consumir de aquí' : `${p.nombre} · ${p.sede?.nombre ?? ''}`}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-all',
                CLASE_SEMAFORO[sem],
                aplicaAqui && 'ring-2 ring-limablue-400 ring-offset-1'
              )}
            >
              📦 {p.nombre.length > 26 ? p.nombre.slice(0, 25) + '…' : p.nombre}
              <span className="font-bold">{p.consumidas}/{p.sesionesTotal}</span>
              {p.vigenciaFin && <span className="font-normal">· vence {fmtFecha(p.vigenciaFin)}</span>}
            </button>
          );
        })}
      </div>
    );
  }

  // ── detalle: ficha — banner sin plan activo / tarjetas con composición; agotados colapsados ──
  const historicos = (paquetes ?? []).filter((p) => p.estado !== 'ACTIVO');
  return (
    <div className="space-y-3">
      {activos.length > 0 ? (
        activos.map((p) => <TarjetaPaquete key={p.id} paquete={p} pacienteId={pacienteId} nombrePaciente={nombrePaciente} documento={documento} />)
      ) : (
        // Banner "sin plan activo" (diseño idea1)
        <div className="bg-gradient-to-r from-primary/5 to-surface-container-lowest rounded-2xl border border-primary/20 p-6 flex flex-col md:flex-row items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute -right-16 -top-16 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
          <div className="z-10">
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">Paquetes y membresías</h3>
            <p className="text-on-surface-variant mt-0.5">Este paciente aún no cuenta con planes de salud activos.</p>
          </div>
          {/* Estético por ahora (sin acción): más adelante llevará a vender/asignar membresía */}
          <button
            type="button"
            className="z-10 px-6 py-2 border-2 border-primary text-primary font-bold rounded-xl hover:bg-primary hover:text-on-primary transition-all shrink-0"
            title="Próximamente"
          >
            Explorar Programas
          </button>
        </div>
      )}
      {historicos.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-on-surface-variant hover:text-on-surface">
            Agotados / vencidos ({historicos.length}) ▾
          </summary>
          <div className="mt-2 space-y-2 opacity-75">
            {historicos.map((p) => <TarjetaPaquete key={p.id} paquete={p} pacienteId={pacienteId} nombrePaciente={nombrePaciente} documento={documento} />)}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── Tarjeta detalle con anillo de progreso + timeline de consumos ────────────

function TarjetaPaquete({ paquete: p, pacienteId, nombrePaciente, documento }: { paquete: PaquetePacienteSaldo; pacienteId: string; nombrePaciente?: string; documento?: string }) {
  const [visorGenexis, setVisorGenexis] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [corrigiendoTamano, setCorrigiendoTamano] = useState(false);
  const rol = useAuthStore((s) => s.usuario?.rol);
  const invalidar = useInvalidarPaquetes();
  const sem = semaforo(p);
  const apertura = p.consumos.filter((c) => c.origen === 'APERTURA');
  const dotSem = sem === 'verde' ? 'bg-emerald-600' : sem === 'ambar' ? 'bg-amber-500' : 'bg-red-500';
  // Totales de la membresía = SUMA de TODOS los servicios de su composición (por membresía).
  // El máximo del anillo = suma de sesiones totales (Σ cantidad), y se descuenta con cada uso.
  // Sin composición (paquete simple) → se usa el saldo agregado del servidor.
  const comp = p.composicion ?? [];
  const totalSesiones = comp.length > 0 ? comp.reduce((s, i) => s + i.cantidad, 0) : p.sesionesTotal;
  const usadasSesiones = comp.length > 0 ? comp.reduce((s, i) => s + i.consumidas, 0) : p.consumidas;
  const restantes = Math.max(totalSesiones - usadasSesiones, 0);
  // Anillo azul = proporción de sesiones RESTANTES (se reduce al consumir).
  const pctRestante = Math.round((restantes / Math.max(totalSesiones, 1)) * 100);

  const anularMutation = useMutation({
    mutationFn: ({ consumoId, motivo }: { consumoId: string; motivo: string }) => paquetesSesionesApi.anularConsumo(consumoId, motivo),
    onSuccess: () => { invalidar(pacienteId); toast.success('Consumo anulado — saldo restaurado'); },
    onError: (e: Error) => toast.error(e.message),
  });
  // Corregir tamaño — SOLO admin (recepción eligió mal, ej. 12 cuando era 4).
  const tamanoMutation = useMutation({
    mutationFn: ({ sesionesTotal, motivo }: { sesionesTotal: number; motivo: string }) => paquetesSesionesApi.corregirTamano(p.id, sesionesTotal, motivo),
    onSuccess: (r) => { invalidar(pacienteId); setCorrigiendoTamano(false); toast.success(`Tamaño corregido — ahora ${r.saldo} restantes`); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {/* Anillo de progreso: el arco azul = sesiones restantes; baja al consumir */}
          <div className="relative w-14 h-14 shrink-0" title={`${restantes} de ${totalSesiones} sesiones disponibles`}>
            <svg viewBox="0 0 36 36" className="w-14 h-14 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E2E8F0" strokeWidth="3.5" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#3525cd" strokeWidth="3.5"
                strokeDasharray={`${pctRestante} 100`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-on-surface">
              {restantes}
            </span>
          </div>
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-3">
              <h3 className="font-headline-sm text-on-surface font-bold truncate">{p.nombre}</h3>
              <span className={cn('px-3 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase inline-flex items-center border shrink-0', CLASE_SEMAFORO[sem])}>
                <span className={cn('w-1.5 h-1.5 rounded-full mr-1 shrink-0', dotSem)} />
                {p.estado}
              </span>
            </div>
            <p className="text-body-md text-on-surface-variant">
              <span className="font-semibold text-on-surface">{usadasSesiones}/{totalSesiones} consumidas</span>
              {' · '}{restantes} restantes
              {p.sede && <> · {p.sede.nombre}</>}
              {p.vigenciaFin && <> · vence {fmtFecha(p.vigenciaFin)}</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Corregir tamaño — SOLO admin (recepción no puede cambiarlo) */}
          {rol === 'admin' && !corrigiendoTamano && (
            <button
              onClick={() => setCorrigiendoTamano(true)}
              className="px-3 py-2 text-amber-700 bg-amber-50 border border-amber-200 font-semibold rounded-lg text-xs hover:bg-amber-100 transition-all"
              title="Corregir el tamaño del paquete si se eligió mal (ej. 12 cuando era 4)"
            >
              ✎ Tamaño
            </button>
          )}
          <button
            onClick={() => setAbierto((v) => !v)}
            className="px-4 py-2 bg-tertiary-fixed text-on-tertiary-fixed font-bold rounded-lg text-sm hover:opacity-90 transition-all"
          >
            Detalle
          </button>
          <button
            onClick={() => setAbierto((v) => !v)}
            className="p-2 text-outline hover:bg-surface-variant/30 rounded-lg transition-all"
            title={abierto ? 'Contraer' : 'Expandir'}
          >
            <span className="material-symbols-outlined">{abierto ? 'expand_less' : 'expand_more'}</span>
          </button>
        </div>
      </div>

      {/* Composición de la membresía (tratamientos incluidos) */}
      {p.composicion && p.composicion.length > 0 && (
        <div className="pt-6 border-t border-outline-variant/20 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-3 gap-x-8 mt-4">
          {p.composicion.map((i, idx) => (
            <div key={idx} className="flex justify-between items-center text-xs">
              <span className="text-on-surface-variant truncate">{i.etiqueta}{i.subcategoriaEtiqueta ? ` (${i.subcategoriaEtiqueta})` : ''}</span>
              <span className="font-bold text-on-surface shrink-0 ml-2">{i.consumidas}/{i.cantidad}</span>
            </div>
          ))}
        </div>
      )}

      {/* Panel de corrección de tamaño (admin) — claro, sin window.prompt */}
      {corrigiendoTamano && (
        <CorregirTamanoForm
          paquete={p}
          onCancelar={() => setCorrigiendoTamano(false)}
          onGuardar={(sesionesTotal, motivo) => tamanoMutation.mutate({ sesionesTotal, motivo })}
          guardando={tamanoMutation.isPending}
        />
      )}

      {abierto && (
        <div className="mt-3 border-t border-slate-100 pt-2 space-y-1.5">
          {/* Línea de apertura Genexis (la firma humana, con lecturas y pro-cliente) */}
          {p.origen === 'GENEXIS_APERTURA' && p.conciliacion && (
            <div className="px-2 py-1.5 rounded-md bg-slate-50 border border-slate-100 text-[11px] text-slate-500">
              🗄️ Saldo inicial Genexis: <b>{apertura.length} consumidas</b> — conciliado por {p.conciliacion.decididoPor}
              {p.conciliacion.decididoEn && ` el ${format(new Date(p.conciliacion.decididoEn), 'd MMM yyyy', { locale: es })}`}
              <span className="text-slate-400"> · lecturas A:{p.conciliacion.lecturaServicio ?? '—'} / B:{p.conciliacion.lecturaObs ?? '—'}</span>
              {p.conciliacion.ajusteProCliente && (
                <span className="ml-1 text-amber-600 font-semibold">· ajuste pro-cliente</span>
              )}
              {' '}
              <button onClick={() => setVisorGenexis(true)} className="text-limablue-600 hover:underline font-semibold">
                Ver evidencia en el visor Genexis →
              </button>
            </div>
          )}
          {/* Timeline de consumos */}
          {p.consumos.filter((c) => c.origen !== 'APERTURA').map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-mono text-slate-400 w-5 text-right">{apertura.length + i + 1}</span>
              <span>{fmtFecha(c.fecha)}</span>
              {c.cita ? (
                <span className="text-slate-500 truncate">
                  · {c.cita.servicio.nombre} · {c.cita.sede.nombre}
                  {c.cita.profesional && ` · ${c.cita.profesional.nombres.split(' ')[0]} ${c.cita.profesional.apellidos.split(' ')[0]}`}
                </span>
              ) : (
                <span className="italic text-slate-400 truncate">· {c.origen === 'AJUSTE_MANUAL' ? `manual: ${c.motivo ?? ''}` : c.origen}</span>
              )}
              {c.origen === 'AJUSTE_MANUAL' && <span className="text-[9px] font-bold text-violet-600 bg-violet-50 rounded px-1">MANUAL</span>}
              {rol === 'admin' && (
                <button
                  onClick={() => {
                    const motivo = window.prompt('Motivo de la anulación (obligatorio):');
                    if (motivo?.trim()) anularMutation.mutate({ consumoId: c.id, motivo: motivo.trim() });
                  }}
                  className="ml-auto text-[10px] text-red-400 hover:text-red-600 shrink-0"
                  title="Anular consumo (admin, con motivo)"
                >
                  anular
                </button>
              )}
            </div>
          ))}
          {/* Válvula de escape: consumo manual (recepción) */}
          {p.estado === 'ACTIVO' && (
            registrando
              ? <ConsumoManualForm paquete={p} pacienteId={pacienteId} onCerrar={() => setRegistrando(false)} />
              : (
                <button onClick={() => setRegistrando(true)} className="text-xs text-limablue-600 hover:underline font-semibold">
                  + Registrar consumo de sesión
                </button>
              )
          )}
        </div>
      )}
      {visorGenexis && (
        <VisorHistorialGenexis
          pacienteId={pacienteId}
          nombrePaciente={nombrePaciente ?? ''}
          documento={documento ?? ''}
          onClose={() => setVisorGenexis(false)}
        />
      )}
    </div>
  );
}

// ─── Corregir tamaño (SOLO admin): panel claro, sin window.prompt ─────────────

function CorregirTamanoForm({ paquete: p, onCancelar, onGuardar, guardando }: {
  paquete: PaquetePacienteSaldo;
  onCancelar: () => void;
  onGuardar: (sesionesTotal: number, motivo: string) => void;
  guardando: boolean;
}) {
  const [nuevo, setNuevo] = useState<number>(p.sesionesTotal);
  const [motivo, setMotivo] = useState('');
  const OPCIONES = [1, 4, 6, 12];
  const cambio = nuevo !== p.sesionesTotal;
  // Aviso si el nuevo tamaño es menor que lo ya consumido (se anulan las de más).
  const perderaConsumos = nuevo < p.consumidas;

  return (
    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2.5">
      <p className="text-sm font-bold text-amber-900">Corregir tamaño del paquete</p>
      <p className="text-xs text-amber-800">
        El paquete está registrado como <b>{p.sesionesTotal} sesiones</b>. Si el paciente en realidad
        compró un paquete de otro tamaño, elige el correcto abajo.
      </p>

      <div>
        <p className="text-[11px] font-semibold text-amber-800 mb-1">¿De cuántas sesiones es el paquete?</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          {OPCIONES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNuevo(n)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all',
                nuevo === n ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'
              )}
            >
              {n === 1 ? '1 (unitaria)' : n}
            </button>
          ))}
          <span className="text-xs text-amber-700 ml-1">otro:</span>
          <input
            type="number"
            min={1}
            max={60}
            value={nuevo}
            onChange={(e) => setNuevo(Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 1)))}
            className="w-16 px-2 py-1.5 rounded-lg border border-amber-300 text-sm text-center"
          />
        </div>
      </div>

      {/* Previsualización clara del resultado */}
      {cambio && (
        <p className="text-xs text-amber-900 bg-white/70 border border-amber-200 rounded-md px-2 py-1.5">
          Quedará en <b>{p.consumidas > nuevo ? nuevo : p.consumidas}/{nuevo} sesiones</b>
          {' '}({nuevo - (p.consumidas > nuevo ? nuevo : p.consumidas)} restantes).
          {perderaConsumos && <span className="block text-red-600 font-semibold mt-0.5">⚠ Ya tiene {p.consumidas} consumidas: las {p.consumidas - nuevo} de más se anularán.</span>}
        </p>
      )}

      <div>
        <p className="text-[11px] font-semibold text-amber-800 mb-1">Motivo de la corrección <span className="text-red-500">*</span></p>
        <input
          className="w-full px-2 py-1.5 rounded-lg border border-amber-300 text-sm"
          placeholder="Ej. recepción eligió 12 pero el historial dice paquete de 4"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-0.5">
        <button
          onClick={() => onGuardar(nuevo, motivo.trim())}
          disabled={guardando || !cambio || motivo.trim().length < 3}
          className="btn-primary btn-sm disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar corrección'}
        </button>
        <button onClick={onCancelar} className="btn-secondary btn-sm">Cancelar</button>
      </div>
      {!cambio && <p className="text-[11px] text-amber-700">Elige un tamaño distinto al actual para poder guardar.</p>}
    </div>
  );
}

// ─── Consumo manual: exige cita del día O motivo escrito ──────────────────────

function ConsumoManualForm({ paquete, pacienteId, onCerrar }: { paquete: PaquetePacienteSaldo; pacienteId: string; onCerrar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [citaId, setCitaId] = useState('');
  const invalidar = useInvalidarPaquetes();
  const mutation = useMutation({
    mutationFn: () => paquetesSesionesApi.consumoManual(paquete.id, { citaId: citaId || undefined, motivo: motivo.trim() || undefined }),
    onSuccess: (r) => { invalidar(pacienteId); toast.success(`Sesión ${r.numeroSesion} registrada — quedan ${r.saldo}`); onCerrar(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="p-2 rounded-lg bg-violet-50/60 border border-violet-100 space-y-1.5">
      <p className="text-[11px] font-semibold text-violet-700">Consumo manual (auditado): vincula la cita del día o escribe el motivo</p>
      <input className="input text-xs" placeholder="ID de cita del día (opcional)" value={citaId} onChange={(e) => setCitaId(e.target.value)} />
      <textarea className="input text-xs resize-none w-full" rows={2} placeholder="Motivo (obligatorio si no hay cita)…" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || (!citaId.trim() && !motivo.trim())}
          className="btn-primary btn-sm disabled:opacity-50"
        >
          {mutation.isPending ? 'Registrando…' : `Registrar sesión ${paquete.consumidas + 1}`}
        </button>
        <button onClick={onCerrar} className="btn-secondary btn-sm">Cancelar</button>
      </div>
    </div>
  );
}

// ─── Diálogo de consumo al marcar llegada (numeración CONTINUA, FIFO) ─────────

interface DialogoConsumoProps {
  citaId: string;
  pacienteId: string;
  elegibles: PaquetePacienteSaldo[]; // orden FIFO (fechaCompra asc — como llega del endpoint)
  onCerrar: () => void;
}

export function DialogoConsumo({ citaId, pacienteId, elegibles, onCerrar }: DialogoConsumoProps) {
  const [seleccionado, setSeleccionado] = useState(elegibles[0]?.id ?? ''); // FIFO por defecto
  const invalidar = useInvalidarPaquetes();
  const mutation = useMutation({
    mutationFn: () => paquetesSesionesApi.consumirDeCita(citaId, seleccionado),
    onSuccess: (r) => {
      invalidar(pacienteId);
      toast.success(`Sesión ${r.numeroSesion} consumida — quedan ${r.saldo}`);
      onCerrar();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const activo = elegibles.find((p) => p.id === seleccionado) ?? elegibles[0];
  if (!activo) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/40" onClick={onCerrar} />
      <div className="fixed z-[95] left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[380px] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4" role="dialog" aria-label="Consumir sesión de paquete">
        <p className="text-sm font-bold text-slate-900">
          ¿Consumir sesión {activo.consumidas + 1} de {activo.sesionesTotal} del {activo.nombre}?
        </p>
        <p className="text-xs text-slate-500 mt-1">Quedan {activo.saldo - 1} tras consumir · {activo.sede?.nombre}</p>
        {elegibles.length > 1 && (
          <div className="mt-2 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400">Este paciente tiene {elegibles.length} paquetes elegibles (por defecto el más antiguo):</p>
            {elegibles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="radio" checked={seleccionado === p.id} onChange={() => setSeleccionado(p.id)} />
                {p.nombre} — sesión {p.consumidas + 1}/{p.sesionesTotal}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="btn-primary btn-sm flex-1">
            {mutation.isPending ? 'Consumiendo…' : `✓ Consumir sesión ${activo.consumidas + 1}`}
          </button>
          <button onClick={onCerrar} className="btn-secondary btn-sm">Ahora no</button>
        </div>
      </div>
    </>
  );
}
