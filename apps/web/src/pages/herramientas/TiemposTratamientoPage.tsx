// Herramientas › Tiempos de tratamiento (analytics.ver).
// Cuánto dura DE VERDAD cada tratamiento, medido con el aparato del consultorio (INICIO / FIN),
// frente a la duración programada de la cita. Por servicio, podóloga o sede; exportable a CSV.
// Solo entran al promedio los tratamientos con INICIO y FIN; los «sin fin» y los anulados se
// cuentan aparte. (Sin cita asignada el aparato no inicia nada.)
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import toast from 'react-hot-toast';
import { sedesApi } from '../../api';
import { tiemposApi, type AgruparReporte, type FiltrosReporteTiempos } from '../../api/tiemposTratamiento';
import { cn } from '../../utils/cn';

const AGRUPAR: [AgruparReporte, string][] = [['servicio', 'Servicio'], ['profesional', 'Podóloga'], ['sede', 'Sede']];
const min = (x: number) => `${x.toLocaleString('es-PE', { maximumFractionDigits: 1 })} min`;

export function TiemposTratamientoPage() {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState<FiltrosReporteTiempos>({
    desde: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    hasta: format(new Date(), 'yyyy-MM-dd'),
    sedeId: '',
    agrupar: 'servicio',
  });
  const [descargando, setDescargando] = useState(false);
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data, isLoading, error } = useQuery({
    queryKey: ['reporte-tiempos', filtros],
    queryFn: () => tiemposApi.reporte(filtros),
    enabled: !!filtros.desde && !!filtros.hasta && filtros.desde <= filtros.hasta,
  });
  const fuera = data?.fueraDelPromedio;

  const descargar = async () => {
    setDescargando(true);
    try { await tiemposApi.descargarCsv(filtros); toast.success('CSV descargado'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar el CSV'); }
    finally { setDescargando(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-700 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-white text-xl">timer</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Tiempos de tratamiento</h1>
          <p className="text-xs text-slate-500">Duración real medida con el aparato del consultorio frente a la duración programada</p>
        </div>
        <button onClick={descargar} disabled={descargando || !data?.total}
          className="ml-auto px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">download</span>{descargando ? 'Descargando…' : 'Descargar CSV'}
        </button>
      </div>

      <div className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-end gap-4">
        <label className="text-xs font-semibold text-slate-500">Desde
          <input type="date" className="input text-sm mt-1 block" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
        </label>
        <label className="text-xs font-semibold text-slate-500">Hasta
          <input type="date" className="input text-sm mt-1 block" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
        </label>
        <label className="text-xs font-semibold text-slate-500">Sede
          <select className="input text-sm mt-1 block min-w-[150px]" value={filtros.sedeId} onChange={(e) => setFiltros({ ...filtros, sedeId: e.target.value })}>
            <option value="">Todas</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <div className="text-xs font-semibold text-slate-500">Agrupar por
          <div className="flex gap-1 mt-1">
            {AGRUPAR.map(([id, label]) => (
              <button key={id} onClick={() => setFiltros({ ...filtros, agrupar: id })}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border', filtros.agrupar === id ? 'bg-teal-600 text-white border-teal-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5 max-w-6xl">
        {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
        {data?.total && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {([['Tratamientos', String(data.total.n)], ['Promedio', min(data.total.promedio)], ['Mediana', min(data.total.mediana)],
              ['9 de cada 10 duran hasta', min(data.total.p90)], ['Rango', `${min(data.total.min)} – ${min(data.total.max)}`]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{k}</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5">{AGRUPAR.find(([id]) => id === filtros.agrupar)?.[1]}</th>
                <th className="text-right px-3 py-2.5">N.º</th>
                <th className="text-right px-3 py-2.5">Promedio</th>
                <th className="text-right px-3 py-2.5">Mediana</th>
                <th className="text-right px-3 py-2.5" title="9 de cada 10 tratamientos duran hasta">P90</th>
                <th className="text-right px-3 py-2.5">Mín – Máx</th>
                <th className="text-right px-3 py-2.5">Programado</th>
                <th className="text-right px-4 py-2.5" title="Promedio real menos duración programada">Desvío</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Cargando…</td></tr>}
              {!isLoading && data && data.filas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Sin tratamientos medidos en ese rango.</td></tr>
              )}
              {data?.filas.map((f) => (
                <tr key={f.clave}>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{f.nombre}</td>
                  <td className="px-3 py-2.5 text-right">{f.n}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{min(f.promedio)}</td>
                  <td className="px-3 py-2.5 text-right">{min(f.mediana)}</td>
                  <td className="px-3 py-2.5 text-right">{min(f.p90)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{min(f.min)} – {min(f.max)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">{min(f.programado)}</td>
                  <td className={cn('px-4 py-2.5 text-right font-bold', f.desvio > 5 ? 'text-red-600' : f.desvio < -5 ? 'text-amber-600' : 'text-emerald-700')}>
                    {f.desvio > 0 ? '+' : ''}{min(f.desvio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {fuera && (fuera.sinFin + fuera.descartados + fuera.enCurso > 0) && (
          <p className="text-xs text-slate-500">
            No entran al promedio: {fuera.sinFin} sin FIN (nadie presionó FIN en 3 horas) · {fuera.descartados} anulados (FIN antes de 1 minuto)
            {fuera.enCurso ? ` · ${fuera.enCurso} en curso` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
