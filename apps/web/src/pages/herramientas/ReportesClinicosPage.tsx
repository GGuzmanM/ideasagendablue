// Herramientas › Reportes clínicos (analytics.ver).
// Tres preguntas sobre las mismas atenciones, sin exponer a ningún paciente (son conteos):
//   · Qué vemos: diagnósticos, procedimientos y edades (el «mapa epidemiológico», 7.1).
//   · Cuánto se hace: atenciones y procedimientos por profesional o sede (7.3).
//   · Cómo se registra: de lo cerrado, cuánto quedó con diagnóstico y nota (7.4).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth } from 'date-fns';
import toast from 'react-hot-toast';
import { sedesApi } from '../../api';
import { reportesClinicosApi, AGRUPAR_LABEL, type AgruparReporte, type FiltrosReporteClinico } from '../../api/reportesClinicos';

const AGRUPAR: AgruparReporte[] = ['diagnostico', 'procedimiento', 'profesional', 'sede', 'edad'];
const pct = (n: number) => `${n.toLocaleString('es-PE', { maximumFractionDigits: 1 })}%`;
const num = (n: number) => n.toLocaleString('es-PE');

export function ReportesClinicosPage() {
  const navigate = useNavigate();
  const [filtros, setFiltros] = useState<FiltrosReporteClinico>({
    desde: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    hasta: format(new Date(), 'yyyy-MM-dd'),
    sedeId: '',
    agrupar: 'diagnostico',
  });
  const [descargando, setDescargando] = useState(false);
  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data, isLoading, error } = useQuery({
    queryKey: ['reporte-clinico', filtros],
    queryFn: () => reportesClinicosApi.reporte(filtros),
    enabled: !!filtros.desde && !!filtros.hasta && filtros.desde <= filtros.hasta,
  });

  const descargar = async () => {
    setDescargando(true);
    try { await reportesClinicosApi.descargarCsv(filtros); toast.success('CSV descargado'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar el CSV'); }
    finally { setDescargando(false); }
  };

  const t = data?.totales;
  const muestraProcedimientos = filtros.agrupar === 'profesional' || filtros.agrupar === 'sede' || filtros.agrupar === 'procedimiento';

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100" title="Volver">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-white text-xl">monitoring</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-slate-900">Reportes clínicos</h1>
          <p className="text-xs text-slate-500">Qué se atiende, cuánto se hace y cómo queda registrado. Son conteos: no aparece ningún paciente.</p>
        </div>
        <button onClick={descargar} disabled={descargando || !data?.filas.length} data-testid="descargar-csv"
          className="ml-auto px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">download</span>{descargando ? 'Descargando…' : 'Descargar CSV'}
        </button>
      </div>

      <div className="px-6 py-4 flex flex-wrap items-end gap-3 bg-white border-b border-slate-200">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Desde</label>
          <input type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} data-testid="desde"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Hasta</label>
          <input type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} data-testid="hasta"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Sede</label>
          <select value={filtros.sedeId} onChange={(e) => setFiltros({ ...filtros, sedeId: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">
            <option value="">Todas</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[260px]">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Agrupar por</label>
          <div className="flex flex-wrap gap-1.5">
            {AGRUPAR.map((a) => (
              <button key={a} onClick={() => setFiltros({ ...filtros, agrupar: a })} data-testid={`agrupar-${a}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filtros.agrupar === a ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                {AGRUPAR_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {error && <p className="text-sm text-rose-700">{(error as Error).message}</p>}

        {t && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="totales">
            {[
              ['Atenciones', num(t.atenciones), 'en el rango'],
              ['Pacientes', num(t.pacientes), 'distintos'],
              ['Cerradas', num(t.cerradas), `de ${num(t.atenciones)}`],
              ['Procedimientos', num(t.procedimientos), 'registrados'],
              ['Registro completo', pct(t.completas), 'de las cerradas'],
            ].map(([titulo, valor, pie]) => (
              <div key={titulo} className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{titulo}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{valor}</p>
                <p className="text-[11px] text-slate-500">{pie}</p>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Por {AGRUPAR_LABEL[filtros.agrupar].toLowerCase()}</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="text-left px-5 py-2.5">{AGRUPAR_LABEL[filtros.agrupar]}</th>
                <th className="text-right px-5 py-2.5">Atenciones</th>
                <th className="text-right px-5 py-2.5">Pacientes</th>
                {muestraProcedimientos && <th className="text-right px-5 py-2.5">Procedimientos</th>}
                <th className="text-right px-5 py-2.5 w-40">% de atenciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="tabla-reporte">
              {isLoading && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">Cargando…</td></tr>}
              {!isLoading && !data?.filas.length && <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No hay atenciones en ese rango.</td></tr>}
              {data?.filas.map((f) => (
                <tr key={f.clave} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5 text-slate-800">{f.etiqueta}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-slate-900">{num(f.atenciones)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600">{num(f.pacientes)}</td>
                  {muestraProcedimientos && <td className="px-5 py-2.5 text-right text-slate-600">{num(f.procedimientos ?? 0)}</td>}
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="h-2 rounded-full bg-slate-100 flex-1 max-w-[90px] overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, f.porcentaje)}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 w-12 text-right">{pct(f.porcentaje)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Calidad del registro</h2>
            <p className="text-[11px] text-slate-500">De las atenciones ya CERRADAS: cuántas quedaron con diagnóstico y con nota. Una atención abierta todavía se está escribiendo, así que no cuenta.</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <th className="text-left px-5 py-2.5">Profesional</th>
                <th className="text-right px-5 py-2.5">Cerradas</th>
                <th className="text-right px-5 py-2.5">Con diagnóstico</th>
                <th className="text-right px-5 py-2.5">Con nota</th>
                <th className="text-right px-5 py-2.5">Con procedimiento</th>
                <th className="text-right px-5 py-2.5">Completas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="tabla-calidad">
              {!data?.calidad.length && <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">Sin atenciones cerradas en el rango.</td></tr>}
              {data?.calidad.map((c) => (
                <tr key={c.clave} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5 text-slate-800">{c.etiqueta}</td>
                  <td className="px-5 py-2.5 text-right font-semibold text-slate-900">{num(c.cerradas)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600">{num(c.conDiagnostico)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600">{num(c.conNota)}</td>
                  <td className="px-5 py-2.5 text-right text-slate-600">{num(c.conProcedimiento)}</td>
                  <td className={`px-5 py-2.5 text-right font-bold ${c.completas >= 90 ? 'text-emerald-700' : c.completas >= 70 ? 'text-amber-600' : 'text-rose-700'}`}>{pct(c.completas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-slate-500">
          Una atención con dos diagnósticos suma en los dos, así que la columna puede sumar más que el total; el porcentaje
          siempre se calcula sobre las atenciones del rango. Lo que aparece como «sin registrar» va al final: es un aviso de
          calidad, no un resultado clínico.
        </p>
      </div>
    </div>
  );
}
