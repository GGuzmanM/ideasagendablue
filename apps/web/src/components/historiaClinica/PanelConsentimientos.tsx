// Pestaña «Consentimientos» de la atención. Se firma EN CUALQUIER MOMENTO (también con la atención
// cerrada: es un documento propio) con el formato oficial de la clínica. La lista muestra TODOS los
// consentimientos del paciente —los firmados desde la agenda antes de la atención también— y marca
// los de esta visita. Revocar es un derecho del paciente: el motivo es opcional.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { AtencionCompleta } from '../../api/historiaClinica';
import { consentimientosApi, consentimientosPacienteKey, pendientesCitaKey } from '../../api/consentimientos';
import { verConsentimientoPdf } from '../../services/firmarConsentimientoService';
import { FirmarConsentimientoDialog } from '../consentimientos/FirmarConsentimientoDialog';
import { DialogoMotivo } from './DialogoMotivo';

const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PanelConsentimientos({ a, puedeRegistrar }: { a: AtencionCompleta; puedeRegistrar: boolean }) {
  const qc = useQueryClient();
  const [firmando, setFirmando] = useState<{ plantillaId: string | null } | null>(null);
  const [revocando, setRevocando] = useState<string | null>(null);
  const { data: lista = [], isLoading } = useQuery({ queryKey: consentimientosPacienteKey(a.pacienteId), queryFn: () => consentimientosApi.dePaciente(a.pacienteId), staleTime: 30_000 });
  const { data: pendientes = [] } = useQuery({ queryKey: pendientesCitaKey(a.citaId), queryFn: () => consentimientosApi.pendientesDeCita(a.citaId), staleTime: 30_000 });
  const revocarMut = useMutation({
    mutationFn: ({ id, motivo }: { id: string; motivo: string }) => consentimientosApi.revocar(id, motivo.trim() || null),
    onSuccess: () => {
      toast.success('Consentimiento revocado');
      for (const k of ['consentimientos-paciente', 'consentimientos-pendientes', 'citas', 'idea1-citas', 'atencion-clinica']) qc.invalidateQueries({ queryKey: [k] });
      setRevocando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deEstaVisita = (x: { atencionId: string | null; citaId: string | null }) => x.atencionId === a.id || x.citaId === a.citaId;

  return (
    <div className="space-y-4" data-testid="panel-consentimientos">
      {pendientes.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3" data-testid="consentimiento-pendiente-hc">
          <span className="material-symbols-outlined text-amber-700">contract</span>
          <p className="text-sm text-amber-900 flex-1 min-w-[200px]">Este tratamiento pide el consentimiento <b>{p.nombre}</b> y aún no está firmado.</p>
          {puedeRegistrar && <button onClick={() => setFirmando({ plantillaId: p.id })} className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Firmar ahora</button>}
        </div>
      ))}
      {puedeRegistrar && (
        <button onClick={() => setFirmando({ plantillaId: null })} data-testid="nuevo-consentimiento"
          className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:opacity-90 flex items-center gap-2">
          <span className="material-symbols-outlined text-base">contract_edit</span>Nuevo consentimiento
        </button>
      )}

      {isLoading ? <p className="text-sm text-on-surface-variant">Cargando…</p> : lista.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant border border-dashed border-outline-variant/40 rounded-2xl"><span className="material-symbols-outlined text-4xl mb-1">contract</span><p className="text-sm">El paciente aún no tiene consentimientos firmados.</p></div>
      ) : (
        <div className="space-y-2" data-testid="lista-consentimientos">
          {lista.map((x) => (
            <div key={x.id} className={`rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-3 ${x.estado === 'revocado' ? 'border-rose-200 bg-rose-50/40' : 'border-outline-variant/30 bg-surface-container-lowest'}`}>
              <span className="material-symbols-outlined text-primary">contract</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-on-surface">
                  N° {String(x.numero).padStart(5, '0')} · {x.procedimiento}
                  {deEstaVisita(x) && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">Esta visita</span>}
                  {x.estado === 'revocado' && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Revocado</span>}
                </div>
                <div className="text-[11px] text-on-surface-variant">
                  {fmtFechaHora(x.firmadoEn)} · firmó {x.firmanteNombre}{x.firmanteRelacion === 'apoderado' ? ' (representante)' : ''}{x.registradoEtiqueta ? ` · registró ${x.registradoEtiqueta}` : ''}
                  {x.estado === 'revocado' && <> · {x.motivoRevocacion ? `motivo: ${x.motivoRevocacion}` : 'sin expresar motivo'}</>}
                </div>
              </div>
              <button onClick={() => verConsentimientoPdf(x.id)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver</button>
              {x.estado === 'firmado' && puedeRegistrar && <button onClick={() => setRevocando(x.id)} className="px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Revocar</button>}
            </div>
          ))}
        </div>
      )}
      {firmando && <FirmarConsentimientoDialog origen={{ atencionId: a.id }} plantillaInicial={firmando.plantillaId} onClose={() => setFirmando(null)} />}
      {revocando && (
        <DialogoMotivo opcional titulo="Revocar consentimiento" descripcion="El paciente retira su consentimiento. No está obligado a expresar el motivo. Queda registrado (no se borra) y su PDF sale con la marca REVOCADO."
          confirmar="Revocar" pending={revocarMut.isPending} onConfirmar={(m) => revocarMut.mutate({ id: revocando!, motivo: m })} onClose={() => setRevocando(null)} />
      )}
    </div>
  );
}
