// Herramientas › Exportaciones y Reportes › «Creación de citas» (analytics.ver, 23-oct-2026).
// Quién creó cada cita y el DÍA y la HORA en que la creó (hora Lima). Misma tarjeta que «Lista de citas»: un día o un
// rango de días de CREACIÓN (no el día de la cita), sede, usuario y canal; vista previa por usuario y Excel con todo.
import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format, addDays, startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { sedesApi, type Sede } from '../../api';
import { reporteCreacionCitasApi } from '../../api/reporteCreacionCitas';
import { useCanales } from '../../hooks/useCanales';

const MAX_DIAS = 93;
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const leerFecha = (v: string) => { const d = new Date(v + 'T12:00:00'); return isNaN(d.getTime()) ? null : d; };
const num = (n: number) => n.toLocaleString('es-PE');
const dmy = (iso: string) => iso.split('-').reverse().join('/');
/** «08:53» si es un solo día; si no, «16/10 08:53» (hora Lima). */
const momentoLima = (iso: string, unDia: boolean) => {
  const d = new Date(iso);
  const hora = d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false });
  return unDia ? hora : `${d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit' })} ${hora}`;
};

const chip = (activo: boolean) =>
  `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
    activo ? 'bg-blue-700 text-white border-blue-700 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-700'
  }`;
const atajo = 'px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-700 transition-colors whitespace-nowrap';
const etiqueta = 'block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide';

export function CreacionCitasTool() {
  const hoy = startOfDay(new Date());
  const [modo, setModo] = useState<'dia' | 'rango'>('dia');
  const [fecha, setFecha] = useState<Date>(hoy);
  const [desde, setDesde] = useState<Date>(() => startOfMonth(new Date()));
  const [hasta, setHasta] = useState<Date>(hoy);
  const [sedeId, setSedeId] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [canal, setCanal] = useState('');
  const [verDetalle, setVerDetalle] = useState(false);
  const [descargando, setDescargando] = useState(false);

  const { data: sedes = [] } = useQuery<Sede[]>({ queryKey: ['sedes-herramientas'], queryFn: () => sedesApi.listar(), staleTime: 5 * 60 * 1000 });
  const { canales } = useCanales();

  const dias = differenceInCalendarDays(hasta, desde) + 1;
  const errorRango = modo !== 'rango' ? '' : dias < 1 ? 'La fecha «hasta» no puede ser anterior a «desde».' : dias > MAX_DIAS ? `El rango puede ser de hasta ${MAX_DIAS} días (elegiste ${dias}).` : '';
  const filtros = {
    desde: modo === 'rango' ? ymd(desde) : ymd(fecha),
    hasta: modo === 'rango' ? ymd(hasta) : ymd(fecha),
    sedeId, usuarioId, canal,
  };
  const unDia = filtros.desde === filtros.hasta;
  const fechaDisplay = modo === 'rango'
    ? `Creadas del ${format(desde, "EEEE d 'de' MMMM", { locale: es })} al ${format(hasta, "EEEE d 'de' MMMM, yyyy", { locale: es })} · ${dias > 0 ? dias : 0} día${dias === 1 ? '' : 's'}`
    : `Creadas el ${format(fecha, "EEEE d 'de' MMMM, yyyy", { locale: es })}`;

  const { data, isFetching, error } = useQuery({
    queryKey: ['reporte-creacion-citas', filtros],
    queryFn: () => reporteCreacionCitasApi.reporte(filtros),
    enabled: !errorRango,
    placeholderData: keepPreviousData,
  });
  const t = data?.totales;
  const maxCitas = Math.max(1, ...(data?.porUsuario.map((u) => u.citas) ?? [1]));
  const horaPico = useMemo(() => (data?.porHora ?? []).reduce((a, b) => (b.citas > a.citas ? b : a), { hora: -1, citas: 0 }), [data]);

  const descargar = async () => {
    if (errorRango) { toast.error(errorRango); return; }
    setDescargando(true);
    try {
      await reporteCreacionCitasApi.descargarExcel(filtros);
      const sede = sedes.find((s) => s.id === sedeId)?.nombre ?? 'Todas las sedes';
      toast.success(`Excel descargado — ${fechaDisplay} · ${sede}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo descargar el Excel'); }
    finally { setDescargando(false); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" data-testid="creacion-citas-tool">
      {/* Card header */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[24px]">edit_calendar</span>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Creación de citas · Excel</h2>
            <p className="text-blue-100 text-xs">Quién creó cada cita y el día y la hora en que la creó</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">
        {/* Fecha de creación: un día o un rango */}
        <div>
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wide">
              {modo === 'rango' ? 'Rango de días de creación' : 'Día en que se crearon'}
            </label>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Un día o un rango" data-testid="creacion-modo">
              {([['dia', 'Un día'], ['rango', 'Rango de fechas']] as const).map(([v, txt]) => (
                <button key={v} type="button" onClick={() => setModo(v)} aria-pressed={modo === v}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${modo === v ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {txt}
                </button>
              ))}
            </div>
          </div>
          {modo === 'rango' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                  <span className="text-xs font-medium text-slate-500 w-11">Desde</span>
                  <input type="date" value={ymd(desde)} max={ymd(hasta)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setDesde(d); }} className="input flex-1" data-testid="creacion-desde" />
                </label>
                <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                  <span className="text-xs font-medium text-slate-500 w-11">Hasta</span>
                  <input type="date" value={ymd(hasta)} min={ymd(desde)} max={ymd(hoy)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setHasta(d); }} className="input flex-1" data-testid="creacion-hasta" />
                </label>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { label: 'Esta semana', r: () => [startOfWeek(hoy, { weekStartsOn: 1 }), hoy] },
                  { label: 'Semana pasada', r: () => [startOfWeek(addDays(hoy, -7), { weekStartsOn: 1 }), endOfWeek(addDays(hoy, -7), { weekStartsOn: 1 })] },
                  { label: 'Este mes', r: () => [startOfMonth(hoy), hoy] },
                  { label: 'Mes pasado', r: () => [startOfMonth(subMonths(hoy, 1)), endOfMonth(subMonths(hoy, 1))] },
                ].map(({ label, r }) => (
                  <button key={label} type="button" className={atajo} onClick={() => { const [a, b] = r(); setDesde(startOfDay(a!)); setHasta(startOfDay(b!)); }}>{label}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <input type="date" value={ymd(fecha)} max={ymd(hoy)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setFecha(d); }} className="input flex-1" data-testid="creacion-fecha" />
              <div className="flex gap-1.5">
                {[{ label: 'Hoy', dias: 0 }, { label: 'Ayer', dias: -1 }].map(({ label, dias: d }) => (
                  <button key={label} type="button" className={atajo} onClick={() => setFecha(addDays(hoy, d))}>{label}</button>
                ))}
              </div>
            </div>
          )}
          <p className={`mt-2 text-xs first-letter:uppercase ${errorRango ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{errorRango || fechaDisplay}</p>
        </div>

        {/* Sede */}
        <div>
          <label className={etiqueta}>Sede</label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSedeId('')} className={chip(sedeId === '')}>Todas las sedes</button>
            {sedes.map((s) => (
              <button key={s.id} type="button" onClick={() => setSedeId(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${sedeId === s.id ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                style={sedeId === s.id ? { backgroundColor: s.color, borderColor: s.color } : {}}>
                {s.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Usuario y canal */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={etiqueta}>Creada por</label>
            <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} className="input w-full" data-testid="filtro-usuario">
              <option value="">Todos los usuarios</option>
              {data?.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({num(u.citas)})</option>)}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Canal</label>
            <select value={canal} onChange={(e) => setCanal(e.target.value)} className="input w-full">
              <option value="">Todos los canales</option>
              {canales.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Vista previa */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5 space-y-3" data-testid="creacion-vista-previa">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Vista previa</p>
            {isFetching && <span className="text-xxs text-slate-400">Actualizando…</span>}
          </div>
          {error && <p className="text-xs text-red-600">{(error as Error).message}</p>}
          {t && (
            <div className="grid grid-cols-3 gap-2" data-testid="totales">
              {[
                ['Citas creadas', num(t.citas)],
                ['Usuarios', num(t.usuarios + (t.sinUsuario ? 1 : 0))],
                ['Hora con más citas', horaPico.citas ? `${String(horaPico.hora).padStart(2, '0')}:00` : '—'],
              ].map(([titulo, valor]) => (
                <div key={titulo} className="bg-white rounded-lg border border-slate-100 px-3 py-2">
                  <p className="text-xxs font-semibold uppercase tracking-wide text-slate-400">{titulo}</p>
                  <p className="text-lg font-bold text-slate-800 leading-tight">{valor}</p>
                </div>
              ))}
            </div>
          )}

          {data && !data.porUsuario.length && <p className="text-xs text-slate-400 text-center py-3">No se crearon citas con esos filtros.</p>}
          {!!data?.porUsuario.length && (
            <div className="bg-white rounded-lg border border-slate-100 divide-y divide-slate-100 max-h-72 overflow-y-auto" data-testid="tabla-usuarios">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-1.5 text-xxs font-semibold uppercase tracking-wide text-slate-400 sticky top-0 bg-white">
                <span>Usuario</span><span className="w-24 text-right">Primera · última</span><span className="w-12 text-right">Citas</span>
              </div>
              {data.porUsuario.map((u) => (
                <button key={u.usuarioId} type="button" onClick={() => setUsuarioId(usuarioId === u.usuarioId ? '' : u.usuarioId)}
                  className={`w-full grid grid-cols-[1fr_auto_auto] gap-3 items-center px-3 py-2 text-left transition-colors ${usuarioId === u.usuarioId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-700 truncate">{u.usuario}</span>
                    <span className="block h-1.5 mt-1 rounded-full bg-slate-100 overflow-hidden">
                      <span className="block h-full rounded-full bg-blue-500" style={{ width: `${(u.citas / maxCitas) * 100}%` }} />
                    </span>
                  </span>
                  <span className="w-24 text-right font-mono text-xxs text-slate-500 leading-tight">
                    {momentoLima(u.primera, unDia)}<br />{momentoLima(u.ultima, unDia)}
                  </span>
                  <span className="w-12 text-right text-sm font-bold text-slate-800">{num(u.citas)}</span>
                </button>
              ))}
            </div>
          )}

          {!!data?.detalle.length && (
            <div>
              <button type="button" onClick={() => setVerDetalle((v) => !v)} className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1" data-testid="ver-detalle">
                <span className="material-symbols-outlined text-[16px]">{verDetalle ? 'expand_less' : 'expand_more'}</span>
                {verDetalle ? 'Ocultar las últimas citas creadas' : 'Ver las últimas citas creadas'}
              </button>
              {verDetalle && (
                <div className="mt-2 bg-white rounded-lg border border-slate-100 divide-y divide-slate-100 max-h-80 overflow-y-auto" data-testid="tabla-detalle">
                  {data.detalle.slice(0, 100).map((f) => (
                    <div key={f.id} className="px-3 py-2 flex items-start gap-3">
                      <span className="font-mono text-xs font-bold text-slate-800 w-11 shrink-0">{f.horaCreacion}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-slate-700 truncate"><b className="font-semibold">{f.usuario}</b> · {f.paciente}</span>
                        <span className="block text-xxs text-slate-400 truncate">
                          {!unDia && `Creada el ${dmy(f.diaCreacion)} · `}{f.servicio} · {f.sede} · cita {dmy(f.fechaCita)} {f.horaCita} · {f.canal}
                        </span>
                      </span>
                      {f.retroactiva && <span className="text-xxs font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">retroactiva</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {t?.sinUsuario ? <p className="text-xxs text-slate-400">«Reserva web» son las citas que el paciente creó solo desde la web (sin usuario del sistema).</p> : null}
        </div>

        {/* Columnas del Excel */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5" data-testid="creacion-columnas">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Columnas del Excel</p>
          <div className="grid grid-cols-2 gap-y-1 gap-x-4">
            {['Día y hora de creación', 'Usuario', 'Paciente y documento', 'Sede', 'Servicio', 'Profesional', 'Día y hora de la cita', 'Anticipación (días)', 'Canal', 'Estado actual'].map((c) => (
              <div key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xxs flex-shrink-0">✓</span>
                {c}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xxs text-slate-400">Dos hojas: «Resumen por usuario» y «Detalle» (todas las citas, en orden cronológico) · Encabezado con filtros de Excel</p>
        </div>

        <button type="button" onClick={descargar} disabled={descargando || !!errorRango || !t?.citas} data-testid="descargar-excel"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 transition-all shadow-sm shadow-blue-900/20">
          {descargando
            ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generando Excel…</>
            : <><span className="material-symbols-outlined text-[18px]">download</span>Descargar Excel{t?.citas ? ` · ${num(t.citas)} citas` : ''}</>}
        </button>
      </div>
    </div>
  );
}
