import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CitaResumen } from '../../api/citas';
import {
  reboteApi, citaEnRebote, TURNO_LABEL, RESULTADO_LLAMADA_LABEL,
  type TurnoRebote, type ResultadoLlamada,
} from '../../api/rebote';
import { useAuthStore } from '../../stores/authStore';
import { invalidarAgenda } from '../../services/idea1DetalleCitaService';

const ORIGEN_LABEL: Record<string, string> = { agendada: 'Agendada', confirmada: 'Confirmada', no_show: 'No vino' };
const ELEGIBLES = ['agendada', 'confirmada', 'no_show'];
const campo = 'w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-3 py-2 text-xs text-on-surface outline-none focus:ring-2 focus:ring-violet-300';

/**
 * Rebote en el detalle de la cita (30-sep-2026; desde el 01-oct, quienes reprograman: permiso citas.reprogramar).
 * - Cita agendada / confirmada / «no vino» → «Enviar a rebote» (sale de la agenda para volver a llamar al paciente).
 * - Cita en rebote → aviso con el motivo y el vencimiento, llamadas, «Registrar llamada» y «Descartar».
 *   Reagendar = el botón «Reagendar» de siempre (mover), que la saca del rebote.
 */
export function ReboteDeLaCita({ cita, grupo, onListo }: { cita: CitaResumen; grupo: CitaResumen[]; onListo: () => void }) {
  const puede = useAuthStore((s) => s.usuario?.permisos ?? []).includes('citas.reprogramar');
  const qc = useQueryClient();
  const enRebote = citaEnRebote(cita);
  const estado = (cita.estado ?? '').toLowerCase();

  // Enviar
  const [enviando, setEnviando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [turno, setTurno] = useState<TurnoRebote | ''>('');
  const [llamarDesde, setLlamarDesde] = useState('');
  // Llamada
  const [llamando, setLlamando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoLlamada>('no_contesto');
  const [nota, setNota] = useState('');
  const [proximaFecha, setProximaFecha] = useState('');

  const refrescar = () => { invalidarAgenda(qc); qc.invalidateQueries({ queryKey: ['rebote'] }); qc.invalidateQueries({ queryKey: ['cita-detalle', cita.id] }); };

  const enviarMut = useMutation({
    mutationFn: () => reboteApi.enviar(cita.id, { motivo: motivo.trim(), turno: turno || null, llamarDesde: llamarDesde || null }),
    onSuccess: (r) => { refrescar(); toast.success(r.citas.length > 1 ? 'Cita doble enviada a rebote' : 'Cita enviada a rebote'); onListo(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const llamadasQ = useQuery({
    queryKey: ['rebote', 'llamadas', cita.id],
    queryFn: () => reboteApi.llamadas(cita.id),
    enabled: puede && enRebote,
  });
  const llamadaMut = useMutation({
    mutationFn: () => reboteApi.registrarLlamada(cita.id, { resultado, nota: nota.trim() || null, ...(proximaFecha ? { llamarDesde: proximaFecha } : {}) }),
    onSuccess: () => { refrescar(); setLlamando(false); setNota(''); setProximaFecha(''); toast.success('Llamada registrada'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const descartarMut = useMutation({
    mutationFn: (m: string) => reboteApi.descartar(cita.id, m),
    onSuccess: () => { refrescar(); toast.success('Rebote descartado: la cita quedó cancelada'); onListo(); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puede) return null;

  if (enRebote) {
    const vence = cita.reboteVenceEl ? parseISO(cita.reboteVenceEl) : null;
    const dias = vence ? Math.max(0, Math.ceil((vence.getTime() - Date.now()) / 86_400_000)) : null;
    const llamadas = llamadasQ.data ?? [];
    return (
      <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 space-y-3" data-testid="rebote-cita">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-violet-700">phone_callback</span>
            <div>
              <p className="text-sm font-bold text-violet-900">En rebote · volver a llamar</p>
              <p className="text-[11px] text-violet-700">
                Desde el {cita.reboteDesde ? format(parseISO(cita.reboteDesde), "d 'de' MMM", { locale: es }) : '—'}
                {cita.rebotePor ? ` · por ${cita.rebotePor.nombre}` : ''}
              </p>
            </div>
          </div>
          {dias != null && (
            <span className={`shrink-0 text-[11px] font-bold px-2 py-1 rounded-lg ${dias <= 5 ? 'bg-rose-100 text-rose-700' : 'bg-violet-100 text-violet-800'}`}>
              Se cancela en {dias} día(s)
            </span>
          )}
        </div>
        <div className="grid grid-cols-[110px_1fr] gap-y-1 text-xs text-violet-900">
          <span className="font-semibold">Motivo</span><span>{cita.reboteMotivo || '—'}</span>
          <span className="font-semibold">Estaba</span>
          <span>{ORIGEN_LABEL[cita.reboteEstadoOrigen ?? ''] ?? '—'} · {format(parseISO((cita.fecha ?? '').slice(0, 10)), "EEE d 'de' MMM", { locale: es })} {cita.horaInicio}</span>
          {cita.reboteTurno && (<><span className="font-semibold">Prefiere</span><span>{TURNO_LABEL[cita.reboteTurno]}</span></>)}
          {cita.reboteLlamarDesde && (<><span className="font-semibold">Llamar desde</span><span>{format(parseISO(cita.reboteLlamarDesde.slice(0, 10)), "d 'de' MMM", { locale: es })}</span></>)}
        </div>

        {llamadas.length > 0 && (
          <ul className="space-y-1" data-testid="rebote-llamadas">
            {llamadas.map((l) => (
              <li key={l.id} className="text-[11px] bg-white/70 border border-violet-200 rounded-lg px-2.5 py-1.5">
                <b>{RESULTADO_LLAMADA_LABEL[l.resultado]}</b>
                {l.nota ? ` · ${l.nota}` : ''}
                <span className="text-violet-500"> · {format(new Date(l.creadoEn), 'dd/MM HH:mm')}{l.usuario ? ` · ${l.usuario.nombre}` : ''}</span>
              </li>
            ))}
          </ul>
        )}

        {llamando ? (
          <div className="space-y-2 bg-white/70 border border-violet-200 rounded-xl p-3">
            <select value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoLlamada)} className={campo} data-testid="rebote-llamada-resultado">
              {(Object.keys(RESULTADO_LLAMADA_LABEL) as ResultadoLlamada[]).map((k) => <option key={k} value={k}>{RESULTADO_LLAMADA_LABEL[k]}</option>)}
            </select>
            <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} placeholder="Nota (opcional)" className={campo} />
            <label className="flex items-center gap-2 text-[11px] text-violet-900">
              <span className="shrink-0 font-semibold">Volver a llamar desde</span>
              <input type="date" value={proximaFecha} min={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setProximaFecha(e.target.value)} className={campo} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => llamadaMut.mutate()} disabled={llamadaMut.isPending} data-testid="rebote-llamada-guardar"
                className="flex-1 bg-violet-700 text-white py-2 rounded-xl text-xs font-bold hover:bg-violet-800 disabled:opacity-50">
                {llamadaMut.isPending ? 'Guardando…' : 'Guardar llamada'}
              </button>
              <button type="button" onClick={() => setLlamando(false)} className="px-4 py-2 rounded-xl text-xs font-bold border border-violet-200 text-violet-800 hover:bg-violet-100">Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => setLlamando(true)} data-testid="rebote-registrar-llamada"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold bg-violet-700 text-white hover:bg-violet-800">
              <span className="material-symbols-outlined text-base">call</span>Registrar llamada
            </button>
            <button type="button" disabled={descartarMut.isPending} data-testid="rebote-descartar"
              onClick={() => {
                const m = window.prompt('¿Por qué se descarta? La cita quedará CANCELADA.', 'Ya no desea reagendar');
                if (m && m.trim().length >= 3) descartarMut.mutate(m.trim());
                else if (m !== null) toast.error('Indica el motivo (mínimo 3 letras)');
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50">
              Descartar
            </button>
          </div>
        )}
        <p className="text-[11px] text-violet-700">Para darle nueva fecha usa <b>«Reagendar»</b>: la cita vuelve a la agenda y sale del rebote.</p>
      </div>
    );
  }

  const miembros = grupo.length ? grupo : [cita];
  const elegible = miembros.every((c) => ELEGIBLES.includes((c.estado ?? '').toLowerCase())) && ELEGIBLES.includes(estado);
  if (!elegible) return null;

  if (!enviando) {
    return (
      <button type="button" onClick={() => setEnviando(true)} data-testid="btn-enviar-rebote"
        className="w-full flex items-center justify-center gap-2 p-3 border border-violet-300 text-violet-800 bg-violet-50 hover:bg-violet-100 rounded-2xl transition-all font-bold text-sm cursor-pointer">
        <span className="material-symbols-outlined text-lg">phone_callback</span>
        {miembros.length > 1 ? 'Enviar cita doble a rebote' : 'Enviar a rebote (volver a llamar)'}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 space-y-3" data-testid="rebote-form">
      <p className="text-sm font-bold text-violet-900">Enviar a rebote</p>
      <p className="text-[11px] text-violet-700">
        La cita sale de la agenda (el horario queda libre) y pasa a la bandeja de Rebote para volver a llamar al paciente.
        Si en 30 días no se reagenda, se cancela sola. No se le envía correo.
      </p>
      <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} maxLength={500}
        placeholder="Motivo (ej. el paciente viaja, está enfermo…)" className={campo} data-testid="rebote-motivo" />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-violet-900 font-semibold space-y-1">
          <span>Prefiere el turno</span>
          <select value={turno} onChange={(e) => setTurno(e.target.value as TurnoRebote | '')} className={campo}>
            <option value="">Sin preferencia</option>
            {(Object.keys(TURNO_LABEL) as TurnoRebote[]).map((k) => <option key={k} value={k}>{TURNO_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-violet-900 font-semibold space-y-1">
          <span>Llamarlo desde (opcional)</span>
          <input type="date" value={llamarDesde} min={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setLlamarDesde(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => enviarMut.mutate()} disabled={enviarMut.isPending || motivo.trim().length < 3} data-testid="rebote-enviar"
          className="flex-1 bg-violet-700 text-white py-2 rounded-xl text-xs font-bold hover:bg-violet-800 disabled:opacity-50">
          {enviarMut.isPending ? 'Enviando…' : 'Enviar a rebote'}
        </button>
        <button type="button" onClick={() => setEnviando(false)} className="px-4 py-2 rounded-xl text-xs font-bold border border-violet-200 text-violet-800 hover:bg-violet-100">Cancelar</button>
      </div>
    </div>
  );
}
