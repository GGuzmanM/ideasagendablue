import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { baroSolicitudApi } from '../../api/baroSolicitud';
import { sedesApi } from '../../api';
import { useAuthStore } from '../../stores/authStore';

const AZUL = '#0044ab';
// Paleta de avatares (sin rojos): azul, teal, ámbar, morado, azul, cian, índigo, lima.
const AV = ['#0044ab', '#0f766e', '#b45309', '#7c3aed', '#2563eb', '#0891b2', '#4f46e5', '#65a30d'];
const colorDe = (id: string) => AV[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length];
const iniciales = (n: string) => n.replace(/^(Dr|Dra)\.?\s*/i, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

interface Sede { id: string; nombre: string }

export function BaroSolicitudPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const puedeGestionar = useAuthStore((s) => s.isCoordinadora()); // admin + coordinadora_sedes

  const [tab, setTab] = useState<'cov' | 'sede'>('cov');
  const [sedeSel, setSedeSel] = useState('');
  const [aAgregar, setAAgregar] = useState('');

  const { data: sedes = [] } = useQuery<Sede[]>({ queryKey: ['sedes'], queryFn: () => sedesApi.listar(), enabled: puedeGestionar });
  useEffect(() => { if (!sedeSel && sedes.length) setSedeSel(sedes[0].id); }, [sedes, sedeSel]);

  // Vista GLOBAL (matriz + resumen): todos los registros de baro con su sede + citas de hoy.
  const { data: global, isLoading: cargandoGlobal } = useQuery({
    queryKey: ['baro-solicitud', 'global'],
    queryFn: () => baroSolicitudApi.obtener(),
    enabled: puedeGestionar,
  });
  // Vista POR SEDE (gestión): roster + candidatos de la sede elegida.
  const { data: porSede } = useQuery({
    queryKey: ['baro-solicitud', sedeSel],
    queryFn: () => baroSolicitudApi.obtener(sedeSel),
    enabled: puedeGestionar && Boolean(sedeSel) && tab === 'sede',
  });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['baro-solicitud'] });
    qc.invalidateQueries({ queryKey: ['profesionales-seleccionables'] });
  };
  const agregarMut = useMutation({
    mutationFn: ({ profId, sede }: { profId: string; sede: string }) => baroSolicitudApi.agregar(profId, sede),
    onSuccess: () => { invalidar(); setAAgregar(''); toast.success('Médico agregado a baropodometría'); },
    onError: (e: Error) => toast.error(e.message),
  });
  const quitarMut = useMutation({
    mutationFn: ({ profId, sede }: { profId: string; sede: string }) => baroSolicitudApi.quitar(profId, sede),
    onSuccess: () => { invalidar(); toast.success('Quitado de baropodometría'); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Derivados para la matriz ───────────────────────────────────────────────
  const registros = global?.porSolicitud ?? [];
  const citasHoy = global?.citasHoyPorMedico ?? {};
  const medicos = useMemo(() => {
    const map = new Map<string, { id: string; nombre: string; tipo: string; sedes: Set<string> }>();
    for (const r of registros) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, nombre: r.nombre, tipo: r.tipo, sedes: new Set() });
      if (r.sedeId) map.get(r.id)!.sedes.add(r.sedeId);
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [registros]);
  const covPorSede = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sedes) m.set(s.id, medicos.filter((md) => md.sedes.has(s.id)).length);
    return m;
  }, [sedes, medicos]);
  const sedesSinCobertura = sedes.filter((s) => (covPorSede.get(s.id) ?? 0) === 0);
  const sedesCubiertas = sedes.length - sedesSinCobertura.length;

  const toggleCelda = (profId: string, sede: string, cubierto: boolean) => {
    if (cubierto) {
      const nom = medicos.find((m) => m.id === profId)?.nombre ?? 'este médico';
      const sn = sedes.find((s) => s.id === sede)?.nombre ?? 'esta sede';
      if (window.confirm(`¿Quitar a ${nom} de baropodometría en ${sn}?`)) quitarMut.mutate({ profId, sede });
    } else {
      agregarMut.mutate({ profId, sede });
    }
  };

  if (!puedeGestionar) {
    return <div className="flex-1 flex items-center justify-center bg-slate-50 text-slate-400 text-sm">Solo la Coordinadora de Sedes (y el admin) pueden gestionar esta lista.</div>;
  }

  const TAB_BTN = 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors';

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/herramientas')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all" title="Volver a Herramientas">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: AZUL }}>
          <span className="material-symbols-outlined text-[20px]">footprint</span>
        </div>
        <div>
          <h1 className="text-[15px] font-bold text-slate-900">Baropodometría — Atención por solicitud</h1>
          <p className="text-xs text-slate-500">Médicos que atienden baro por sede, solo cuando el paciente los pide.</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="inline-flex gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm mb-4">
          <button className={TAB_BTN} style={tab === 'cov' ? { background: AZUL, color: '#fff' } : { color: '#64748b' }} onClick={() => setTab('cov')}>
            <span className="material-symbols-outlined text-[18px]">grid_view</span> Cobertura general
          </button>
          <button className={TAB_BTN} style={tab === 'sede' ? { background: AZUL, color: '#fff' } : { color: '#64748b' }} onClick={() => setTab('sede')}>
            <span className="material-symbols-outlined text-[18px]">location_on</span> Gestión por sede
          </button>
        </div>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Tile k="Médicos de baro" v={medicos.length} s="en al menos una sede" />
          <Tile k="Sedes cubiertas" v={`${sedesCubiertas}/${sedes.length}`} s="con al menos un médico" />
          <Tile k="Citas de baro hoy" v={global?.citasHoyTotal ?? 0} s="en las 5 sedes" />
          <Tile k="Sedes sin cobertura" v={sedesSinCobertura.length} s={sedesSinCobertura.map((s) => s.nombre).join(', ') || 'todas cubiertas'} alerta={sedesSinCobertura.length > 0} />
        </div>

        {/* ── VISTA: matriz de cobertura ── */}
        {tab === 'cov' && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-900">Quién atiende baropodometría, y dónde</h2>
              <p className="text-xs text-slate-500 mt-0.5">Una fila por médico, una columna por sede. Clic en <b>+</b> para agregar; clic en el <b>✓</b> para quitar.</p>
            </div>
            {cargandoGlobal ? (
              <div className="flex justify-center py-10"><div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: AZUL, borderTopColor: 'transparent' }} /></div>
            ) : medicos.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-10">Ningún médico atiende baropodometría todavía. Ve a "Gestión por sede" para agregar el primero.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse min-w-[680px]">
                  <thead>
                    <tr>
                      <th className="text-left px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 w-64">Médico</th>
                      {sedes.map((s) => {
                        const n = covPorSede.get(s.id) ?? 0;
                        return (
                          <th key={s.id} className="px-2 py-3 border-b border-slate-100 align-bottom" style={n === 0 ? { background: '#fff7ed' } : undefined}>
                            <div className="flex flex-col items-center gap-1.5">
                              <span className="text-[12.5px] font-bold text-slate-900">{s.nombre}</span>
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={n === 0 ? { background: '#fed7aa', color: '#c2410c' } : { background: '#eef2f7', color: '#64748b' }}>
                                {n === 0 ? 'sin cobertura' : `${n} médico${n > 1 ? 's' : ''}`}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {medicos.map((m) => (
                      <tr key={m.id}>
                        <td className="px-5 py-3 border-t border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-bold text-white shrink-0" style={{ background: colorDe(m.id) }}>{iniciales(m.nombre)}</span>
                            <div className="min-w-0">
                              <div className="text-[13.5px] font-semibold text-slate-900 truncate">{m.nombre}</div>
                              <div className="text-[11.5px] text-slate-400">{citasHoy[m.id] ? `${citasHoy[m.id]} citas de baro hoy` : 'Médico'}</div>
                            </div>
                          </div>
                        </td>
                        {sedes.map((s) => {
                          const cub = m.sedes.has(s.id);
                          const dead = (covPorSede.get(s.id) ?? 0) === 0;
                          return (
                            <td key={s.id} className="text-center border-t border-l border-slate-100" style={dead ? { background: '#fff7ed' } : undefined}>
                              {cub ? (
                                <button onClick={() => toggleCelda(m.id, s.id, true)} disabled={quitarMut.isPending} title={`Quitar a ${m.nombre} de ${s.nombre}`}
                                  className="w-[30px] h-[30px] rounded-lg grid place-items-center mx-auto text-white disabled:opacity-50" style={{ background: AZUL }}>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" /></svg>
                                </button>
                              ) : (
                                <button onClick={() => toggleCelda(m.id, s.id, false)} disabled={agregarMut.isPending} title={`Agregar a ${m.nombre} en ${s.nombre}`}
                                  className="w-[30px] h-[30px] rounded-lg grid place-items-center mx-auto border border-dashed border-slate-300 text-slate-400 hover:border-[#0044ab] hover:text-[#0044ab] hover:bg-[#0044ab]/5 transition-colors disabled:opacity-50">
                                  <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── VISTA: gestión por sede ── */}
        {tab === 'sede' && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {sedes.map((s) => {
                const n = covPorSede.get(s.id) ?? 0;
                const sel = s.id === sedeSel;
                return (
                  <button key={s.id} onClick={() => setSedeSel(s.id)}
                    className="flex items-center gap-2 px-3 py-2 rounded-full text-[13px] font-semibold border transition-colors"
                    style={sel ? { background: AZUL, borderColor: AZUL, color: '#fff' } : { background: '#fff', borderColor: '#cbd5e1', color: '#64748b' }}>
                    {s.nombre}
                    <span className="text-[11px] font-bold px-1.5 rounded-full"
                      style={sel ? { background: 'rgba(255,255,255,.25)' } : n === 0 ? { background: '#fed7aa', color: '#c2410c' } : { background: '#eef2f7', color: '#64748b' }}>{n}</span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 items-start">
              {/* Roster */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2.5 px-1">En {sedes.find((s) => s.id === sedeSel)?.nombre ?? 'esta sede'}</p>
                <div className="space-y-2.5">
                  {(porSede?.porSolicitud.length ?? 0) === 0 ? (
                    <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-400 text-sm">Ningún médico atiende baro en esta sede todavía — agrega uno →</div>
                  ) : (
                    porSede!.porSolicitud.map((p) => (
                      <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-3.5 flex items-center gap-3 shadow-sm">
                        <span className="w-[34px] h-[34px] rounded-full grid place-items-center text-[12px] font-bold text-white shrink-0" style={{ background: colorDe(p.id) }}>{iniciales(p.nombre)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">
                            {p.nombre}{p.activo === false && <span className="ml-2 text-[11px] font-normal text-slate-400">(inactivo)</span>}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">Médico</div>
                          {citasHoy[p.id] ? (
                            <span className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#e8f0fc', color: '#0a3577' }}>{citasHoy[p.id]} citas de baro hoy</span>
                          ) : null}
                        </div>
                        <button onClick={() => quitarMut.mutate({ profId: p.id, sede: sedeSel })} disabled={quitarMut.isPending}
                          className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-900 hover:bg-slate-50 border border-slate-200 rounded-lg px-3 h-8 shrink-0 disabled:opacity-50 transition-colors" title="Quitar de baro en esta sede">Quitar</button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Agregar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:sticky lg:top-[76px]">
                <h3 className="text-[13.5px] font-bold text-slate-900">Agregar médico a {sedes.find((s) => s.id === sedeSel)?.nombre}</h3>
                <p className="text-xs text-slate-500 mt-0.5 mb-3">Solo profesionales que ya trabajan en esta sede.</p>
                <select className="w-full h-10 border border-slate-300 bg-slate-50 rounded-lg px-3 text-[13px] font-medium text-slate-800 outline-none focus:border-[#0044ab] focus:ring-2 focus:ring-[#0044ab]/20"
                  value={aAgregar} onChange={(e) => setAAgregar(e.target.value)}>
                  <option value="">Selecciona un profesional…</option>
                  {(porSede?.disponibles ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <button onClick={() => aAgregar && agregarMut.mutate({ profId: aAgregar, sede: sedeSel })} disabled={!aAgregar || agregarMut.isPending}
                  className="w-full mt-2.5 h-10 rounded-lg text-white text-[13px] font-bold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-all" style={{ background: AZUL }}>
                  <span className="material-symbols-outlined text-[18px]">add</span> Agregar a baropodometría
                </button>
                <p className="mt-3 text-xs text-slate-400 leading-relaxed flex gap-2">
                  <span className="material-symbols-outlined text-[15px] shrink-0" style={{ color: AZUL }}>info</span>
                  <span>La baropodometría se asigna <b>automáticamente</b> a una máquina libre. Los médicos de esta lista aparecen como opción de "médico solicitado" al reservar en esta sede.</span>
                </p>
              </div>
            </div>
          </>
        )}

        {/* Alerta de sedes sin cobertura */}
        {sedesSinCobertura.length > 0 && (
          <div className="flex items-center gap-3 mt-5 rounded-xl px-4 py-3 text-[13px] font-semibold" style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c' }}>
            <span className="material-symbols-outlined text-[19px]">warning</span>
            <span>
              <b>{sedesSinCobertura.map((s) => s.nombre).join(', ')}</b> {sedesSinCobertura.length === 1 ? 'no tiene' : 'no tienen'} médico de baropodometría. Los pacientes que la pidan ahí no podrán reservar hasta asignar uno.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ k, v, s, alerta }: { k: string; v: string | number; s: string; alerta?: boolean }) {
  return (
    <div className="rounded-xl p-4 border shadow-sm" style={alerta ? { background: '#fff7ed', borderColor: '#fed7aa' } : { background: '#fff', borderColor: '#e6ebf2' }}>
      <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: alerta ? '#c2410c' : '#64748b' }}>{k}</div>
      <div className="text-[27px] font-bold leading-none mt-1.5" style={{ color: alerta ? '#c2410c' : '#0b1220' }}>{v}</div>
      <div className="text-xs mt-1.5 truncate" style={{ color: alerta ? '#c2410c' : '#94a3b8' }}>{s}</div>
    </div>
  );
}
