import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, formatDistanceToNowStrict, parseISO, startOfMonth, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { reservasWebApi, type IntentoReservaWeb, type PasoIntentoWeb, type ResultadoIntentoWeb } from '../api/reservasWeb';
import { cn } from '../utils/cn';

/**
 * RESERVAS WEB · seguimiento (06-oct-2026): quién empezó a reservar en la página pública, hasta qué paso llegó y si
 * terminó. Los que no terminaron se pueden llamar (celular / WhatsApp) y marcar como «contactado» con una nota.
 * Lo usan quienes agendan (permiso citas.crear). Solo aparece en el menú si la reserva web está encendida.
 */
const PASOS: { id: PasoIntentoWeb; label: string }[] = [
  { id: 'sede', label: 'Sede' },
  { id: 'servicio', label: 'Servicio' },
  { id: 'fecha', label: 'Fecha' },
  { id: 'hora', label: 'Hora' },
  { id: 'pago', label: 'Pago' },
];
const RESULTADO: Record<ResultadoIntentoWeb, { label: string; clase: string }> = {
  en_curso: { label: 'Reservando ahora', clase: 'bg-sky-100 text-sky-800' },
  pagando: { label: 'En el pago ahora', clase: 'bg-sky-100 text-sky-800' },
  abandono: { label: 'Abandonó', clase: 'bg-amber-100 text-amber-800' },
  vencio_pagando: { label: 'No terminó de pagar', clase: 'bg-amber-100 text-amber-800' },
  pago_rechazado: { label: 'Pago rechazado', clase: 'bg-rose-100 text-rose-700' },
  pago_sin_cupo: { label: 'Pagó sin cupo', clase: 'bg-rose-100 text-rose-700' },
  reservo: { label: 'Reservó y pagó', clase: 'bg-emerald-100 text-emerald-800' },
  retomo: { label: 'Volvió y reservó', clase: 'bg-emerald-50 text-emerald-700' },
};
const PERIODOS = [
  { id: 'hoy', label: 'Hoy', desde: () => new Date() },
  { id: '7', label: 'Últimos 7 días', desde: () => subDays(new Date(), 6) },
  { id: 'mes', label: 'Este mes', desde: () => startOfMonth(new Date()) },
] as const;

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

export function ReservasWebPage() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('7');
  const [soloPendientes, setSoloPendientes] = useState(true);
  const [editando, setEditando] = useState<IntentoReservaWeb | null>(null);

  const desde = ymd(PERIODOS.find((p) => p.id === periodo)!.desde());
  const hasta = ymd(new Date());
  const q = useQuery({
    queryKey: ['reservas-web', 'intentos', desde, hasta, soloPendientes],
    queryFn: () => reservasWebApi.intentos(desde, hasta, soloPendientes),
    refetchInterval: 30_000,
  });
  const filas = q.data ?? [];

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
      <header className="flex flex-wrap justify-between items-center gap-3 px-6 py-4 bg-surface-container-lowest border-b border-outline-variant/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">language</span>
          </div>
          <div>
            <h1 className="font-headline-md text-headline-md font-bold text-on-surface leading-tight">Reservas web</h1>
            <p className="text-xs text-on-surface-variant">Quién empezó a reservar en la página, hasta dónde llegó y si terminó. Llama a los que se quedaron a medias.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-surface-container-low p-0.5" role="group" aria-label="Periodo">
            {PERIODOS.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriodo(p.id)} aria-pressed={periodo === p.id}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors', periodo === p.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface')}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant cursor-pointer select-none">
            <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} className="w-4 h-4 accent-primary" data-testid="rw-solo-pendientes" />
            Solo por contactar
          </label>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {q.isLoading ? (
          <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : q.isError ? (
          <p className="text-sm text-error text-center py-16">{(q.error as Error).message}</p>
        ) : filas.length === 0 ? (
          <div className="text-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl text-amber-300">language</span>
            <p className="text-sm mt-2">{soloPendientes ? 'No hay personas por contactar en este periodo.' : 'Nadie empezó a reservar en la web en este periodo.'}</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 overflow-x-auto">
            <p className="px-4 py-2.5 text-xs font-semibold text-on-surface-variant border-b border-outline-variant/30">
              {filas.length} persona(s){soloPendientes ? ' por contactar' : ''} · las más recientes primero · se actualiza solo
            </p>
            <table className="w-full text-xs" data-testid="rw-tabla">
              <thead className="bg-surface-container-low text-on-surface-variant text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Paciente</th>
                  <th className="text-left px-3 py-2.5 font-bold">Contacto</th>
                  <th className="text-left px-3 py-2.5 font-bold">Hasta dónde llegó</th>
                  <th className="text-left px-3 py-2.5 font-bold">Lo que eligió</th>
                  <th className="text-left px-3 py-2.5 font-bold">Resultado</th>
                  <th className="text-right px-4 py-2.5 font-bold">Seguimiento</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => <FilaIntento key={x.id} x={x} onContactar={() => setEditando(x)} />)}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {editando && (
        <ModalContacto
          intento={editando}
          onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); qc.invalidateQueries({ queryKey: ['reservas-web', 'intentos'] }); }}
        />
      )}
    </div>
  );
}

function FilaIntento({ x, onContactar }: { x: IntentoReservaWeb; onContactar: () => void }) {
  const r = RESULTADO[x.resultado];
  const llego = PASOS.findIndex((p) => p.id === x.pasoAlcanzado);
  const termino = x.resultado === 'reservo';
  return (
    <tr className="border-t border-outline-variant/20 align-top" data-testid="rw-fila">
      <td className="px-4 py-3">
        <p className="font-bold text-on-surface">{x.paciente}</p>
        <p className="text-on-surface-variant font-mono text-[11px]">DNI {x.numeroDocumento}</p>
        <p className="text-[11px] text-on-surface-variant/80 mt-0.5" title={format(parseISO(x.creadoEn), "d 'de' MMM HH:mm", { locale: es })}>
          Empezó {format(parseISO(x.creadoEn), "dd/MM HH:mm")} · hace {formatDistanceToNowStrict(parseISO(x.creadoEn), { locale: es })}
        </p>
        {x.pacienteId && <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary-fixed text-primary">Ya es paciente</span>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <a href={`tel:+51${x.telefono}`} className="flex items-center gap-1 font-semibold text-on-surface hover:text-primary">
          <span className="material-symbols-outlined text-[16px]">call</span>{x.telefono}
        </a>
        <a href={`https://wa.me/51${x.telefono}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline mt-0.5">
          <span className="material-symbols-outlined text-[15px]">chat</span>WhatsApp
        </a>
        <p className="text-[11px] text-on-surface-variant mt-0.5 max-w-[190px] truncate" title={x.email}>{x.email}</p>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1" aria-label={`Llegó a: ${PASOS[llego]?.label ?? ''}`}>
          {PASOS.map((p, i) => (
            <span key={p.id} title={p.label}
              className={cn('h-1.5 w-6 rounded-full', termino || i < llego ? 'bg-primary' : i === llego ? 'bg-amber-400' : 'bg-surface-container-high')} />
          ))}
        </div>
        <p className="text-[11px] font-semibold text-on-surface mt-1">
          {termino ? 'Completó todo' : `Se quedó en: ${PASOS[llego]?.label ?? '—'}`}
        </p>
      </td>
      <td className="px-3 py-3 max-w-[240px]">
        {x.sede || x.servicio ? (
          <>
            <p className="font-semibold text-on-surface">{x.servicio ?? '—'}{x.variante ? ` · ${x.variante}` : ''}</p>
            <p className="text-[11px] text-on-surface-variant">
              {x.sede ?? 'Sin sede'}{x.fecha ? ` · ${format(parseISO(x.fecha), "EEE d MMM", { locale: es })}` : ''}{x.horaInicio ? ` ${x.horaInicio}` : ''}
            </p>
          </>
        ) : <p className="text-[11px] text-on-surface-variant/70">Aún no eligió</p>}
        {x.reserva && <p className="text-[11px] font-mono text-on-surface-variant mt-0.5">{x.reserva.codigo} · S/ {x.reserva.monto.toFixed(2)}</p>}
      </td>
      <td className="px-3 py-3">
        <span className={cn('inline-block text-[11px] font-bold px-2 py-1 rounded-lg whitespace-nowrap', r.clase)}>{r.label}</span>
      </td>
      <td className="px-4 py-3 text-right">
        {x.contactadoEn ? (
          <button type="button" onClick={onContactar} className="text-right group" title="Editar el seguimiento">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
              <span className="material-symbols-outlined text-[15px]">check_circle</span>Contactado
            </span>
            <p className="text-[11px] text-on-surface-variant">{x.contactadoPor ?? ''} · {format(parseISO(x.contactadoEn), 'dd/MM HH:mm')}</p>
            {x.notaContacto && <p className="text-[11px] text-on-surface max-w-[220px] ml-auto line-clamp-2 group-hover:underline">{x.notaContacto}</p>}
          </button>
        ) : termino || x.resultado === 'retomo' || x.resultado === 'en_curso' || x.resultado === 'pagando' ? (
          <span className="text-[11px] text-on-surface-variant/60">—</span>
        ) : (
          <button type="button" onClick={onContactar} data-testid="rw-contactar"
            className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-2.5 py-1.5 text-[11px] font-semibold text-on-surface hover:bg-surface-container-low">
            <span className="material-symbols-outlined text-[16px]">phone_in_talk</span>Marcar contactado
          </button>
        )}
      </td>
    </tr>
  );
}

function ModalContacto({ intento, onClose, onGuardado }: { intento: IntentoReservaWeb; onClose: () => void; onGuardado: () => void }) {
  const [nota, setNota] = useState(intento.notaContacto ?? '');
  const [guardando, setGuardando] = useState(false);
  const guardar = async (contactado: boolean) => {
    setGuardando(true);
    try {
      await reservasWebApi.marcarContacto(intento.id, contactado, nota.trim() || null);
      toast.success(contactado ? 'Marcado como contactado' : 'Se quitó la marca de contactado');
      onGuardado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
      setGuardando(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Seguimiento">
        <div>
          <h2 className="font-bold text-on-surface">{intento.paciente}</h2>
          <p className="text-xs text-on-surface-variant">Cel. {intento.telefono} · DNI {intento.numeroDocumento}</p>
        </div>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Nota de la llamada</span>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} rows={3} autoFocus
            placeholder="Ej. No pudo pagar con tarjeta, se le agendó por teléfono para el jueves 10:00"
            className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary" />
        </label>
        <div className="flex justify-between gap-2">
          {intento.contactadoEn ? (
            <button type="button" disabled={guardando} onClick={() => guardar(false)} className="text-xs font-semibold text-on-surface-variant hover:text-error">Quitar «contactado»</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-outline-variant px-4 py-2 text-xs font-semibold text-on-surface-variant">Cancelar</button>
            <button type="button" disabled={guardando} onClick={() => guardar(true)} data-testid="rw-guardar-contacto"
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-on-primary disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar como contactado'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
