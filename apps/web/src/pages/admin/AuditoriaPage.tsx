import { useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '../../utils/cn';
import { AdminHeaderNav } from './AdminHeaderNav';
import {
  useAuditoriaData,
  estiloDeAccion,
  avatarDeUsuario,
  tiempoRelativo,
  resumenLog,
  parseUserAgent,
  calcularDiff,
  renderValor,
  etiquetaEntidad,
  formatIp,
  type AuditLog,
} from '../../services/auditoriaService';

// ── Página ───────────────────────────────────────────────────────────────────
export function AuditoriaPage() {
  const {
    desde, setDesde, hasta, setHasta,
    entidad, setEntidad, accion, setAccion,
    usuarioId, setUsuarioId, sedeId, setSedeId,
    q, setQ, page, setPage,
    logs, total, totalPages, limit,
    isLoading, stats, facetas, sedes,
    nombresPorId, resetFiltros, hayFiltroActivo,
  } = useAuditoriaData();

  const [logSeleccionado, setLogSeleccionado] = useState<AuditLog | null>(null);

  const esModoLoginOnly = accion.toUpperCase() === 'LOGIN' && (entidad === '' || entidad === 'usuario');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <AdminHeaderNav />

      <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">

        {/* Header con KPIs */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Auditoría del sistema</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Registro cronológico de todas las acciones. Rastrea quién hizo qué, cuándo y desde dónde.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <KpiCard icon="history" label="Total" value={stats?.total ?? '—'} tint="bg-primary/10" iconColor="text-primary" />
            <KpiCard icon="today" label="Hoy" value={stats?.hoy ?? '—'} tint="bg-emerald-100" iconColor="text-emerald-700" />
            <KpiCard icon="group" label="Usuarios activos" value={stats?.usuariosActivos ?? '—'} tint="bg-amber-100" iconColor="text-amber-700" />
          </div>
        </div>

        {/* Acceso rápido a Vistas (Todos vs Logins) */}
        <div className="flex items-center justify-between gap-2 flex-wrap bg-slate-100/70 p-1.5 rounded-xl border border-slate-200/80">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => { setAccion(''); setEntidad(''); setQ(''); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5',
                !esModoLoginOnly
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:bg-white/50'
              )}
            >
              <span className="material-symbols-outlined text-sm">history</span>
              Todos los eventos
            </button>
            <button
              onClick={() => { setAccion('LOGIN'); setEntidad('usuario'); }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5',
                esModoLoginOnly
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white/50'
              )}
            >
              <span className="material-symbols-outlined text-sm">login</span>
              Inicios de Sesión (Logins)
            </button>
          </div>
          {hayFiltroActivo && (
            <button
              onClick={resetFiltros}
              className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 font-semibold flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              Limpiar filtros
            </button>
          )}
        </div>

        {/* Filtros detallados */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Desde</label>
            <input type="date" className="input text-sm" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Hasta</label>
            <input type="date" className="input text-sm" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Entidad</label>
            <select className="input text-sm" value={entidad} onChange={e => setEntidad(e.target.value)}>
              <option value="">Todas</option>
              {facetas?.entidades.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Acción</label>
            <select className="input text-sm" value={accion} onChange={e => setAccion(e.target.value)}>
              <option value="">Todas</option>
              {facetas?.acciones.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Usuario</label>
            <select className="input text-sm" value={usuarioId} onChange={e => setUsuarioId(e.target.value)}>
              <option value="">Todos</option>
              <option value="sistema">Sistema (automático)</option>
              {facetas?.usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Sede</label>
            <select className="input text-sm" value={sedeId} onChange={e => setSedeId(e.target.value)}>
              <option value="">Todas</option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Buscar</label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">search</span>
              <input className="input text-sm pl-10" placeholder="Acción, entidad, IP, usuario…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 shadow-sm overflow-hidden">
          <div className="overflow-auto custom-scrollbar" style={{ maxHeight: 'calc(100vh - 360px)' }}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-container-low sticky top-0 z-10">
                  <ThCell>Fecha / hora</ThCell>
                  <ThCell>Usuario</ThCell>
                  <ThCell>Acción</ThCell>
                  <ThCell>Entidad</ThCell>
                  <ThCell>Descripción</ThCell>
                  <ThCell>Sede</ThCell>
                  <ThCell>IP / Dispositivo</ThCell>
                  <th className="text-right px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">
                    Cambios
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/25">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-16">
                      <div className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-16">
                      <div className="w-16 h-16 rounded-2xl bg-surface-container-low grid place-items-center mx-auto mb-3">
                        <span className="material-symbols-outlined text-3xl text-on-surface-variant">receipt_long</span>
                      </div>
                      <p className="text-base font-bold text-on-surface">Sin registros</p>
                      <p className="text-sm text-on-surface-variant mt-1">
                        Ajusta los filtros o amplía el rango de fechas.
                      </p>
                    </td>
                  </tr>
                ) : (
                  logs.map(log => <LogRow key={log.id} log={log} nombresPorId={nombresPorId} onVer={() => setLogSeleccionado(log)} />)
                )}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          <div className="px-6 py-3 border-t border-outline-variant/30 flex items-center justify-between bg-surface-container-low">
            <p className="text-xs text-on-surface-variant">
              {total > 0 ? (
                <>Mostrando <b>{(page - 1) * limit + 1}-{Math.min(page * limit, total)}</b> de <b>{total.toLocaleString()}</b> registros</>
              ) : 'Sin registros'}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="w-8 h-8 rounded-lg grid place-items-center text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">chevron_left</span>
              </button>
              <span className="text-xs font-semibold text-on-surface px-2">
                {page} / {Math.max(totalPages, 1)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="w-8 h-8 rounded-lg grid place-items-center text-on-surface-variant hover:bg-surface-container transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-base">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {logSeleccionado && (
        <ModalDiff log={logSeleccionado} nombresPorId={nombresPorId} onClose={() => setLogSeleccionado(null)} />
      )}
    </div>
  );
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function ThCell({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left px-3 py-2.5 border-b border-outline-variant/40 font-bold text-[11px] text-on-surface-variant uppercase tracking-wider">
      {children}
    </th>
  );
}

function KpiCard({ icon, label, value, tint, iconColor }: { icon: string; label: string; value: string | number; tint: string; iconColor: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2">
      <div className={cn('w-8 h-8 rounded-lg grid place-items-center', tint)}>
        <span className={cn('material-symbols-outlined text-lg', iconColor)}>{icon}</span>
      </div>
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold text-slate-800">{typeof value === 'number' ? value.toLocaleString() : value}</p>
      </div>
    </div>
  );
}

function LogRow({ log, nombresPorId, onVer }: { log: AuditLog; nombresPorId: Record<string, string>; onVer: () => void }) {
  const style = estiloDeAccion(log.accion);
  const av = avatarDeUsuario(log.usuario?.nombre);
  const res = resumenLog(log, nombresPorId);
  const esSistema = !log.usuarioId;
  const uaFmt = parseUserAgent(log.userAgent);

  return (
    <tr className="hover:bg-primary/5 transition-colors">
      <td className="px-4 py-3 whitespace-nowrap">
        <p className="text-[13px] font-bold text-on-surface leading-tight">
          {format(new Date(log.creadoEn), 'HH:mm')}
        </p>
        <p className="text-[10px] text-on-surface-variant">
          {format(new Date(log.creadoEn), 'd MMM', { locale: es })} · {tiempoRelativo(log.creadoEn)}
        </p>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-full text-white text-[10px] font-bold grid place-items-center shrink-0"
            style={{ backgroundColor: av.color }}
          >
            {av.iniciales}
          </span>
          <span className={cn('text-[12px] font-semibold truncate', esSistema ? 'text-on-surface-variant italic' : 'text-on-surface')}>
            {log.usuario?.nombre ?? 'Sistema'}
          </span>
        </div>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border', style.bg, style.text, style.border)}>
          <span className="material-symbols-outlined text-sm">{style.icon}</span>
          {style.label}
        </span>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="text-[11px] font-semibold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
          {etiquetaEntidad(log.entidad)}
        </span>
      </td>
      <td className="px-3 py-3">
        <p className="text-[13px] text-on-surface truncate max-w-[300px]" title={res.titulo}>{res.titulo}</p>
        {res.subtitulo && (
          <p className="text-[10px] text-on-surface-variant/70 truncate max-w-[300px]" title={res.subtitulo}>{res.subtitulo}</p>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {log.sede ? (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: log.sede.color }} />
            <span className="text-[12px] font-semibold text-on-surface">{log.sede.nombre}</span>
          </div>
        ) : (
          <span className="text-[11px] text-on-surface-variant/60 italic">—</span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {(() => {
          const ipFmt = formatIp(log.ip);
          if (!log.ip && !log.userAgent) return <span className="text-[10px] font-mono text-on-surface-variant/60 italic">—</span>;
          return (
            <div className="flex flex-col gap-0.5">
              {log.ip && (
                ipFmt.esLocal ? (
                  <span className="text-[10px] font-semibold text-on-surface-variant bg-surface-container-low px-1.5 py-0.5 rounded w-fit" title={log.ip}>
                    {ipFmt.texto}
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-on-surface-variant bg-surface-container-low px-1.5 py-0.5 rounded w-fit">
                    {ipFmt.texto}
                  </span>
                )
              )}
              {log.userAgent && (
                <span className="text-[9px] text-on-surface-variant/70 truncate max-w-[140px]" title={uaFmt}>
                  {uaFmt}
                </span>
              )}
            </div>
          );
        })()}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <button
          onClick={onVer}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-primary bg-primary/10 border border-primary/30 hover:bg-primary/20 transition"
        >
          <span className="material-symbols-outlined text-sm">visibility</span> Ver
        </button>
      </td>
    </tr>
  );
}

// ── Modal de diff ────────────────────────────────────────────────────────────
function ModalDiff({ log, nombresPorId, onClose }: { log: AuditLog; nombresPorId: Record<string, string>; onClose: () => void }) {
  const style = estiloDeAccion(log.accion);
  const diff = calcularDiff(log.antes, log.despues);
  const res = resumenLog(log, nombresPorId);
  const cuando = format(new Date(log.creadoEn), "d 'de' MMMM yyyy · HH:mm:ss", { locale: es });

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-surface-container-lowest w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-[#0044ab] text-white p-5 flex justify-between items-start shrink-0 shadow-md">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined">{style.icon}</span>
              <h2 className="text-lg font-bold tracking-tight capitalize truncate">
                {style.label} · {etiquetaEntidad(log.entidad)}
              </h2>
            </div>
            <p className="text-sm text-white/85 mt-1">
              {cuando} · {tiempoRelativo(log.creadoEn)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors shrink-0">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">

          {/* Contexto */}
          <section>
            <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Contexto</p>
            <div className="grid grid-cols-2 gap-2">
              <MetaCell icon="person" label="Usuario" value={log.usuario?.nombre ?? 'Sistema (automático)'} italic={!log.usuarioId} />
              <MetaCell icon="location_on" label="Sede" value={log.sede?.nombre ?? '—'} />
              <MetaCell icon="router" label="IP" value={formatIp(log.ip).texto} mono={!formatIp(log.ip).esLocal} />
              <MetaCell icon="devices" label="Dispositivo" value={parseUserAgent(log.userAgent)} />
            </div>
          </section>

          {/* Entidad */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Entidad</p>
            </div>
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm font-bold text-on-surface">{res.titulo}</p>
              {res.subtitulo && <p className="text-xs text-on-surface-variant mt-0.5">{res.subtitulo}</p>}
              <p className="text-[10px] font-mono text-on-surface-variant/70 mt-1 truncate">{log.entidadId}</p>
            </div>
          </section>

          {/* Diff */}
          <section>
            <p className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Cambios</p>
            {diff.length === 0 ? (
              <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-center">
                <p className="text-xs text-on-surface-variant italic">
                  Sin campos con diferencias registradas.
                </p>
              </div>
            ) : (
              <div className="border border-outline-variant/40 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface-container-low">
                    <tr>
                      <th className="text-left px-3 py-2 font-bold text-[10px] text-on-surface-variant uppercase tracking-wider w-1/4">Campo</th>
                      <th className="text-left px-3 py-2 font-bold text-[10px] text-on-surface-variant uppercase tracking-wider">Antes</th>
                      <th className="text-left px-3 py-2 font-bold text-[10px] text-on-surface-variant uppercase tracking-wider">Después</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[11px]">
                    {diff.map(d => (
                      <DiffRow key={d.campo} row={d} nombresPorId={nombresPorId} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* JSON crudo colapsable */}
          {(log.antes || log.despues) && (
            <section>
              <details>
                <summary className="cursor-pointer text-[11px] font-bold text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">code</span> Payload JSON crudo
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 text-[11px] font-mono overflow-x-auto custom-scrollbar">
{JSON.stringify({ antes: log.antes, despues: log.despues }, null, 2)}
                </pre>
              </details>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-outline-variant/30 flex items-center justify-between shrink-0 bg-surface-container-low">
          <span className="text-[10px] font-mono text-on-surface-variant/70 truncate max-w-[60%]">
            log_id: {log.id}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-primary text-white font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function MetaCell({ icon, label, value, mono, italic }: { icon: string; label: string; value: string; mono?: boolean; italic?: boolean }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low border border-outline-variant/30">
      <span className="material-symbols-outlined text-primary text-lg shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</p>
        <p className={cn('text-xs font-semibold text-on-surface truncate', mono && 'font-mono', italic && 'italic text-on-surface-variant')} title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

function DiffRow({ row, nombresPorId }: { row: import('../../services/auditoriaService').DiffRow; nombresPorId: Record<string, string> }) {
  const cls = row.tipo === 'add' ? 'diff-row add' : row.tipo === 'remove' ? 'diff-row remove' : 'diff-row change';
  const antesTxt = renderValor(row.antes, nombresPorId);
  const despuesTxt = renderValor(row.despues, nombresPorId);
  // Si el valor original era un UUID y se reemplazó por un nombre, mostrar el
  // UUID en tooltip por si el usuario necesita identificar el registro exacto.
  const antesTitle = typeof row.antes === 'string' && /^[0-9a-f-]{36}$/i.test(row.antes) ? row.antes : undefined;
  const despuesTitle = typeof row.despues === 'string' && /^[0-9a-f-]{36}$/i.test(row.despues) ? row.despues : undefined;
  return (
    <tr className={cn(cls, 'border-t border-outline-variant/25')}>
      <td className={cn('px-3 py-2 font-sans font-semibold', row.tipo === 'remove' ? 'text-red-900' : row.tipo === 'add' ? 'text-emerald-900' : 'text-on-surface')}>
        {row.campo}
      </td>
      <td className={cn('px-3 py-2 whitespace-normal break-words', row.antes === undefined ? 'text-slate-400' : 'text-red-900')} title={antesTitle}>
        {antesTxt}
      </td>
      <td className={cn('px-3 py-2 whitespace-normal break-words', row.despues === undefined ? 'text-slate-400' : 'text-emerald-900')} title={despuesTitle}>
        {despuesTxt}
      </td>
    </tr>
  );
}
