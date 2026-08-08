// Membresías VENDIDAS por paciente — gestión (habilitar/deshabilitar + contrato).
// Página independiente del constructor de plantillas.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '../../utils/cn';
import { membresiasApi, imprimirContratoMembresia, verContratoMembresia, type MembresiaVendida } from '../../api/membresias';

// Avatar (iniciales + color por nombre) y chip de estado.
const AVATAR_COLORES = ['#0044ab', '#7c3aed', '#0891b2', '#db2777', '#ea580c', '#059669'];
const inicialesDe = (n: string) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const colorAvatar = (n: string) => AVATAR_COLORES[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORES.length];
const ESTADO_CHIP: Record<string, { txt: string; cls: string; dot: string; bar: string }> = {
  ACTIVO: { txt: 'Activa', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', bar: 'bg-primary' },
  VENCIDO: { txt: 'Vencida', cls: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500', bar: 'bg-amber-400' },
  AGOTADO: { txt: 'Agotada', cls: 'text-slate-600 bg-slate-100 border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' },
  ANULADO: { txt: 'Anulada', cls: 'text-red-700 bg-red-50 border-red-200', dot: 'bg-red-500', bar: 'bg-red-300' },
};
const FILTROS = [
  { v: '', t: 'Todas' }, { v: 'ACTIVO', t: 'Activas' }, { v: 'VENCIDO', t: 'Vencidas' }, { v: 'ANULADO', t: 'Anuladas' },
];

export function MembresiasVendidasPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState(''); // client-side por estado
  const [imprimiendo, setImprimiendo] = useState<string | null>(null);

  const { data: vendidas = [], isLoading } = useQuery({
    queryKey: ['membresias-vendidas', q],
    queryFn: () => membresiasApi.vendidas(q.trim() ? { q: q.trim() } : {}),
  });
  const filtradas = filtro ? vendidas.filter((v) => v.estado === filtro) : vendidas;

  const habilitarMut = useMutation({
    mutationFn: ({ id, habilitar }: { id: string; habilitar: boolean }) => membresiasApi.setHabilitada(id, habilitar),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['membresias-vendidas'] });
      toast.success(v.habilitar ? 'Membresía habilitada' : 'Membresía deshabilitada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const contrato = async (v: MembresiaVendida, accion: 'ver' | 'imprimir') => {
    if (!v.promocionId) return;
    setImprimiendo(v.id + accion);
    try {
      if (accion === 'ver') await verContratoMembresia(v.promocionId, { pacienteId: v.pacienteId });
      else await imprimirContratoMembresia(v.promocionId, v.pacienteId);
    } catch (e) { toast.error((e as Error).message); }
    finally { setImprimiendo(null); }
  };

  const fmt = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex items-center gap-4 shrink-0">
        <button onClick={() => navigate('/herramientas')} className="w-9 h-9 rounded-xl grid place-items-center text-on-surface-variant hover:bg-surface-container transition shrink-0" title="Volver a Herramientas">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="w-11 h-11 rounded-xl bg-primary/10 grid place-items-center shrink-0">
          <span className="material-symbols-outlined text-primary text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-on-surface tracking-tight">Membresías vendidas</h1>
          <p className="text-sm text-on-surface-variant hidden lg:block">Por paciente · habilitar/deshabilitar y reimprimir el contrato</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-6 bg-surface">
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[240px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-lg">search</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar paciente por nombre o DNI…" className="input text-sm w-full !pl-10" />
          </div>
          <div className="inline-flex items-center bg-surface-container rounded-xl p-1 text-sm font-semibold">
            {FILTROS.map((f) => (
              <button key={f.v} onClick={() => setFiltro(f.v)} className={cn('px-3 py-1.5 rounded-lg transition-all', filtro === f.v ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant hover:text-on-surface')}>{f.t}</button>
            ))}
          </div>
        </div>

        {/* Tarjetas */}
        {isLoading ? (
          <div className="flex justify-center py-16"><span className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
        ) : filtradas.length === 0 ? (
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-10 text-center text-on-surface-variant/60 text-sm">No hay membresías vendidas que coincidan.</div>
        ) : (
          <div className="space-y-2.5">
            {filtradas.map((v) => {
              const e = ESTADO_CHIP[v.estado] ?? { txt: v.estado, cls: 'text-slate-600 bg-slate-100 border-slate-200', dot: 'bg-slate-400', bar: 'bg-slate-400' };
              const anulada = v.estado === 'ANULADO' || !v.activo;
              const pct = v.sesionesTotal ? Math.round((v.sesionesUsadas / v.sesionesTotal) * 100) : 0;
              const restantes = v.sesionesTotal - v.sesionesUsadas;
              return (
                <div key={v.id} className={cn('bg-surface-container-lowest border border-outline-variant/30 rounded-2xl px-4 py-2.5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2', anulada && 'opacity-70')}>
                  {/* Paciente */}
                  <div className="flex items-center gap-2.5 sm:w-52 shrink-0">
                    <div className="w-9 h-9 rounded-full grid place-items-center text-white font-bold text-xs shrink-0" style={{ background: colorAvatar(v.paciente) }}>{inicialesDe(v.paciente)}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-on-surface leading-tight truncate">{v.paciente}</p>
                      <p className="text-[11px] text-on-surface-variant/70 leading-tight">DNI {v.documento}{v.sede ? ` · ${v.sede}` : ''}</p>
                    </div>
                  </div>

                  {/* Membresía + saldo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="material-symbols-outlined text-primary text-base" style={{ fontVariationSettings: "'FILL' 1" }}>workspace_premium</span>
                      <span className="text-sm font-bold text-on-surface">{v.membresia}</span>
                      <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1', e.cls)}><span className={cn('w-1.5 h-1.5 rounded-full', e.dot)} />{e.txt}</span>
                      <span className="text-[11px] text-on-surface-variant/70 inline-flex items-center gap-0.5"><span className="material-symbols-outlined text-sm">event</span>{fmt(v.vigenciaInicio)} → {fmt(v.vigenciaFin)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 max-w-[220px] h-1.5 rounded-full bg-surface-container overflow-hidden"><div className={cn('h-full rounded-full', e.bar)} style={{ width: `${pct}%` }} /></div>
                      <span className="text-[11px] font-semibold text-on-surface-variant whitespace-nowrap">{v.sesionesUsadas}/{v.sesionesTotal} · <b className="text-on-surface">{restantes} disp.</b></span>
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {v.tieneContrato ? (
                      <>
                        <button onClick={() => contrato(v, 'ver')} disabled={!!imprimiendo} title="Ver contrato" className="w-8 h-8 grid place-items-center rounded-lg border border-outline-variant/50 text-on-surface-variant hover:bg-surface-container disabled:opacity-50 transition"><span className="material-symbols-outlined text-base">visibility</span></button>
                        <button onClick={() => contrato(v, 'imprimir')} disabled={!!imprimiendo} title="Reimprimir contrato" className="w-8 h-8 grid place-items-center rounded-lg border border-primary/30 text-primary hover:bg-primary/5 disabled:opacity-50 transition"><span className="material-symbols-outlined text-base">print</span></button>
                      </>
                    ) : (
                      <span className="text-[10px] text-on-surface-variant/40 italic px-1">sin contrato</span>
                    )}
                    {anulada ? (
                      <button onClick={() => habilitarMut.mutate({ id: v.id, habilitar: true })} disabled={habilitarMut.isPending} className="text-xs font-semibold text-emerald-700 border border-emerald-200 rounded-lg px-3 py-1.5 hover:bg-emerald-50 disabled:opacity-50 transition">Habilitar</button>
                    ) : (
                      <button onClick={() => { if (window.confirm(`¿Deshabilitar la membresía de ${v.paciente}? No podrá usarla hasta rehabilitarla.`)) habilitarMut.mutate({ id: v.id, habilitar: false }); }} disabled={habilitarMut.isPending} className="text-xs font-semibold text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50 transition">Deshabilitar</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xxs text-on-surface-variant/50 mt-4">Deshabilitar = anular la membresía (no se puede consumir). Reimprimir genera el contrato pre-llenado del paciente.</p>
      </div>
    </div>
  );
}
