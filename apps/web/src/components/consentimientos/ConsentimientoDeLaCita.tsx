// Consentimiento en el detalle de la cita: AVISA antes del tratamiento si el servicio exige uno que el
// paciente aún no firmó, y deja firmarlo ahí mismo (en cualquier momento, sin esperar a la atención).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { consentimientosApi, consentimientosPacienteKey, pendientesCitaKey } from '../../api/consentimientos';
import { useAuthStore } from '../../stores/authStore';
import { verConsentimientoPdf } from '../../services/firmarConsentimientoService';
import { FirmarConsentimientoDialog } from './FirmarConsentimientoDialog';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });

export function ConsentimientoDeLaCita({ cita }: { cita: { id: string; pacienteId: string; estado: string } }) {
  const tiene = useAuthStore((s) => s.tiene);
  const puedeVer = tiene('hc.ver');
  const puedeFirmar = tiene('hc.registrar');
  const [firmando, setFirmando] = useState<{ plantillaId: string | null } | null>(null);
  const activa = !['cancelada', 'no_show', 'reprogramada'].includes((cita.estado || '').toLowerCase());

  const { data: pendientes = [] } = useQuery({ queryKey: pendientesCitaKey(cita.id), queryFn: () => consentimientosApi.pendientesDeCita(cita.id), enabled: puedeVer && activa, staleTime: 30_000 });
  const { data: todos = [] } = useQuery({ queryKey: consentimientosPacienteKey(cita.pacienteId), queryFn: () => consentimientosApi.dePaciente(cita.pacienteId), enabled: puedeVer, staleTime: 30_000 });
  const deEstaCita = todos.filter((x) => x.citaId === cita.id);
  if (!puedeVer || (!pendientes.length && !deEstaCita.length && !puedeFirmar)) return null;

  return (
    <div className="space-y-2" data-testid="consentimiento-cita">
      <p className="text-sm font-bold text-on-surface">Consentimiento informado</p>
      {activa && pendientes.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2.5" data-testid="consentimiento-pendiente">
          <span className="material-symbols-outlined text-amber-700">contract</span>
          <p className="text-sm text-amber-900 flex-1 min-w-[180px]">Antes del tratamiento: falta firmar <b>{p.nombre}</b></p>
          {puedeFirmar && (
            <button type="button" onClick={() => setFirmando({ plantillaId: p.id })} data-testid="firmar-desde-cita"
              className="min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Firmar ahora</button>
          )}
        </div>
      ))}
      {deEstaCita.map((x) => (
        <div key={x.id} className={`flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 ${x.estado === 'revocado' ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
          <span className={`material-symbols-outlined ${x.estado === 'revocado' ? 'text-rose-600' : 'text-emerald-700'}`}>{x.estado === 'revocado' ? 'block' : 'task_alt'}</span>
          <p className="text-sm text-on-surface flex-1 min-w-[180px]">N° {String(x.numero).padStart(5, '0')} · {x.procedimiento} · {x.estado === 'revocado' ? 'revocado' : `firmado el ${fmt(x.firmadoEn)}`}</p>
          <button type="button" onClick={() => verConsentimientoPdf(x.id)} className="text-xs font-semibold text-primary hover:underline">Ver</button>
        </div>
      ))}
      {puedeFirmar && activa && (
        <button type="button" onClick={() => setFirmando({ plantillaId: null })} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
          <span className="material-symbols-outlined text-base">add</span>Firmar {pendientes.length || deEstaCita.length ? 'otro ' : 'un '}consentimiento
        </button>
      )}
      {firmando && <FirmarConsentimientoDialog origen={{ citaId: cita.id }} plantillaInicial={firmando.plantillaId} onClose={() => setFirmando(null)} />}
    </div>
  );
}

/** Marca en la tarjeta de la agenda: el tratamiento de esta cita exige un consentimiento sin firmar. */
export function MarcaConsentimiento({ pendientes }: { pendientes?: { nombre: string }[] | null }) {
  if (!pendientes?.length) return null;
  return (
    <span title={`Falta firmar el consentimiento: ${pendientes.map((p) => p.nombre).join(', ')}`} data-testid="marca-consentimiento"
      className="inline-flex items-center rounded px-1 font-sans text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
      <span className="material-symbols-outlined text-[11px] leading-none">contract</span>
    </span>
  );
}
