// Herramientas › Exportaciones › «Tiempos de atención» (10-oct-2026). Por cada cita que llegó: quién marcó «Llegó»,
// «En atención» y «Completada» (o si lo hizo el sistema), la espera, la atención y el total reales y el tiempo
// teórico con que se agendó. Un día o un rango (máx. 92 días), una sede o todas. El Excel trae además una hoja «Resumen».
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, addDays, startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, differenceInCalendarDays } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { sedesApi, type Sede } from '../../api';

const MAX_DIAS = 92;
const ymd = (d: Date) => format(d, 'yyyy-MM-dd');
const leerFecha = (v: string) => { const d = new Date(v + 'T12:00:00'); return isNaN(d.getTime()) ? null : d; };

export function TiemposAtencionTool() {
  const token = useAuthStore((s) => s.token);
  const [modo, setModo] = useState<'dia' | 'rango'>('dia');
  const [fecha, setFecha] = useState<Date>(() => addDays(startOfDay(new Date()), -1));
  const [desde, setDesde] = useState<Date>(() => startOfMonth(new Date()));
  const [hasta, setHasta] = useState<Date>(() => startOfDay(new Date()));
  const [sedeId, setSedeId] = useState('');
  const [exportando, setExportando] = useState(false);
  const { data: sedes = [] } = useQuery<Sede[]>({ queryKey: ['sedes-herramientas'], queryFn: () => sedesApi.listar(), staleTime: 5 * 60 * 1000 });

  const diasRango = differenceInCalendarDays(hasta, desde) + 1;
  const errorRango = modo !== 'rango' ? '' : diasRango < 1 ? 'La fecha «hasta» no puede ser anterior a «desde».' : diasRango > MAX_DIAS ? `El rango puede ser de hasta ${MAX_DIAS} días (elegiste ${diasRango}).` : '';
  const periodoTexto = modo === 'rango'
    ? `Del ${format(desde, "d 'de' MMMM", { locale: es })} al ${format(hasta, "d 'de' MMMM yyyy", { locale: es })}`
    : format(fecha, "EEEE d 'de' MMMM yyyy", { locale: es });
  const sedeSel = sedes.find((s) => s.id === sedeId);

  const descargar = async () => {
    if (errorRango) { toast.error(errorRango); return; }
    setExportando(true);
    try {
      const params = new URLSearchParams(modo === 'rango' ? { desde: ymd(desde), hasta: ymd(hasta) } : { fecha: ymd(fecha) });
      if (sedeId) params.set('sedeId', sedeId);
      const res = await fetch(`/api/v1/exportar/tiempos-atencion?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Error al generar el archivo');
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `tiempos-atencion-${modo === 'rango' ? `${ymd(desde)}_a_${ymd(hasta)}` : ymd(fecha)}${sedeSel ? `-${sedeSel.nombre.replace(/\s+/g, '-').toLowerCase()}` : ''}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success('Excel descargado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo descargar el archivo');
    } finally {
      setExportando(false);
    }
  };

  const chip = (activo: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${activo ? 'bg-primary text-on-primary border-primary' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/40 hover:text-primary'}`;
  const atajo = 'px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-primary/10 hover:text-primary transition-colors whitespace-nowrap';
  const etiqueta = 'block text-xs font-semibold text-slate-700 mb-2';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5" data-testid="tiempos-atencion-tool">
      <div>
        <h2 className="font-bold text-slate-800 text-base">Tiempos de atención</h2>
        <p className="text-xs text-slate-500 mt-0.5">Citas que llegaron, con quién marcó cada estado y sus tiempos.</p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-700">Fecha</span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Un día o un rango" data-testid="tiempos-modo">
            {([['dia', 'Un día'], ['rango', 'Rango']] as const).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setModo(v)} aria-pressed={modo === v}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${modo === v ? 'bg-primary text-on-primary' : 'text-slate-500 hover:text-slate-700'}`}>{t}</button>
            ))}
          </div>
        </div>
        {modo === 'rango' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                <span className="text-xs text-slate-500 w-11">Desde</span>
                <input type="date" value={ymd(desde)} max={ymd(hasta)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setDesde(d); }} className="input flex-1" data-testid="tiempos-desde" />
              </label>
              <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                <span className="text-xs text-slate-500 w-11">Hasta</span>
                <input type="date" value={ymd(hasta)} min={ymd(desde)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setHasta(d); }} className="input flex-1" data-testid="tiempos-hasta" />
              </label>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: 'Esta semana', r: () => [startOfWeek(new Date(), { weekStartsOn: 1 }), endOfWeek(new Date(), { weekStartsOn: 1 })] },
                { label: 'Semana pasada', r: () => [startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }), endOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 })] },
                { label: 'Este mes', r: () => [startOfMonth(new Date()), endOfMonth(new Date())] },
                { label: 'Mes pasado', r: () => [startOfMonth(subMonths(new Date(), 1)), endOfMonth(subMonths(new Date(), 1))] },
              ].map(({ label, r }) => (
                <button key={label} type="button" className={atajo} onClick={() => { const [a, b] = r(); setDesde(startOfDay(a!)); setHasta(startOfDay(b!)); }}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input type="date" value={ymd(fecha)} onChange={(e) => { const d = leerFecha(e.target.value); if (d) setFecha(d); }} className="input flex-1" data-testid="tiempos-fecha" />
            <div className="flex gap-1.5">
              {[{ label: 'Hoy', dias: 0 }, { label: 'Ayer', dias: -1 }].map(({ label, dias }) => (
                <button key={label} type="button" className={atajo} onClick={() => setFecha(addDays(startOfDay(new Date()), dias))}>{label}</button>
              ))}
            </div>
          </div>
        )}
        <p className={`mt-2 text-xs first-letter:uppercase ${errorRango ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{errorRango || periodoTexto}</p>
      </div>

      <div>
        <span className={etiqueta}>Sede</span>
        <div className="flex flex-wrap gap-2" data-testid="tiempos-sede">
          <button type="button" onClick={() => setSedeId('')} className={chip(sedeId === '')}>Todas</button>
          {sedes.map((s) => (
            <button key={s.id} type="button" onClick={() => setSedeId(s.id)} className={chip(sedeId === s.id)}>{s.nombre}</button>
          ))}
        </div>
      </div>

      <button onClick={() => void descargar()} disabled={exportando || !!errorRango} data-testid="tiempos-descargar"
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {exportando
          ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Generando…</>
          : <><span className="material-symbols-outlined text-[18px]">download</span>Descargar Excel</>}
      </button>
    </div>
  );
}
