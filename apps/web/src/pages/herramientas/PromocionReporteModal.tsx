import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sedesApi } from '../../api';
import { promocionesApi } from '../../api/promociones';

const soles = (n: number) => `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Rango por defecto: primer día del mes actual → hoy.
function rangoMesActual() {
  const hoy = new Date();
  const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: fmt(ini), hasta: fmt(hoy) };
}

export function PromocionReporteModal({ onClose }: { onClose: () => void }) {
  const def = rangoMesActual();
  const [desde, setDesde] = useState(def.desde);
  const [hasta, setHasta] = useState(def.hasta);
  const [sede, setSede] = useState('');

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes-todas'], queryFn: () => sedesApi.listar() });
  const { data: rep, isFetching } = useQuery({
    queryKey: ['promos-reporte', desde, hasta, sede],
    queryFn: () => promocionesApi.reporte({ desde, hasta, sede: sede || undefined }),
    enabled: !!desde && !!hasta && hasta >= desde,
  });

  const t = rep?.totales;

  return (
    <div className="fixed inset-0 bg-black/40 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold text-slate-900">📊 Reporte de uso de promociones</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        {/* Filtros */}
        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-slate-50/60 shrink-0">
          <input type="date" className="input text-sm" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" className="input text-sm" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} />
          <select className="input text-sm" value={sede} onChange={e => setSede(e.target.value)}>
            <option value="">Todas las sedes</option>
            {(sedes as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          {isFetching && <span className="text-xs text-slate-400">Cargando…</span>}
        </div>

        {/* Totales */}
        {t && (
          <div className="px-6 py-3 grid grid-cols-3 gap-3 shrink-0">
            <div className="rounded-xl bg-pink-50 border border-pink-100 p-3">
              <p className="text-[11px] font-bold text-pink-500 uppercase">Usos</p>
              <p className="text-lg font-bold text-slate-900">{t.usos}</p>
            </div>
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
              <p className="text-[11px] font-bold text-emerald-600 uppercase">Descontado</p>
              <p className="text-lg font-bold text-emerald-700">{soles(t.descontado)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="text-[11px] font-bold text-slate-500 uppercase">Facturado</p>
              <p className="text-lg font-bold text-slate-900">{soles(t.facturado)}</p>
            </div>
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-y-auto px-6 pb-5">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-200">
                <th className="py-2 pr-2 font-bold">Promoción</th>
                <th className="py-2 px-2 font-bold text-right">Usos</th>
                <th className="py-2 px-2 font-bold text-right">Precio lista</th>
                <th className="py-2 px-2 font-bold text-right">Descontado</th>
                <th className="py-2 pl-2 font-bold text-right">Facturado</th>
              </tr>
            </thead>
            <tbody>
              {(rep?.porPromo ?? []).length === 0 ? (
                <tr><td colSpan={5} className="text-center text-slate-400 py-8">Sin uso de promociones en el rango</td></tr>
              ) : rep!.porPromo.map((r) => (
                <tr key={r.promocionId} className="border-b border-slate-100">
                  <td className="py-2 pr-2">
                    <span className={'font-semibold ' + (r.activo ? 'text-slate-800' : 'text-slate-400')}>{r.nombre}</span>
                    {!r.activo && <span className="ml-1 text-[10px] text-slate-400">(inactiva)</span>}
                  </td>
                  <td className="py-2 px-2 text-right text-slate-700">{r.usos}</td>
                  <td className="py-2 px-2 text-right text-slate-500">{soles(r.precioLista)}</td>
                  <td className="py-2 px-2 text-right font-semibold text-emerald-700">{soles(r.descontado)}</td>
                  <td className="py-2 pl-2 text-right text-slate-800">{soles(r.facturado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
