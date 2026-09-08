// Historia clínica — página de DOS PANELES (estructura pedida por el doctor, con nuestro front).
// Izquierda: paciente, alergias, accesos, "Nueva atención" y tabla de atenciones.
// Derecha: pestañas Evolución · Receta · Antecedentes y alergias (+ próximas: procedimientos, escalas, podograma, consentimientos).
// Vista PURA: toda la lógica vive en services/historiaClinicaService.ts.
import { useState } from 'react';
import { Skeleton } from '../components/ui/Skeleton';
import { AlergiasBanner } from '../components/historiaClinica/AlergiasBanner';
import { BuscadorCie10 } from '../components/historiaClinica/Buscadores';
import { RegistrarAtencionModal } from '../components/historiaClinica/RegistrarAtencionModal';
import { EmitirRecetaModal } from '../components/historiaClinica/EmitirRecetaModal';
import { DialogoMotivo } from '../components/historiaClinica/DialogoMotivo';
import { BotonHistorialGenexis } from '../components/pacientes/HistorialGenexis';
import { useHistoriaClinicaPage, useEvolucionForm, useAntecedentesAlergias, useRecetasAtencion, type TabHc } from '../services/historiaClinicaService';
import { TIPO_ANTECEDENTE_LABEL, TIPO_NOTA_LABEL, edadDe, nombreProfesional, type AtencionClinica, type AtencionCompleta, type TipoAntecedente, type TipoNota, type SeveridadAlergia } from '../api/historiaClinica';
import { TIPO_DOC_LABEL } from '../api/recetas';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const TABS: { id: TabHc; label: string; icon: string; pronto?: boolean }[] = [
  { id: 'evolucion', label: 'Evolución', icon: 'clinical_notes' },
  { id: 'receta', label: 'Receta', icon: 'prescriptions' },
  { id: 'antecedentes', label: 'Antecedentes y alergias', icon: 'health_and_safety' },
  { id: 'procedimientos', label: 'Procedimientos', icon: 'medical_services', pronto: true },
  { id: 'escalas', label: 'Escalas', icon: 'monitor_heart', pronto: true },
  { id: 'podograma', label: 'Podograma', icon: 'footprint', pronto: true },
  { id: 'consentimientos', label: 'Consentimientos', icon: 'contract', pronto: true },
];

export function HistoriaClinicaPage() {
  const h = useHistoriaClinicaPage();
  const p = h.paciente;
  const nombre = p ? `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}` : '';

  if (h.cargando) return <div className="p-container-padding space-y-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (h.errorCarga || !p) return <div className="p-container-padding text-sm text-rose-700">{h.errorCarga?.message ?? 'No se pudo cargar la historia clínica'}</div>;

  const alergias = h.historia?.alergias ?? [];
  const atenciones = h.historia?.atenciones ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-on-surface">
      {/* Top App Bar */}
      <header className="glass-header sticky top-0 z-40 bg-surface/80 border-b border-outline-variant/30 px-grid-gutter h-16 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-6 min-w-0">
          <button onClick={() => h.navigate(`/pacientes/${p.id}`)} className="flex items-center text-on-surface-variant hover:text-primary transition-colors">
            <span className="material-symbols-outlined mr-2">arrow_back</span><span className="font-body-md font-medium">Ficha</span>
          </button>
          <div className="h-6 w-px bg-outline-variant/30" />
          <span className="font-headline-sm text-headline-sm font-semibold text-on-surface truncate flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">clinical_notes</span>Historia clínica
            {h.historia && <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold font-mono-label">HC N° {String(h.historia.numero).padStart(6, '0')}</span>}
          </span>
        </div>
        {h.puedeRegistrar && (
          <div className="relative">
            <button onClick={() => h.setMostrarCandidatas((v) => !v)} className="px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center text-sm">
              <span className="material-symbols-outlined mr-2 text-base">add_circle</span>Nueva atención
            </button>
            {h.mostrarCandidatas && (
              <div className="absolute right-0 mt-2 w-[380px] bg-surface-container-lowest border border-outline-variant/40 rounded-2xl shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-outline-variant/20 text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">Citas atendidas sin atención clínica</div>
                {h.citasCandidatas.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-on-surface-variant">No hay citas atendidas pendientes. La atención se registra desde una cita que llegó, está en atención o se completó.</div>
                ) : h.citasCandidatas.map((c) => (
                  <button key={c.id} onClick={() => { h.setCitaARegistrar(c); h.setMostrarCandidatas(false); }} className="w-full text-left px-4 py-2.5 hover:bg-primary/5 border-b border-outline-variant/10 last:border-0 flex items-center gap-3">
                    <span className="w-1.5 h-8 rounded-full" style={{ background: c.servicio?.color ?? '#0044ab' }} />
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-on-surface">{fmtFecha(c.fecha)} · {c.horaInicio} · {c.servicio?.nombre}</span><span className="block text-[11px] text-on-surface-variant">{c.sede?.nombre} · {c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}` : '—'} · {c.estado}</span></span>
                    <span className="material-symbols-outlined text-primary">chevron_right</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* ── Panel izquierdo ── */}
        <aside className="w-[380px] shrink-0 border-r border-outline-variant/20 bg-surface-container-lowest overflow-y-auto">
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary-fixed flex items-center justify-center text-primary font-bold text-lg shrink-0">{(p.nombres[0] ?? '') + (p.apellidoPaterno[0] ?? '')}</div>
              <div className="min-w-0">
                <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface leading-tight">{nombre}</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">{p.tipoDocumento} {p.numeroDocumento}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg bg-surface-container-low/60 p-2"><span className={LBL}>Edad</span><b>{edadDe(p.fechaNacimiento)}</b></div>
              <div className="rounded-lg bg-surface-container-low/60 p-2"><span className={LBL}>Sexo</span><b className="capitalize">{p.sexo ?? '—'}</b></div>
              <div className="rounded-lg bg-surface-container-low/60 p-2"><span className={LBL}>Nacimiento</span><b>{p.fechaNacimiento ? fmtFecha(p.fechaNacimiento) : '—'}</b></div>
            </div>
            <AlergiasBanner alergias={alergias} compacto />

            {/* Accesos */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { t: 'antecedentes' as TabHc, l: 'Antecedentes y alergias', i: 'health_and_safety' },
                { t: 'receta' as TabHc, l: 'Recetas', i: 'prescriptions' },
              ].map((a) => (
                <button key={a.t} onClick={() => h.setTab(a.t)} className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${h.tab === a.t ? 'border-primary bg-primary/5 text-primary' : 'border-outline-variant/30 text-on-surface hover:bg-surface-container-low'}`}>
                  <span className="material-symbols-outlined text-base">{a.i}</span>{a.l}
                </button>
              ))}
            </div>
            <div className="[&>button]:w-full"><BotonHistorialGenexis pacienteId={p.id} nombrePaciente={nombre} documento={`${p.tipoDocumento} ${p.numeroDocumento}`} /></div>

            {/* Atenciones */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">Atenciones ({atenciones.length})</h3>
              </div>
              {atenciones.length === 0 ? (
                <div className="text-xs text-on-surface-variant border border-dashed border-outline-variant/40 rounded-xl p-4 text-center">Sin atenciones registradas</div>
              ) : (
                <div className="space-y-1.5">
                  {atenciones.map((a: AtencionClinica) => (
                    <button key={a.id} onClick={() => h.seleccionarAtencion(a.id)} className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${h.atencionSel === a.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:bg-surface-container-low'}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-8 rounded-full shrink-0" style={{ background: a.servicio.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-on-surface truncate">{fmtFecha(a.fecha)} · {a.cita.horaInicio} · {a.servicio.nombre}</div>
                          <div className="text-[11px] text-on-surface-variant truncate">{nombreProfesional(a.profesional)} · {a.sede.nombre}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${a.estado === 'cerrada' ? 'bg-surface-container text-on-surface-variant' : 'bg-emerald-100 text-emerald-700'}`}>{a.estado}</span>
                          <span className="text-[10px] text-on-surface-variant">{a.notas.length} nota{a.notas.length === 1 ? '' : 's'} · {a.diagnosticos.length} dx{a.recetas.length ? ` · ${a.recetas.length} rec.` : ''}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* ── Panel derecho ── */}
        <main className="flex-1 overflow-y-auto">
          <div className="border-b border-outline-variant/20 bg-surface-container-lowest px-6 pt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.id} disabled={t.pronto} onClick={() => h.setTab(t.id)} title={t.pronto ? 'Próximamente' : undefined}
                className={`px-4 py-2.5 text-sm font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${h.tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'} ${t.pronto ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <span className="material-symbols-outlined text-base">{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          <div className="p-6 max-w-[1100px]">
            {h.tab === 'antecedentes' && <PanelAntecedentes h={h} />}
            {(h.tab === 'evolucion' || h.tab === 'receta') && (
              !h.atencionSel ? (
                <div className="text-center py-20 text-on-surface-variant">
                  <span className="material-symbols-outlined text-5xl mb-2">clinical_notes</span>
                  <p className="text-sm">Selecciona una atención en el panel izquierdo{h.puedeRegistrar ? ' o registra una nueva' : ''}.</p>
                </div>
              ) : h.cargandoAtencion || !h.atencion ? <Skeleton className="h-64 w-full" /> : (
                <>
                  <CabeceraAtencion h={h} a={h.atencion} />
                  {h.tab === 'evolucion' && <PanelEvolucion h={h} a={h.atencion} />}
                  {h.tab === 'receta' && <PanelReceta h={h} a={h.atencion} />}
                </>
              )
            )}
          </div>
        </main>
      </div>

      {h.citaARegistrar && <RegistrarAtencionModal cita={h.citaARegistrar} nombrePaciente={nombre} onClose={() => h.setCitaARegistrar(null)} onCreada={h.onAtencionCreada} />}
      {h.recetaModal && h.atencion && <EmitirRecetaModal atencion={h.atencion} tipoDocumento={h.recetaModal} onClose={() => h.setRecetaModal(null)} />}
    </div>
  );
}

type H = ReturnType<typeof useHistoriaClinicaPage>;

function CabeceraAtencion({ h, a }: { h: H; a: AtencionCompleta }) {
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-headline-sm text-headline-sm font-bold text-on-surface">{fmtFecha(a.fecha)} · {a.cita.horaInicio}</span>
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: a.servicio.color }}>{a.servicio.nombre}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${a.estado === 'cerrada' ? 'bg-surface-container text-on-surface-variant' : 'bg-emerald-100 text-emerald-700'}`}>{a.estado}</span>
        </div>
        <p className="text-sm text-on-surface-variant mt-1"><b className="text-on-surface">{nombreProfesional(a.profesional)}</b> · {a.sede.nombre}{a.abiertaEtiqueta ? ` · registrada por ${a.abiertaEtiqueta}` : ''}</p>
        <p className="text-sm mt-2"><span className={LBL}>Motivo de consulta</span>{a.motivoConsulta}</p>
      </div>
      {h.puedeRegistrar && (
        a.estado === 'abierta'
          ? <button onClick={() => h.cerrarMut.mutate()} disabled={h.cerrarMut.isPending} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5"><span className="material-symbols-outlined text-base">lock</span>Cerrar atención</button>
          : h.puedeAnular && <button onClick={() => h.reabrirMut.mutate()} disabled={h.reabrirMut.isPending} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5"><span className="material-symbols-outlined text-base">lock_open</span>Reabrir</button>
      )}
    </div>
  );
}

function PanelEvolucion({ h, a }: { h: H; a: AtencionCompleta }) {
  const e = useEvolucionForm(a, h.puedeRegistrar);
  const [confirmarDx, setConfirmarDx] = useState<string | null>(null);
  const [confirmarNota, setConfirmarNota] = useState<string | null>(null);
  return (
    <div className="space-y-6">
      {/* Diagnósticos */}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center"><span className="material-symbols-outlined mr-2 text-primary">diagnosis</span>Diagnósticos</h3>
          {h.puedeRegistrar && e.tieneDxAnteriores && <button onClick={e.copiarDxAnteriores} className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-base">content_copy</span>Copiar anteriores</button>}
        </div>
        {a.diagnosticos.length === 0 && <p className="text-sm text-on-surface-variant mb-3">Sin diagnósticos registrados.</p>}
        <div className="space-y-1.5 mb-3">
          {a.diagnosticos.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-outline-variant/20 px-3 py-2">
              <span className="font-mono-label text-mono-label font-bold text-primary w-14">{d.cie10Codigo}</span>
              <span className="text-sm text-on-surface flex-1 min-w-0 truncate">{d.cie10.descripcion}{d.observacion ? <span className="text-on-surface-variant"> · {d.observacion}</span> : null}</span>
              {h.puedeRegistrar ? (
                <select value={d.tipo} onChange={(ev) => e.editarDxMut.mutate({ id: d.id, data: { tipo: ev.target.value as 'presuntivo' | 'definitivo' } })} className="text-xs bg-surface-container-low border border-outline-variant/40 rounded-md px-1.5 py-1">
                  <option value="presuntivo">Presuntivo</option><option value="definitivo">Definitivo</option>
                </select>
              ) : <span className="text-xs text-on-surface-variant capitalize">{d.tipo}</span>}
              <button disabled={!h.puedeRegistrar} onClick={() => e.editarDxMut.mutate({ id: d.id, data: { principal: !d.principal } })} className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${d.principal ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}>{d.principal ? 'Principal' : 'Secundario'}</button>
              {h.puedeRegistrar && <button onClick={() => setConfirmarDx(d.id)} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>}
            </div>
          ))}
        </div>
        {h.puedeRegistrar && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_auto] gap-2 items-end">
            <div>
              <label className={LBL}>Agregar diagnóstico</label>
              {e.dxSel ? (
                <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/30 px-3 py-2 text-sm"><b className="text-primary">{e.dxSel.codigo}</b><span className="truncate flex-1">{e.dxSel.descripcion}</span><button onClick={() => e.setDxSel(null)} className="material-symbols-outlined text-base">close</button></div>
              ) : <BuscadorCie10 onSeleccionar={e.setDxSel} />}
            </div>
            <div><label className={LBL}>Tipo</label><select value={e.dxTipo} onChange={(ev) => e.setDxTipo(ev.target.value as 'presuntivo' | 'definitivo')} className={INPUT}><option value="presuntivo">Presuntivo</option><option value="definitivo">Definitivo</option></select></div>
            <label className="flex items-center gap-2 text-sm pb-2.5"><input type="checkbox" checked={e.dxPrincipal} onChange={(ev) => e.setDxPrincipal(ev.target.checked)} />Principal</label>
            <button disabled={!e.dxSel || e.agregarDxMut.isPending} onClick={() => e.dxSel && e.agregarDxMut.mutate({ cie10Codigo: e.dxSel.codigo, tipo: e.dxTipo, principal: e.dxPrincipal, observacion: e.dxObs || null })}
              className="px-4 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Agregar</button>
          </div>
        )}
      </section>

      {/* Notas de evolución */}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center"><span className="material-symbols-outlined mr-2 text-primary">edit_note</span>Evolución</h3>
          {h.puedeRegistrar && e.tieneNotaAnterior && !e.editando && <button onClick={e.traerUltimaNota} className="text-primary text-xs font-semibold hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-base">history</span>Traer última nota</button>}
        </div>
        {a.notas.length > 0 && (
          <div className="space-y-2 mb-4">
            {a.notas.map((n) => (
              <div key={n.id} className={`rounded-xl border px-4 py-3 ${e.editando === n.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20'}`}>
                <div className="flex items-center gap-2 text-[11px] text-on-surface-variant mb-1.5">
                  <span className="font-bold uppercase text-primary">{TIPO_NOTA_LABEL[n.tipo]}</span>
                  <span>· {fmtFechaHora(n.creadoEn)}</span>
                  <span>· {n.profesional ? nombreProfesional(n.profesional) : n.autorEtiqueta}{n.profesional && n.autorEtiqueta !== nombreProfesional(n.profesional) ? ` (registró ${n.autorEtiqueta})` : ''}</span>
                  <span className="flex-1" />
                  {h.puedeRegistrar && <button onClick={() => e.cargarNota(n)} className="text-primary font-semibold hover:underline">Editar</button>}
                  {h.puedeAnular && <button onClick={() => setConfirmarNota(n.id)} className="text-rose-600 font-semibold hover:underline">Eliminar</button>}
                </div>
                {[['Subjetivo', n.subjetivo], ['Objetivo', n.objetivo], ['Apreciación', n.apreciacion], ['Plan', n.plan], ['', n.texto]].filter(([, v]) => v).map(([k, v]) => (
                  <p key={k as string} className="text-sm text-on-surface whitespace-pre-wrap">{k ? <b className="text-on-surface-variant">{k}: </b> : null}{v}</p>
                ))}
              </div>
            ))}
          </div>
        )}
        {h.puedeRegistrar && (
          <div className="space-y-3">
            {e.cerrada && !e.editando && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">Atención cerrada: solo se admiten <b>observaciones</b> tardías.</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className={LBL}>Tipo de nota</label>
                <select value={e.tipo} onChange={(ev) => e.setTipo(ev.target.value as TipoNota)} className={INPUT}>
                  {(Object.keys(TIPO_NOTA_LABEL) as TipoNota[]).map((t) => <option key={t} value={t}>{TIPO_NOTA_LABEL[t]}</option>)}
                </select>
              </div>
              <div><label className={LBL}>A nombre de</label>
                <select value={e.profesionalId} onChange={(ev) => e.setProfesionalId(ev.target.value)} className={INPUT}>
                  <option value={a.profesionalId}>{nombreProfesional(a.profesional)} (atendió)</option>
                </select>
              </div>
            </div>
            {e.tipo === 'observacion' ? (
              <div><label className={LBL}>Observación</label><textarea value={e.texto} onChange={(ev) => e.setTexto(ev.target.value)} rows={3} maxLength={5000} className={INPUT} /></div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={LBL}>Subjetivo</label><textarea value={e.subjetivo} onChange={(ev) => e.setSubjetivo(ev.target.value)} rows={3} maxLength={5000} placeholder="Lo que refiere el paciente" className={INPUT} /></div>
                <div><label className={LBL}>Objetivo</label><textarea value={e.objetivo} onChange={(ev) => e.setObjetivo(ev.target.value)} rows={3} maxLength={5000} placeholder="Examen físico, hallazgos" className={INPUT} /></div>
                <div><label className={LBL}>Apreciación</label><textarea value={e.apreciacion} onChange={(ev) => e.setApreciacion(ev.target.value)} rows={3} maxLength={5000} placeholder="Análisis / impresión clínica" className={INPUT} /></div>
                <div><label className={LBL}>Plan</label><textarea value={e.plan} onChange={(ev) => e.setPlan(ev.target.value)} rows={3} maxLength={5000} placeholder="Tratamiento, indicaciones, control" className={INPUT} /></div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              {e.editando && <button onClick={e.limpiarNota} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold hover:bg-surface-container-high">Cancelar edición</button>}
              <button disabled={!e.puedeGuardarNota || e.guardarNotaMut.isPending} onClick={() => e.guardarNotaMut.mutate()} className="px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:opacity-90 disabled:opacity-50">
                {e.guardarNotaMut.isPending ? 'Guardando…' : e.editando ? 'Guardar cambios' : 'Guardar nota'}
              </button>
            </div>
          </div>
        )}
      </section>
      {confirmarDx && <DialogoMotivo titulo="Eliminar diagnóstico" descripcion="Se quita de la atención (queda registro interno)." confirmar="Eliminar" pending={e.eliminarDxMut.isPending} onConfirmar={() => { e.eliminarDxMut.mutate(confirmarDx); setConfirmarDx(null); }} onClose={() => setConfirmarDx(null)} />}
      {confirmarNota && <DialogoMotivo titulo="Eliminar nota" descripcion="La nota deja de verse en la historia (queda en el historial interno)." confirmar="Eliminar" pending={e.eliminarNotaMut.isPending} onConfirmar={() => { e.eliminarNotaMut.mutate(confirmarNota); setConfirmarNota(null); }} onClose={() => setConfirmarNota(null)} />}
    </div>
  );
}

function PanelReceta({ h, a }: { h: H; a: AtencionCompleta }) {
  const r = useRecetasAtencion(a);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {h.esMedicoPrescriptor && <button onClick={() => h.setRecetaModal('RECETA_MEDICA')} className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:opacity-90 flex items-center gap-2"><span className="material-symbols-outlined text-base">prescriptions</span>Emitir receta médica</button>}
        {h.puedeRegistrar && <button onClick={() => h.setRecetaModal('INDICACIONES_PODOLOGICAS')} className="px-5 py-2.5 border border-primary/40 text-primary bg-primary/5 rounded-xl text-sm font-bold hover:bg-primary/10 flex items-center gap-2"><span className="material-symbols-outlined text-base">clinical_notes</span>Indicaciones podológicas</button>}
        {!h.esMedicoPrescriptor && h.usuario?.rol === 'medico' && <p className="text-xs text-amber-700 self-center">Para emitir recetas tu ficha de médico necesita la colegiatura (CMP) cargada.</p>}
      </div>
      {r.recetas.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant border border-dashed border-outline-variant/40 rounded-2xl"><span className="material-symbols-outlined text-4xl mb-1">prescriptions</span><p className="text-sm">Sin recetas ni indicaciones en esta atención.</p></div>
      ) : (
        <div className="space-y-2">
          {r.recetas.map((x) => (
            <div key={x.id} className={`rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-3 ${x.estado === 'anulada' ? 'border-rose-200 bg-rose-50/40' : 'border-outline-variant/30 bg-surface-container-lowest'}`}>
              <span className="material-symbols-outlined text-primary">{x.tipoDocumento === 'RECETA_MEDICA' ? 'prescriptions' : 'clinical_notes'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-on-surface">{TIPO_DOC_LABEL[x.tipoDocumento]} N° {String(x.numero).padStart(6, '0')} {x.estado === 'anulada' && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Anulada</span>}</div>
                <div className="text-[11px] text-on-surface-variant">{fmtFechaHora(x.fechaEmision)} · {x.emisorNombre} · {x._count.items} ítem(s) · verificación {x.codigoVerificacion}</div>
              </div>
              <button onClick={() => r.ver(x.id)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver</button>
              <button onClick={() => r.imprimir(x.id)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">print</span>Imprimir</button>
              {x.estado === 'emitida' && (h.puedeAnular || h.esMedicoPrescriptor || h.puedeRegistrar) && <button onClick={() => r.setAnulando(x.id)} className="px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Anular</button>}
            </div>
          ))}
        </div>
      )}
      {r.anulando && <DialogoMotivo titulo="Anular documento" descripcion="El documento queda anulado (no se borra) y su PDF sale con marca de agua." confirmar="Anular" pending={r.anularMut.isPending} onConfirmar={(m) => r.anularMut.mutate({ id: r.anulando!, motivo: m })} onClose={() => r.setAnulando(null)} />}
    </div>
  );
}

function PanelAntecedentes({ h }: { h: H }) {
  const f = useAntecedentesAlergias(h.pacienteId);
  const alergias = h.historia?.alergias ?? [];
  const antecedentes = h.historia?.antecedentes ?? [];
  const SEV: Record<SeveridadAlergia, string> = { leve: 'bg-amber-100 text-amber-800', moderada: 'bg-orange-100 text-orange-800', severa: 'bg-rose-100 text-rose-800' };
  return (
    <div className="grid grid-cols-1 gap-6">
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-error">warning</span>Alergias / RAM</h3>
        {alergias.length === 0 && <p className="text-sm text-on-surface-variant mb-3">Ninguna registrada.</p>}
        <div className="space-y-1.5 mb-4">
          {alergias.map((x) => (
            <div key={x.id} className={`flex items-center gap-2 rounded-xl border border-outline-variant/20 px-3 py-2 ${!x.activa ? 'opacity-50' : ''}`}>
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEV[x.severidad]}`}>{x.severidad}</span>
              <span className="text-sm font-semibold text-on-surface">{x.sustancia}</span>
              {x.reaccion && <span className="text-xs text-on-surface-variant">· {x.reaccion}</span>}
              <span className="flex-1" />
              {h.puedeRegistrar && <button onClick={() => f.toggleAlergiaMut.mutate({ id: x.id, activa: !x.activa })} className="text-xs text-primary font-semibold hover:underline">{x.activa ? 'Desactivar' : 'Activar'}</button>}
              {h.puedeAnular && <button onClick={() => f.eliminarAlergiaMut.mutate(x.id)} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>}
            </div>
          ))}
        </div>
        {h.puedeRegistrar && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2 items-end">
            <div><label className={LBL}>Sustancia</label><input value={f.sustancia} onChange={(e) => f.setSustancia(e.target.value)} placeholder="Ej. Penicilina" className={INPUT} /></div>
            <div><label className={LBL}>Reacción</label><input value={f.reaccion} onChange={(e) => f.setReaccion(e.target.value)} placeholder="Ej. Erupción" className={INPUT} /></div>
            <div><label className={LBL}>Severidad</label><select value={f.severidad} onChange={(e) => f.setSeveridad(e.target.value as SeveridadAlergia)} className={INPUT}><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="severa">Severa</option></select></div>
            <button disabled={!f.puedeGuardarAlergia || f.alergiaMut.isPending} onClick={() => f.alergiaMut.mutate()} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Agregar</button>
          </div>
        )}
      </section>
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-primary">history_edu</span>Antecedentes</h3>
        {antecedentes.length === 0 && <p className="text-sm text-on-surface-variant mb-3">Ninguno registrado.</p>}
        <div className="space-y-1.5 mb-4">
          {antecedentes.map((x) => (
            <div key={x.id} className={`flex items-center gap-2 rounded-xl border border-outline-variant/20 px-3 py-2 ${!x.activo ? 'opacity-50' : ''}`}>
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">{TIPO_ANTECEDENTE_LABEL[x.tipo]}</span>
              <span className="text-sm text-on-surface flex-1">{x.descripcion}</span>
              {h.puedeRegistrar && <button onClick={() => f.toggleAntecedenteMut.mutate({ id: x.id, activo: !x.activo })} className="text-xs text-primary font-semibold hover:underline">{x.activo ? 'Desactivar' : 'Activar'}</button>}
              {h.puedeAnular && <button onClick={() => f.eliminarAntecedenteMut.mutate(x.id)} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>}
            </div>
          ))}
        </div>
        {h.puedeRegistrar && (
          <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_auto] gap-2 items-end">
            <div><label className={LBL}>Tipo</label><select value={f.antTipo} onChange={(e) => f.setAntTipo(e.target.value as TipoAntecedente)} className={INPUT}>{(Object.keys(TIPO_ANTECEDENTE_LABEL) as TipoAntecedente[]).map((t) => <option key={t} value={t}>{TIPO_ANTECEDENTE_LABEL[t]}</option>)}</select></div>
            <div><label className={LBL}>Descripción</label><input value={f.antDesc} onChange={(e) => f.setAntDesc(e.target.value)} placeholder="Ej. Diabetes mellitus tipo 2 (2019)" className={INPUT} onKeyDown={(e) => { if (e.key === 'Enter' && f.puedeGuardarAntecedente) f.antecedenteMut.mutate(); }} /></div>
            <button disabled={!f.puedeGuardarAntecedente || f.antecedenteMut.isPending} onClick={() => f.antecedenteMut.mutate()} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Agregar</button>
          </div>
        )}
      </section>
    </div>
  );
}
