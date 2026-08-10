import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { promocionesApi, formatPromoValor, type Promocion } from '../../api/promociones';
import { useAuthStore } from '../../stores/authStore';
import { PromocionEditorModal } from './PromocionEditorModal';
import { PromocionReporteModal } from './PromocionReporteModal';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// Resumen compacto de las restricciones de una promo (chips). Vacío = sin restricciones.
function resumenRestricciones(p: Promocion): string[] {
  const out: string[] = [];
  if (p.serviciosIds?.length) out.push(`${p.serviciosIds.length} servicio${p.serviciosIds.length > 1 ? 's' : ''}`);
  if (p.sedesIds?.length) out.push(`${p.sedesIds.length} sede${p.sedesIds.length > 1 ? 's' : ''}`);
  if (p.canales?.length) out.push(p.canales.length === 1 ? p.canales[0] : `${p.canales.length} canales`);
  if (p.diasSemana?.length) out.push(p.diasSemana.map(d => DIAS[d]).join('/'));
  if (p.vigenciaInicio || p.vigenciaFin) out.push(`${p.vigenciaInicio?.slice(0, 10) ?? '…'} → ${p.vigenciaFin?.slice(0, 10) ?? '…'}`);
  if (p.codigo) out.push(`código: ${p.codigo}`);
  if (p.cupoTotal != null) out.push(`cupo ${p.cupoTotal}`);
  if (p.limitePorPaciente != null) out.push(`máx ${p.limitePorPaciente}/pac`);
  if (p.soloPacientesNuevos) out.push('solo nuevos');
  return out;
}

export function PromocionesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore(s => s.isCoordinadora()); // admin + coordinadora_sedes

  // Editor modal: null = cerrado, 'new' = crear, Promocion = editar.
  const [editor, setEditor] = useState<Promocion | 'new' | null>(null);
  const [verReporte, setVerReporte] = useState(false);

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ['promociones-todas'],
    queryFn: promocionesApi.todas,
    enabled: puedeGestionar,
  });

  const invalidar = () => { qc.invalidateQueries({ queryKey: ['promociones-todas'] }); qc.invalidateQueries({ queryKey: ['promociones-activas'] }); qc.invalidateQueries({ queryKey: ['promos-elegibles'] }); };

  const actualizarMut = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) => promocionesApi.actualizar(id, { activo }),
    onSuccess: invalidar,
    onError: (e: Error) => toast.error(e.message),
  });
  const eliminarMut = useMutation({
    mutationFn: (id: string) => promocionesApi.eliminar(id),
    onSuccess: (r) => { invalidar(); toast.success(r.desactivado ? `Promoción desactivada (tiene ${r.enUso} citas, se conserva el historial)` : 'Promoción eliminada'); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar promociones.</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-pink-500 flex items-center justify-center shrink-0"><span className="text-white text-lg">🎁</span></div>
        <div className="flex-1">
          <h1 className="text-base font-bold text-slate-900">Promociones</h1>
          <p className="text-xs text-slate-500">Define beneficio + restricciones (servicio, sede, días, vigencia, canal, cupo). El sistema solo ofrece las que califican al agendar.</p>
        </div>
        <button onClick={() => setVerReporte(true)} className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 border border-slate-300 hover:bg-slate-50 shrink-0">📊 Reporte</button>
        <button onClick={() => setEditor('new')} className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-pink-600 hover:bg-pink-700 shrink-0">+ Nueva promoción</button>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-2">
        {isLoading ? (
          <div className="flex justify-center py-8"><div className="w-7 h-7 border-2 border-pink-400 border-t-transparent rounded-full animate-spin" /></div>
        ) : promos.map((p: Promocion) => {
          const restr = resumenRestricciones(p);
          return (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className={'text-sm font-semibold ' + (p.activo ? 'text-slate-900' : 'text-slate-400 line-through')}>
                  {p.nombre}
                  <span className="ml-2 text-xxs font-normal text-pink-600">{formatPromoValor(p.tipo, p.valor)}</span>
                  {!p.activo && <span className="ml-2 text-xxs font-normal text-slate-400">(inactiva)</span>}
                  {(p.enUso ?? 0) > 0 && <span className="ml-2 text-xxs font-normal text-slate-400">· {p.enUso} citas</span>}
                </p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {restr.length === 0 ? (
                    <span className="text-[11px] text-slate-400">Sin restricciones · aplica a todo</span>
                  ) : restr.map((r, i) => (
                    <span key={i} className="text-[11px] font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">{r}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => actualizarMut.mutate({ id: p.id, activo: !p.activo })}
                  className={'text-xxs font-semibold px-2 py-1 rounded-lg ' + (p.activo ? 'text-slate-500 hover:bg-slate-100' : 'text-emerald-600 hover:bg-emerald-50')}
                  title={p.activo ? 'Desactivar (deja de aparecer al reservar)' : 'Activar'}
                >{p.activo ? 'Desactivar' : 'Activar'}</button>
                <button onClick={() => setEditor(p)} className="p-2 text-slate-400 hover:text-pink-600 hover:bg-pink-50 rounded-lg transition-all" title="Editar">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                <button onClick={() => eliminarMut.mutate(p.id)} disabled={eliminarMut.isPending} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50" title="Quitar">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          );
        })}
        <p className="text-xxs text-slate-400 px-1 pt-1">Al quitar una promo con citas, se <b>desactiva</b> (no se borra) para conservar el historial. Vacío en una restricción = aplica a todo.</p>
      </div>

      {editor && (
        <PromocionEditorModal
          promo={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={() => { invalidar(); setEditor(null); toast.success('Promoción guardada'); }}
        />
      )}
      {verReporte && <PromocionReporteModal onClose={() => setVerReporte(false)} />}
    </div>
  );
}
