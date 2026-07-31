import { format } from 'date-fns';
import { useAuditoriaData, ACCION_ICON } from '../../services/auditoriaService';
import { AdminHeaderNav } from './AdminHeaderNav';

export function AuditoriaPage() {
  const { desde, setDesde, hasta, setHasta, logs, isLoading } = useAuditoriaData();

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-3 mb-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Desde</label>
            <input type="date" className="input text-sm w-36" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Hasta</label>
            <input type="date" className="input text-sm w-36" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-limablue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-5 py-2 text-left font-semibold">Fecha/Hora</th>
                  <th className="px-5 py-2 text-left font-semibold">Acción</th>
                  <th className="px-5 py-2 text-left font-semibold">Entidad</th>
                  <th className="px-5 py-2 text-left font-semibold">Usuario</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-5 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                      {format(new Date(log.creadoEn), 'd/MM/yyyy HH:mm:ss')}
                    </td>
                    <td className="px-5 py-2.5">
                      <span className="flex items-center gap-1.5">
                        <span>{ACCION_ICON[log.accion] ?? '•'}</span>
                        <span className="font-medium capitalize text-slate-700">{log.accion.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">
                      <span className="capitalize">{log.entidad}</span>
                      <span className="ml-2 font-mono text-xs text-slate-400">{log.entidadId.slice(0, 8)}…</span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{log.usuario?.nombre ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logs.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                Sin registros de auditoría en este rango
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
