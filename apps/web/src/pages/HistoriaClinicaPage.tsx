// Historia clínica — página de DOS PANELES (estructura pedida por el doctor, con nuestro front).
// Izquierda: paciente, alergias, accesos, "Nueva atención" y tabla de atenciones.
// Derecha: pestañas Evolución · Receta · Antecedentes y alergias (+ próximas: procedimientos, escalas, podograma, consentimientos).
// Vista PURA: toda la lógica vive en services/historiaClinicaService.ts.
import { useEffect, useRef, useState, type PointerEvent as EventoPuntero } from 'react';
import { Skeleton } from '../components/ui/Skeleton';
import { PodogramaEditor } from '../components/historiaClinica/PodogramaEditor';
import { TextareaDictado } from '../components/historiaClinica/BotonDictado';
import { BarraDictadoConsulta } from '../components/historiaClinica/DictadoConsulta';
import type { SeccionDictado } from '../utils/dictadoEstructurado';
import { AlergiasBanner } from '../components/historiaClinica/AlergiasBanner';
import { BuscadorCie10 } from '../components/historiaClinica/Buscadores';
import { FormItb, FormOsi, FormManchester, FormExamenPie } from '../components/historiaClinica/EscalasPie';
import { CatalogoCie10Dialog } from '../components/historiaClinica/CatalogoCie10Dialog';
import { CamaraFantasma } from '../components/historiaClinica/CamaraFantasma';
import { RegistrarAtencionModal } from '../components/historiaClinica/RegistrarAtencionModal';
import { EmitirRecetaModal } from '../components/historiaClinica/EmitirRecetaModal';
import { DialogoMotivo } from '../components/historiaClinica/DialogoMotivo';
import { PanelConsentimientos } from '../components/historiaClinica/PanelConsentimientos';
import { ConstanciasSection } from '../components/historiaClinica/ConstanciasSection';
import { DialogoCierreAtencion } from '../components/historiaClinica/DialogoCierreAtencion';
import { RevisarDictadoDialog } from '../components/historiaClinica/RevisarDictadoDialog';
import { useInvalidarControles } from '../services/controlesService';
import { BotonHistorialGenexis } from '../components/pacientes/HistorialGenexis';
import type { HistorialGenexisRegistro } from '../api';
import { ComparadorFotos } from '../components/historiaClinica/ComparadorFotos';
import { SiluetaPie, MonofilamentoPie, aspectoSilueta, proporcionSilueta } from '../components/historiaClinica/SiluetaPie';
import { estiloGiro, giroSilueta, puntoTocado } from '../utils/giroSilueta';
import { LienzoSilueta } from '../components/historiaClinica/LienzoSilueta';
import { SelectorLesion, LeyendaLesiones, calcularLeyenda, trazosComoLeyenda, resumenTipos } from '../components/historiaClinica/Lesiones';
import { MedidorUlcera } from '../components/historiaClinica/MedidorUlcera';
import { FUENTE_ICONO, FUENTE_LABEL, type EventoZona } from '../utils/historialZonas';
import { PlantillasDialog } from '../components/historiaClinica/PlantillasDialog';
import { ResumenPacienteDialog } from '../components/historiaClinica/ResumenPacienteDialog';
import { ZONAS_PIE, coordZona, zonaPorId } from '../utils/zonasPie';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useHistoriaClinicaPage, useAntecedentesAlergias, useRecetasAtencion, useEscalas, usePodograma, useMiniaturaPodograma, useFotosClinicas, useFotoUrl, MF_ETIQUETAS, IWGDF_CONTROL, type TabHc } from '../services/historiaClinicaService';
import type { FotoPendiente, CamposPendiente } from '../stores/fotosPendientesStore';
import { VISTA_SILUETA_LABEL, TIPO_ANTECEDENTE_LABEL, TIPO_NOTA_LABEL, TIPO_PROCEDIMIENTO_LABEL, TIPO_ESCALA_LABEL, TIPO_LESION_LABEL, COLOR_LESION, etiquetaLesion, PIE_LABEL, VISTAS_PODOGRAMA, VISTA_PODOGRAMA_LABEL, CATEGORIA_FOTO_LABEL, edadDe, nombreProfesional, type AtencionClinica, type AtencionCompleta, type TipoAntecedente, type TipoNota, type SeveridadAlergia, type TipoProcedimiento, type TipoEscala, type TipoLesion, type MarcaPodograma, type VistaSilueta, type AnotacionPodograma, type ImagenPodograma, type VistaPodograma, type CategoriaFoto, type FotoClinica, type Pie } from '../api/historiaClinica';
import { TIPO_DOC_LABEL } from '../api/recetas';
import { historiaClinicaApi, ORIGEN_CONTROL_LABEL } from '../api/historiaClinica';
import toast from 'react-hot-toast';
import { useConfirmarQuitar } from '../components/historiaClinica/DialogoConfirmar';
import { faltantesAtencion } from '../utils/faltantesAtencion';
import { fmtFechaLima } from '../utils/fechas';

const ESTADO_CITA_LABEL: Record<string, string> = { llego: 'Llegó', en_atencion: 'En atención', completada: 'Completada', agendada: 'Agendada', confirmada: 'Confirmada' };

// text-base en pantallas chicas: con menos de 16px iOS hace zoom al enfocar un campo (molesto en tablet).
const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const fmtFechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const TABS: { id: TabHc; label: string; icon: string; pronto?: boolean }[] = [
  { id: 'evolucion', label: 'Evolución', icon: 'clinical_notes' },
  { id: 'receta', label: 'Receta', icon: 'prescriptions' },
  { id: 'antecedentes', label: 'Antecedentes y alergias', icon: 'health_and_safety' },
  { id: 'procedimientos', label: 'Procedimientos', icon: 'medical_services' },
  { id: 'escalas', label: 'Escalas', icon: 'monitor_heart' },
  { id: 'podograma', label: 'Podograma', icon: 'footprint' },
  { id: 'fotos', label: 'Fotos', icon: 'photo_camera' },
  { id: 'consentimientos', label: 'Consentimientos', icon: 'contract' },
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
            {h.historia?.estado === 'pasiva' && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold uppercase" title="Historia en archivo pasivo (sin atenciones recientes)">En archivo</span>}
          </span>
        </div>
        {h.puedeRegistrar && (
          <div className="relative">
            <button onClick={() => h.setMostrarCandidatas((v) => !v)} title="Nueva atención" className="min-h-[44px] px-4 lg:px-5 py-2.5 bg-primary text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all flex items-center text-sm whitespace-nowrap">
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
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-on-surface">{fmtFecha(c.fecha)} · {c.horaInicio} · {c.servicio?.nombre}</span><span className="block text-[11px] text-on-surface-variant">{c.sede?.nombre} · {c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}` : '—'} · {ESTADO_CITA_LABEL[(c.estado || '').toLowerCase()] ?? c.estado}</span></span>
                    <span className="material-symbols-outlined text-primary">chevron_right</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Escritorio (≥1024px): dos paneles lado a lado, cada uno con su propio scroll.
          Tablet vertical / celular: se APILAN (paciente arriba, compacto; pestañas debajo) y
          la página entera desplaza como una sola. */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* ── Panel izquierdo ── */}
        <aside className="w-full lg:w-[380px] shrink-0 border-b lg:border-b-0 lg:border-r border-outline-variant/20 bg-surface-container-lowest lg:overflow-y-auto">
          <div className="p-4 lg:p-5 space-y-3 lg:space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 lg:w-14 lg:h-14 rounded-2xl bg-primary-fixed flex items-center justify-center text-primary font-bold text-lg shrink-0">{(p.nombres[0] ?? '') + (p.apellidoPaterno[0] ?? '')}</div>
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
            {/* A3 · Estado de la HC: activa / pasiva (archivo). Lo cambia administración o coordinación. */}
            {h.historia && (
              <div className={`flex items-center gap-2 flex-wrap rounded-lg px-3 py-2 text-xs ${h.historia.estado === 'pasiva' ? 'bg-amber-50 border border-amber-200' : 'bg-surface-container-low/60'}`} data-testid="estado-hc">
                <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${h.historia.estado === 'pasiva' ? 'bg-amber-200 text-amber-900' : 'bg-emerald-100 text-emerald-700'}`}>{h.historia.estado === 'pasiva' ? 'Historia en archivo' : 'Historia activa'}</span>
                <span className="text-on-surface-variant flex-1 min-w-0">{atenciones[0] ? `Última atención: ${fmtFecha(atenciones[0].fecha)}` : h.lineaTiempo[0] ? `Última visita (sistema anterior): ${fmtFecha(h.lineaTiempo[0].fecha)}` : 'Sin atenciones'}</span>
                {h.puedeAnular && (
                  <button onClick={h.alternarEstadoHc} disabled={h.estadoHcMut.isPending} className="min-h-[44px] lg:min-h-0 text-primary font-semibold hover:underline disabled:opacity-50">{h.historia.estado === 'pasiva' ? 'Sacar del archivo' : 'Enviar al archivo'}</button>
                )}
                {h.sugerirPasiva && <span className="w-full text-[11px] text-amber-700">Más de 5 años sin atenciones: puede pasar al archivo.</span>}
              </div>
            )}
            {h.historia && h.pacienteId && <BotonPdfHistoria pacienteId={h.pacienteId} />}
            <AlergiasBanner alergias={alergias} compacto />

            {/* Accesos: en pantallas chicas se ocultan (ya existen como pestañas) */}
            <div className="hidden lg:grid grid-cols-2 gap-2">
              {[
                { t: 'antecedentes' as TabHc, l: 'Antecedentes y alergias', i: 'health_and_safety' },
                { t: 'receta' as TabHc, l: 'Recetas', i: 'prescriptions' },
              ].map((a) => (
                <button key={a.t} onClick={() => h.setTab(a.t)} className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all ${h.tab === a.t ? 'border-primary bg-primary/5 text-primary' : 'border-outline-variant/30 text-on-surface hover:bg-surface-container-low'}`}>
                  <span className="material-symbols-outlined text-base">{a.i}</span>{a.l}
                </button>
              ))}
            </div>
            {/* Línea de tiempo unificada (4.3): atenciones nuevas y visitas del sistema anterior (Genexis),
                de la más reciente a la más antigua. Lista vertical en escritorio; tira deslizable en tablet. */}
            <div>
              <div className="flex items-center justify-between mb-2 gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">Atenciones ({atenciones.length}){h.genexisTotal ? <span className="normal-case font-normal tracking-normal"> · {h.genexisTotal} del sistema anterior</span> : null}</h3>
              </div>
              {h.lineaTiempo.length === 0 ? (
                <div className="text-xs text-on-surface-variant border border-dashed border-outline-variant/40 rounded-xl p-4 text-center">Todavía no hay atenciones.{h.puedeRegistrar ? ' Toca «Nueva atención» arriba y elige la cita de hoy.' : ''}</div>
              ) : (
                <div className="flex lg:flex-col gap-2 lg:gap-1.5 overflow-x-auto lg:overflow-visible snap-x -mx-4 px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
                  {h.lineaTiempo.map((it) => it.tipo === 'hc' ? (
                    <button key={it.id} onClick={() => h.seleccionarAtencion(it.id)} className={`shrink-0 w-[270px] lg:w-full snap-start text-left rounded-xl border px-3 py-2 transition-all ${h.atencionSel === it.id && !h.genexisSel ? 'border-primary bg-primary/5' : 'border-outline-variant/20 hover:bg-surface-container-low'}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-1 h-8 rounded-full shrink-0" style={{ background: it.atencion.servicio.color }} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-on-surface truncate">{fmtFecha(it.atencion.fecha)} · {it.atencion.cita.horaInicio} · {it.atencion.servicio.nombre}</div>
                          <div className="text-[11px] text-on-surface-variant truncate">{nombreProfesional(it.atencion.profesional)} · {it.atencion.sede.nombre}</div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${it.atencion.estado === 'cerrada' ? 'bg-surface-container text-on-surface-variant' : 'bg-emerald-100 text-emerald-700'}`}>{it.atencion.estado === 'cerrada' ? 'Cerrada' : 'Abierta'}</span>
                          <span className="text-[10px] text-on-surface-variant">{it.atencion.notas.length} nota{it.atencion.notas.length === 1 ? '' : 's'} · {it.atencion.diagnosticos.length} diagn.{it.atencion.recetas.length ? ` · ${it.atencion.recetas.length} receta${it.atencion.recetas.length === 1 ? '' : 's'}` : ''}</span>
                        </div>
                      </div>
                    </button>
                  ) : (
                    <button key={it.id} onClick={() => h.seleccionarGenexis(it.id)} data-testid="visita-genexis" className={`shrink-0 w-[270px] lg:w-full snap-start text-left rounded-xl border border-dashed px-3 py-2 transition-all ${h.genexisSel === it.id ? 'border-primary bg-primary/5' : 'border-outline-variant/40 bg-surface-container-low/40 hover:bg-surface-container-low'}`}>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-on-surface-variant/70 text-lg shrink-0">inventory_2</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-on-surface truncate">{fmtFecha(it.visita.fechaCita)}{it.visita.horaCita ? ` · ${it.visita.horaCita} h` : ''} · {it.visita.servicio ?? 'Visita'}</div>
                          <div className="text-[11px] text-on-surface-variant truncate">{it.visita.podologo ?? '—'}{it.visita.sede ? ` · ${it.visita.sede}` : ''}</div>
                        </div>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant shrink-0">Sistema anterior</span>
                      </div>
                    </button>
                  ))}
                  {h.hayMasGenexis && (
                    <button onClick={h.cargarMasGenexis} disabled={h.cargandoGenexis} className="shrink-0 w-[270px] lg:w-full min-h-[44px] rounded-xl border border-outline-variant/40 text-xs font-semibold text-primary hover:bg-surface-container-low disabled:opacity-50">
                      {h.cargandoGenexis ? 'Cargando…' : 'Ver visitas más antiguas'}
                    </button>
                  )}
                </div>
              )}
              {h.genexisTotal > 0 && <div className="mt-2 [&>button]:w-full [&>button]:justify-center"><BotonHistorialGenexis pacienteId={p.id} nombrePaciente={nombre} documento={`${p.tipoDocumento} ${p.numeroDocumento}`} /></div>}
            </div>
          </div>
        </aside>

        {/* ── Panel derecho ── */}
        <main className="flex-1 lg:overflow-y-auto">
          {/* Pestañas: pegadas arriba al desplazar (en tablet la página entera es la que scrollea) */}
          {/* En tablet las 8 pestañas se reparten en dos filas (nada queda oculto fuera de la pantalla) */}
          <div className="sticky top-0 z-10 border-b border-outline-variant/20 bg-surface-container-lowest px-3 lg:px-6 pt-2 lg:pt-3 flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button key={t.id} disabled={t.pronto} onClick={() => h.setTab(t.id)} title={t.pronto ? 'Próximamente' : undefined}
                className={`px-3 lg:px-4 py-3 lg:py-2.5 text-sm font-semibold border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-colors ${h.tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'} ${t.pronto ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <span className="material-symbols-outlined text-base">{t.icon}</span>{t.label}
                {t.id === 'fotos' && h.fotosSinGuardar > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center" title="Fotos sin guardar" data-testid="badge-fotos-sin-guardar">{h.fotosSinGuardar}</span>
                )}
              </button>
            ))}
          </div>
          <div className="p-3 sm:p-4 lg:p-6 max-w-[1100px]">
            {h.tab === 'antecedentes' && <PanelAntecedentes h={h} />}
            {h.tab !== 'antecedentes' && h.genexisSel && <VisitaGenexisCard visita={h.visitaGenexis} />}
            {(h.tab === 'evolucion' || h.tab === 'receta' || h.tab === 'procedimientos' || h.tab === 'escalas' || h.tab === 'podograma' || h.tab === 'fotos' || h.tab === 'consentimientos') && !h.genexisSel && (
              !h.atencionSel ? (
                <div className="text-center py-20 text-on-surface-variant">
                  <span className="material-symbols-outlined text-5xl mb-2">clinical_notes</span>
                  <p className="text-sm">Selecciona una atención en el panel izquierdo{h.puedeRegistrar ? ' o registra una nueva' : ''}.</p>
                </div>
              ) : h.errorAtencion ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 text-sm text-rose-800">
                  No se pudo abrir esta atención: {h.errorAtencion.message}. Elige otra en la lista de la izquierda.
                </div>
              ) : h.cargandoAtencion || !h.atencion ? <Skeleton className="h-64 w-full" /> : (
                <>
                  <CabeceraAtencion h={h} a={h.atencion} />
                  {h.tab === 'evolucion' && <PanelEvolucion h={h} a={h.atencion} />}
                  {h.tab === 'receta' && <PanelReceta h={h} a={h.atencion} />}
                  {h.tab === 'procedimientos' && <PanelProcedimientos h={h} a={h.atencion} />}
                  {h.tab === 'escalas' && <PanelEscalas h={h} a={h.atencion} />}
                  {h.tab === 'podograma' && <PanelPodograma h={h} a={h.atencion} />}
                  {h.tab === 'fotos' && <PanelFotos h={h} a={h.atencion} />}
                  {h.tab === 'consentimientos' && <PanelConsentimientos a={h.atencion} puedeRegistrar={h.puedeRegistrar} />}
                </>
              )
            )}
          </div>
        </main>
      </div>

      {h.citaARegistrar && <RegistrarAtencionModal cita={h.citaARegistrar} nombrePaciente={nombre} onClose={() => h.setCitaARegistrar(null)} onCreada={h.onAtencionCreada} />}
      {h.recetaModal && h.atencion && <EmitirRecetaModal atencion={h.atencion} tipoDocumento={h.recetaModal} onClose={() => h.setRecetaModal(null)} />}
      {h.revisarDictado && h.propuestaDictado && (
        <RevisarDictadoDialog
          propuesta={h.propuestaDictado}
          actuales={{
            subjetivo: h.evolucion.subjetivo, objetivo: h.evolucion.objetivo, apreciacion: h.evolucion.apreciacion,
            plan: h.evolucion.plan, observacion: h.evolucion.texto, procedimiento: h.procedimientos.detalle,
          }}
          transcripcion={h.consulta.transcripcion}
          onTranscripcion={h.consulta.cambiarTranscripcion}
          onAplicar={h.aplicarDictado}
          onLimpiar={() => h.limpiarDictadoMut.mutate()}
          onDiagnostico={(d) => { h.usarDiagnosticoDictado(d); h.setTab('evolucion'); }}
          onLesion={h.usarLesionDictada}
          onClose={h.cerrarRevisionDictado}
          guardando={h.guardandoDictado}
        />
      )}
    </div>
  );
}

type H = ReturnType<typeof useHistoriaClinicaPage>;

/** Visita del sistema anterior (Genexis): archivo congelado, se muestra tal cual quedó, sin editar. */
function VisitaGenexisCard({ visita }: { visita: HistorialGenexisRegistro | null }) {
  if (!visita) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low/40 p-5 space-y-3" data-testid="visita-genexis-detalle">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="material-symbols-outlined text-on-surface-variant text-2xl">inventory_2</span>
        <div className="min-w-0 flex-1">
          <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{fmtFecha(visita.fechaCita)}{visita.horaCita ? ` · ${visita.horaCita} h` : ''}</h3>
          <p className="text-sm text-on-surface">{visita.servicio ?? 'Visita'}</p>
          <p className="text-xs text-on-surface-variant">{visita.podologo ?? 'Profesional no registrado'}{visita.sede ? ` · ${visita.sede}` : ''}{visita.consultorio ? ` · ${visita.consultorio}` : ''}</p>
        </div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-surface-container text-on-surface-variant">Sistema anterior</span>
      </div>
      <p className="text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2 flex items-start gap-2">
        <span className="material-symbols-outlined text-base">lock</span>
        <span>Visita registrada en Genexis, el sistema anterior de la clínica. Es un archivo: se lee tal cual quedó y no se puede editar ni completar. Lo nuevo se registra en una atención de esta historia.</span>
      </p>
      {visita.obsPodologo && <div><p className={LBL}>Observaciones del profesional</p><p className="text-sm text-on-surface whitespace-pre-wrap break-words">{visita.obsPodologo}</p></div>}
      {visita.obsPaciente && <div><p className={LBL}>Observaciones de recepción</p><p className="text-sm text-on-surface whitespace-pre-wrap break-words">{visita.obsPaciente}</p></div>}
      {!visita.obsPodologo && !visita.obsPaciente && <p className="text-sm text-on-surface-variant">Esta visita no tiene observaciones registradas.</p>}
      {(visita.fechaCreacionGx || visita.usuarioCreacionGx) && <p className="text-[11px] text-on-surface-variant/70">Registrado{visita.fechaCreacionGx ? ` el ${visita.fechaCreacionGx}` : ''}{visita.usuarioCreacionGx ? ` por ${visita.usuarioCreacionGx}` : ''}</p>}
    </div>
  );
}

function CabeceraAtencion({ h, a }: { h: H; a: AtencionCompleta }) {
  // Resumen para el paciente (4.4): se puede ver siempre, también con la atención ya cerrada.
  const [verResumen, setVerResumen] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);
  // Fotos tomadas sin guardar: al cerrar ya no se pueden subir, así que van primero en la lista.
  const sinGuardar = [
    ...(h.fotosSinGuardar ? [`${h.fotosSinGuardar} foto${h.fotosSinGuardar === 1 ? '' : 's'} sin guardar (pestaña Fotos): al cerrar ya no se podrán guardar`] : []),
    // Lo dictado está guardado, pero si no se repartió a los campos no queda en la nota.
    ...(h.dictadoSinAplicar ? ['Dictado sin repartir a los campos: toca «Revisar lo dictado» antes de cerrar'] : []),
  ];
  // Cierre inteligente (misma regla y textos que la Bandeja clínica): avisa, no bloquea.
  const faltantes = [...sinGuardar, ...faltantesAtencion(a)];
  const cerrada = a.estado === 'cerrada';
  const invalidarControles = useInvalidarControles();
  // Siempre pasa por el diálogo: además de lo que falta, propone los próximos controles (4.1).
  const cerrar = () => setConfirmarCierre(true);
  const controles = (a.controles ?? []).filter((x) => x.estado !== 'descartado');
  return (
    <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5 mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-headline-sm text-headline-sm font-bold text-on-surface">{fmtFecha(a.fecha)} · {a.cita.horaInicio}</span>
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold text-white" style={{ background: a.servicio.color }}>{a.servicio.nombre}</span>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${cerrada ? 'bg-surface-container text-on-surface-variant' : 'bg-emerald-100 text-emerald-700'}`}>{cerrada ? 'Cerrada' : 'Abierta'}</span>
        </div>
        <p className="text-sm text-on-surface-variant mt-1"><b className="text-on-surface">{nombreProfesional(a.profesional)}</b> · {a.sede.nombre}{a.abiertaEtiqueta ? ` · registrada por ${a.abiertaEtiqueta}` : ''}</p>
        <p className="text-sm mt-2"><span className={LBL}>Motivo de consulta</span>{a.motivoConsulta}</p>
        {controles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2" data-testid="controles-atencion">
            {controles.map((x) => (
              <span key={x.id} className={`text-[11px] px-2 py-0.5 rounded-md border ${x.estado === 'agendado' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-primary/30 bg-primary/5 text-primary'}`} title={x.motivo}>
                <span className="material-symbols-outlined text-xs align-middle mr-0.5">event_repeat</span>Control {fmtFecha(x.fechaSugerida)} · {ORIGEN_CONTROL_LABEL[x.origen]}{x.estado === 'agendado' ? ' · agendado' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setVerResumen(true)} data-testid="abrir-resumen-paciente"
          className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5">
          <span className="material-symbols-outlined text-base">summarize</span>Resumen para el paciente
        </button>
      </div>
      {verResumen && <ResumenPacienteDialog atencionId={a.id} puedeRegistrar={h.puedeRegistrar} onClose={() => setVerResumen(false)} />}
      {h.puedeRegistrar && (
        !cerrada
          ? (
            <div className="flex flex-col items-end gap-1">
              <button onClick={cerrar} disabled={h.cerrarMut.isPending} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5"><span className="material-symbols-outlined text-base">lock</span>Cerrar atención</button>
              {faltantes.length > 0
                ? <span className="text-[11px] text-amber-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm">warning</span>{faltantes.length} pendiente{faltantes.length === 1 ? '' : 's'} antes de cerrar</span>
                : <span className="text-[11px] text-emerald-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm">task_alt</span>Historia completa</span>}
            </div>
          )
          : h.puedeReabrir
            ? <button onClick={() => { if (window.confirm('¿Reabrir esta atención para corregirla? Al terminar vuelve a cerrarla.')) h.reabrirMut.mutate(); }} disabled={h.reabrirMut.isPending} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5"><span className="material-symbols-outlined text-base">lock_open</span>Reabrir para corregir</button>
            : null
      )}

      {/* Cerrada = solo lectura: se explica qué se puede hacer y cómo corregir */}
      {cerrada && (
        <div className="basis-full rounded-xl bg-surface-container-low/70 border border-outline-variant/30 px-4 py-2.5 text-xs text-on-surface-variant flex items-start gap-2" data-testid="aviso-cerrada">
          <span className="material-symbols-outlined text-base">lock</span>
          <span>
            <b className="text-on-surface">Atención cerrada: solo lectura.</b> Puedes agregar una observación tardía, ver e imprimir sus recetas y sus consentimientos.
            {h.puedeReabrir
              ? ' Para corregir algo, toca «Reabrir para corregir».'
              : h.puedeRegistrar ? ` Pasaron más de ${h.horasReabrir} horas desde el cierre: para corregirla, pide a coordinación que la reabra.` : ''}
          </span>
        </div>
      )}

      {/* Dictado de toda la consulta por palabras clave (visible en todas las pestañas) */}
      {h.puedeRegistrar && !cerrada && (
        <BarraDictadoConsulta consulta={h.consulta} tab={h.tab} irA={h.setTab} onRevisar={h.abrirRevisionDictado} sinAplicar={h.dictadoSinAplicar} guardando={h.guardandoDictado} />
      )}

      {/* Cierre inteligente: lista lo que falta (aviso, no bloqueo) y propone los próximos controles */}
      {confirmarCierre && (
        <DialogoCierreAtencion a={a} faltantes={faltantes} pending={h.cerrarMut.isPending} onClose={() => setConfirmarCierre(false)}
          onCerrar={(ctrls) => h.cerrarMut.mutate(ctrls, { onSuccess: () => { setConfirmarCierre(false); invalidarControles(); } })} />
      )}
    </div>
  );
}

function PanelEvolucion({ h, a }: { h: H; a: AtencionCompleta }) {
  const e = h.evolucion; // vive en la página: el borrador sobrevive al cambio de pestaña
  const dictado = h.dictado; // dictado por voz en los campos de la nota (1.6)
  const c = h.consulta; // dictado de toda la consulta: resalta el campo que está recibiendo texto
  const escribeEn = (s: SeccionDictado | SeccionDictado[]) => c.activo && (Array.isArray(s) ? s.includes(c.seccion) : c.seccion === s);
  const [confirmarDx, setConfirmarDx] = useState<string | null>(null);
  const [confirmarNota, setConfirmarNota] = useState<string | null>(null);
  const [plantillasAbierto, setPlantillasAbierto] = useState(false);
  const [catalogoAbierto, setCatalogoAbierto] = useState(false);
  // Cerrada = solo lectura (misma regla que el servidor): diagnósticos y notas ya no se tocan.
  const editable = h.puedeRegistrar && !e.cerrada;
  return (
    <div className="space-y-6">
      {/* Diagnósticos */}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center"><span className="material-symbols-outlined mr-2 text-primary">diagnosis</span>Diagnósticos</h3>
          <div className="flex items-center gap-3">
            {h.gestionaPlantillas && <button onClick={() => setCatalogoAbierto(true)} title="Agregar los códigos CIE-10 que falten o desactivar los que no se usan" className="min-h-[44px] lg:min-h-0 text-on-surface-variant text-xs font-semibold hover:text-primary hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-base">menu_book</span>Catálogo CIE-10</button>}
            {editable && e.tieneDxAnteriores && <button onClick={e.copiarDxAnteriores} disabled={e.copiandoDx} className="min-h-[44px] lg:min-h-0 text-primary text-xs font-semibold hover:underline flex items-center gap-1 disabled:opacity-50"><span className="material-symbols-outlined text-base">content_copy</span>{e.copiandoDx ? 'Copiando…' : 'Copiar los de la visita anterior'}</button>}
          </div>
        </div>
        {a.diagnosticos.length === 0 && <p className="text-sm text-on-surface-variant mb-3">Sin diagnósticos registrados.{editable ? ' Busca abajo por nombre o código CIE-10 y toca «Agregar».' : ''}</p>}
        <div className="space-y-1.5 mb-3">
          {a.diagnosticos.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-outline-variant/20 px-3 py-2">
              <span className="font-mono-label text-mono-label font-bold text-primary w-14">{d.cie10Codigo}</span>
              <span className="text-sm text-on-surface flex-1 min-w-0 truncate">{d.cie10.descripcion}{d.observacion ? <span className="text-on-surface-variant"> · {d.observacion}</span> : null}</span>
              {editable ? (
                <select value={d.tipo} onChange={(ev) => e.editarDxMut.mutate({ id: d.id, data: { tipo: ev.target.value as 'presuntivo' | 'definitivo' } })} className="min-h-[44px] lg:min-h-0 text-sm lg:text-xs bg-surface-container-low border border-outline-variant/40 rounded-md px-1.5 py-1">
                  <option value="presuntivo">Presuntivo</option><option value="definitivo">Definitivo</option>
                </select>
              ) : <span className="text-xs text-on-surface-variant capitalize">{d.tipo}</span>}
              <button disabled={!editable} onClick={() => e.editarDxMut.mutate({ id: d.id, data: { principal: !d.principal } })} className={`min-h-[44px] lg:min-h-0 text-[11px] lg:text-[10px] font-bold uppercase px-2 py-0.5 rounded ${d.principal ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'}`}>{d.principal ? 'Principal' : 'Secundario'}</button>
              {editable && <button onClick={() => setConfirmarDx(d.id)} aria-label="Quitar diagnóstico" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
            </div>
          ))}
        </div>
        {editable && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_auto] gap-2 items-end">
            <div>
              <label className={LBL}>Agregar diagnóstico</label>
              {e.dxSel ? (
                <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/30 px-3 py-2 text-sm"><b className="text-primary">{e.dxSel.codigo}</b><span className="truncate flex-1">{e.dxSel.descripcion}</span><button onClick={() => e.setDxSel(null)} className="material-symbols-outlined text-base">close</button></div>
              ) : (
                <BuscadorCie10 consulta={h.dxDictado} onSeleccionar={(cie) => {
                  const d = h.dxDictado;
                  h.limpiarDxDictado();
                  // Dictado en curso ("diagnóstico definitivo onicomicosis" → tocar el resultado): un solo toque lo agrega.
                  if (d && c.activo) { e.agregarDxMut.mutate({ cie10Codigo: cie.codigo, tipo: d.tipo ?? e.dxTipo, principal: d.principal ?? e.dxPrincipal, observacion: null }); return; }
                  e.setDxSel(cie);
                  if (d?.tipo) e.setDxTipo(d.tipo);
                  if (d?.principal !== undefined) e.setDxPrincipal(d.principal);
                }} />
              )}
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
                  {editable && <button onClick={() => e.cargarNota(n)} className="min-h-[44px] lg:min-h-0 px-2 text-primary font-semibold hover:underline">Editar</button>}
                  {editable && h.puedeAnular && <button onClick={() => setConfirmarNota(n.id)} className="min-h-[44px] lg:min-h-0 px-2 text-rose-600 font-semibold hover:underline">Eliminar</button>}
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
            {e.cerrada && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">Atención cerrada: aquí solo se agrega una <b>observación tardía</b> (queda con fecha y hora de hoy).</p>}
            {!e.cerrada && (e.plantillas.length > 0 || h.gestionaPlantillas) && (
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[220px] max-w-md"><label className={LBL}>Plantilla por diagnóstico</label>
                  <select value="" onChange={(ev) => { if (ev.target.value) e.aplicarPlantilla(ev.target.value); }} disabled={e.plantillas.length === 0} className={INPUT}>
                    <option value="">{e.plantillas.length ? 'Aplicar plantilla… (rellena solo los campos vacíos)' : 'Sin plantillas todavía'}</option>
                    {e.plantillasSugeridas.length > 0 && <optgroup label="Según los diagnósticos de hoy">{e.plantillasSugeridas.map((pl) => <option key={pl.id} value={pl.id}>{pl.clave ? `${pl.clave} · ` : ''}{pl.nombre}</option>)}</optgroup>}
                    <optgroup label="Todas">{e.plantillas.map((pl) => <option key={pl.id} value={pl.id}>{pl.clave ? `${pl.clave} · ` : ''}{pl.nombre}</option>)}</optgroup>
                  </select>
                </div>
                {h.gestionaPlantillas && <button onClick={() => setPlantillasAbierto(true)} className="min-h-[44px] lg:min-h-0 px-3 py-2 border border-outline-variant rounded-xl text-xs font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">library_books</span>Plantillas y autotextos</button>}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {!e.cerrada && (
                <div><label className={LBL}>Tipo de nota</label>
                  <select value={e.tipo} onChange={(ev) => e.setTipo(ev.target.value as TipoNota)} className={INPUT}>
                    {(Object.keys(TIPO_NOTA_LABEL) as TipoNota[]).map((t) => <option key={t} value={t}>{TIPO_NOTA_LABEL[t]}</option>)}
                  </select>
                </div>
              )}
              {/* Una sola opción: se muestra como texto (quien atendió), no como lista desplegable */}
              <div><label className={LBL}>A nombre de</label>
                <p className="px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface bg-surface-container-low/60 rounded-lg">{e.profesionalId && e.profesionalId !== a.profesionalId ? 'Profesional de la nota' : nombreProfesional(a.profesional)} <span className="text-on-surface-variant text-xs">(atendió)</span></p>
              </div>
            </div>
            {e.tipo === 'observacion' ? (
              <TextareaDictado label="Observación" campo="texto" valor={e.texto} setValor={e.setTexto} dictado={dictado} rows={3} resaltar={escribeEn('observacion')} labelClass={LBL} inputClass={INPUT} />
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <TextareaDictado label="Subjetivo · lo que cuenta el paciente" campo="subjetivo" valor={e.subjetivo} setValor={e.setSubjetivo} dictado={dictado} placeholder="Lo que refiere el paciente" resaltar={escribeEn('subjetivo')} labelClass={LBL} inputClass={INPUT} />
                  <TextareaDictado label="Objetivo · lo que observas" campo="objetivo" valor={e.objetivo} setValor={e.setObjetivo} dictado={dictado} placeholder="Examen físico, hallazgos" resaltar={escribeEn('objetivo')} labelClass={LBL} inputClass={INPUT} />
                  <TextareaDictado label="Apreciación · tu análisis" campo="apreciacion" valor={e.apreciacion} setValor={e.setApreciacion} dictado={dictado} placeholder="Análisis / impresión clínica" resaltar={escribeEn('apreciacion')} labelClass={LBL} inputClass={INPUT} />
                  <TextareaDictado label="Plan · qué se hará" campo="plan" valor={e.plan} setValor={e.setPlan} dictado={dictado} placeholder="Tratamiento, indicaciones, control" resaltar={escribeEn(['plan', 'indicaciones'])} labelClass={LBL} inputClass={INPUT} />
                </div>
                <TextareaDictado label="Observaciones" campo="texto" valor={e.texto} setValor={e.setTexto} dictado={dictado} rows={2} placeholder="Notas adicionales (opcional)" resaltar={escribeEn('observacion')} labelClass={LBL} inputClass={INPUT} />
              </>
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
      {plantillasAbierto && <PlantillasDialog onClose={() => setPlantillasAbierto(false)} />}
      {catalogoAbierto && <CatalogoCie10Dialog onClose={() => setCatalogoAbierto(false)} />}
      {confirmarDx && <DialogoMotivo titulo="Eliminar diagnóstico" descripcion="Se quita de la atención; el motivo queda en la auditoría." confirmar="Eliminar" pending={e.eliminarDxMut.isPending} onConfirmar={(m) => { e.eliminarDxMut.mutate({ id: confirmarDx, motivo: m }); setConfirmarDx(null); }} onClose={() => setConfirmarDx(null)} />}
      {confirmarNota && <DialogoMotivo titulo="Eliminar nota" descripcion="La nota deja de verse en la historia (queda en el historial interno); el motivo queda en la auditoría." confirmar="Eliminar" pending={e.eliminarNotaMut.isPending} onConfirmar={(m) => { e.eliminarNotaMut.mutate({ notaId: confirmarNota, motivo: m }); setConfirmarNota(null); }} onClose={() => setConfirmarNota(null)} />}
    </div>
  );
}

// 7.6 · Copia completa de la historia en PDF (se abre en otra pestaña; la descarga queda auditada).
function BotonPdfHistoria({ pacienteId }: { pacienteId: string }) {
  const [conFotos, setConFotos] = useState(false);
  const [generando, setGenerando] = useState(false);
  const abrir = async () => {
    setGenerando(true);
    try {
      const url = URL.createObjectURL(await historiaClinicaApi.descargarHistoriaPdf(pacienteId, conFotos));
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerando(false);
    }
  };
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-lg px-3 py-2 text-xs bg-surface-container-low/60" data-testid="pdf-historia">
      <button onClick={abrir} disabled={generando} className="flex items-center gap-1 text-primary font-semibold hover:underline disabled:opacity-50">
        <span className="material-symbols-outlined text-base">picture_as_pdf</span>{generando ? 'Generando…' : 'PDF de la historia completa'}
      </button>
      <label className="ml-auto flex items-center gap-1 text-on-surface-variant cursor-pointer">
        <input type="checkbox" checked={conFotos} onChange={(e) => setConFotos(e.target.checked)} />con fotos
      </label>
    </div>
  );
}

function PanelReceta({ h, a }: { h: H; a: AtencionCompleta }) {
  const r = useRecetasAtencion(a);
  const cerrada = a.estado === 'cerrada';
  return (
    <div className="space-y-4">
      {cerrada ? (
        <p className="text-xs text-on-surface-variant bg-surface-container-low/60 rounded-lg px-3 py-2">Atención cerrada: las recetas e indicaciones ya emitidas se pueden ver, imprimir o anular. Para emitir una nueva, reabre la atención.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {h.esMedicoPrescriptor && <button onClick={() => h.setRecetaModal('RECETA_MEDICA')} className="min-h-[44px] lg:min-h-0 px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:opacity-90 flex items-center gap-2"><span className="material-symbols-outlined text-base">prescriptions</span>Emitir receta médica</button>}
          {h.puedeRegistrar && <button onClick={() => h.setRecetaModal('INDICACIONES_PODOLOGICAS')} className="min-h-[44px] lg:min-h-0 px-5 py-2.5 border border-primary/40 text-primary bg-primary/5 rounded-xl text-sm font-bold hover:bg-primary/10 flex items-center gap-2"><span className="material-symbols-outlined text-base">clinical_notes</span>Indicaciones podológicas</button>}
          {!h.esMedicoPrescriptor && h.usuario?.rol === 'medico' && <p className="text-xs text-amber-700 self-center">Para emitir recetas tu ficha de médico necesita la colegiatura (CMP) cargada.</p>}
        </div>
      )}
      {r.recetas.length === 0 ? (
        <div className="text-center py-12 text-on-surface-variant border border-dashed border-outline-variant/40 rounded-2xl"><span className="material-symbols-outlined text-4xl mb-1">prescriptions</span><p className="text-sm">Sin recetas ni indicaciones en esta atención.{!cerrada && h.puedeRegistrar ? ' Usa los botones de arriba para emitir una.' : ''}</p></div>
      ) : (
        <div className="space-y-2">
          {r.recetas.map((x) => (
            <div key={x.id} className={`rounded-2xl border px-5 py-3 flex flex-wrap items-center gap-3 ${x.estado === 'anulada' ? 'border-rose-200 bg-rose-50/40' : 'border-outline-variant/30 bg-surface-container-lowest'}`}>
              <span className="material-symbols-outlined text-primary">{x.tipoDocumento === 'RECETA_MEDICA' ? 'prescriptions' : 'clinical_notes'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-on-surface">{TIPO_DOC_LABEL[x.tipoDocumento]} N° {String(x.numero).padStart(6, '0')} {x.estado === 'anulada' && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Anulada</span>}</div>
                <div className="text-[11px] text-on-surface-variant">{fmtFechaHora(x.fechaEmision)} · {x.emisorNombre} · {x._count.items} ítem(s) · verificación {x.codigoVerificacion}</div>
              </div>
              <button onClick={() => r.ver(x.id)} className="min-h-[44px] lg:min-h-0 px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver</button>
              <button onClick={() => r.imprimir(x.id)} className="min-h-[44px] lg:min-h-0 px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold hover:bg-surface-container-high flex items-center gap-1"><span className="material-symbols-outlined text-base">print</span>Imprimir</button>
              {r.puedeAnular(x) && <button onClick={() => r.setAnulando(x.id)} className="min-h-[44px] lg:min-h-0 px-3 py-1.5 text-rose-600 text-xs font-semibold hover:underline">Anular</button>}
            </div>
          ))}
        </div>
      )}
      {r.anulando && <DialogoMotivo titulo="Anular documento" descripcion="El documento queda anulado (no se borra) y su PDF sale con marca de agua." confirmar="Anular" pending={r.anularMut.isPending} onConfirmar={(m) => r.anularMut.mutate({ id: r.anulando!, motivo: m })} onClose={() => r.setAnulando(null)} />}
      {/* Constancias y descansos médicos (5.4): se emiten aunque la atención esté cerrada (son papeles para el paciente) */}
      <ConstanciasSection a={a} puedeRegistrar={h.puedeRegistrar} esMedicoPrescriptor={h.esMedicoPrescriptor} />
    </div>
  );
}

function PanelAntecedentes({ h }: { h: H }) {
  const f = useAntecedentesAlergias(h.pacienteId);
  const alergias = h.historia?.alergias ?? [];
  const antecedentes = h.historia?.antecedentes ?? [];
  const SEV: Record<SeveridadAlergia, string> = { leve: 'bg-amber-100 text-amber-800', moderada: 'bg-orange-100 text-orange-800', severa: 'bg-rose-100 text-rose-800' };
  const quitar = useConfirmarQuitar();
  return (
    <div className="grid grid-cols-1 gap-6">
      {quitar.dialogo}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-error">warning</span>Alergias y reacciones a medicamentos</h3>
        {alergias.length === 0 && <p className="text-sm text-on-surface-variant mb-3">Ninguna registrada.</p>}
        <div className="space-y-1.5 mb-4">
          {alergias.map((x) => (
            <div key={x.id} className={`flex items-center gap-2 rounded-xl border border-outline-variant/20 px-3 py-2 ${!x.activa ? 'opacity-50' : ''}`}>
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEV[x.severidad]}`}>{x.severidad}</span>
              <span className="text-sm font-semibold text-on-surface">{x.sustancia}</span>
              {x.reaccion && <span className="text-xs text-on-surface-variant">· {x.reaccion}</span>}
              <span className="flex-1" />
              {h.puedeRegistrar && <button onClick={() => f.toggleAlergiaMut.mutate({ id: x.id, activa: !x.activa })} className="min-h-[44px] lg:min-h-0 px-2 text-xs text-primary font-semibold hover:underline">{x.activa ? 'Desactivar' : 'Activar'}</button>}
              {h.puedeAnular && <button onClick={() => quitar.pedir(`¿Quitar la alergia «${x.sustancia}»?`, 'Deja de verse en la historia y en las recetas (queda registro interno).', () => f.eliminarAlergiaMut.mutate(x.id))} aria-label="Quitar alergia" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
            </div>
          ))}
        </div>
        {h.puedeRegistrar && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2 items-end">
            <div><label className={LBL}>Sustancia</label><input value={f.sustancia} onChange={(e) => f.setSustancia(e.target.value)} maxLength={200} placeholder="Ej. Penicilina" className={INPUT} /></div>
            <div><label className={LBL}>Reacción</label><input value={f.reaccion} onChange={(e) => f.setReaccion(e.target.value)} maxLength={500} placeholder="Ej. Erupción" className={INPUT} /></div>
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
              {h.puedeRegistrar && <button onClick={() => f.toggleAntecedenteMut.mutate({ id: x.id, activo: !x.activo })} className="min-h-[44px] lg:min-h-0 px-2 text-xs text-primary font-semibold hover:underline">{x.activo ? 'Desactivar' : 'Activar'}</button>}
              {h.puedeAnular && <button onClick={() => quitar.pedir('¿Quitar este antecedente?', 'Deja de verse en la historia (queda registro interno).', () => f.eliminarAntecedenteMut.mutate(x.id))} aria-label="Quitar antecedente" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
            </div>
          ))}
        </div>
        {h.puedeRegistrar && (
          <div className="grid grid-cols-1 md:grid-cols-[150px_1fr_auto] gap-2 items-end">
            <div><label className={LBL}>Tipo</label><select value={f.antTipo} onChange={(e) => f.setAntTipo(e.target.value as TipoAntecedente)} className={INPUT}>{(Object.keys(TIPO_ANTECEDENTE_LABEL) as TipoAntecedente[]).map((t) => <option key={t} value={t}>{TIPO_ANTECEDENTE_LABEL[t]}</option>)}</select></div>
            <div><label className={LBL}>Descripción</label><input value={f.antDesc} onChange={(e) => f.setAntDesc(e.target.value)} maxLength={1000} placeholder="Ej. Diabetes mellitus tipo 2 (2019)" className={INPUT} onKeyDown={(e) => { if (e.key === 'Enter' && f.puedeGuardarAntecedente) f.antecedenteMut.mutate(); }} /></div>
            <button disabled={!f.puedeGuardarAntecedente || f.antecedenteMut.isPending} onClick={() => f.antecedenteMut.mutate()} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Agregar</button>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Bloque 3 · Procedimientos ───────────────────────────────────────────────
function PanelProcedimientos({ h, a }: { h: H; a: AtencionCompleta }) {
  const p = h.procedimientos; // vive en la página: el borrador sobrevive al cambio de pestaña
  const dictadoProc = h.dictado; // dictado por voz en el detalle del procedimiento
  const quitar = useConfirmarQuitar();
  const editable = h.puedeRegistrar && !p.cerrada;
  return (
    <div className="space-y-5">
      {quitar.dialogo}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-primary">medical_services</span>Procedimientos realizados</h3>
        {p.procedimientos.length === 0 && <p className="text-sm text-on-surface-variant">Ninguno registrado en esta atención.{editable ? ' Si hiciste un tratamiento, regístralo abajo.' : ''}</p>}
        <div className="space-y-2">
          {p.procedimientos.map((x) => (
            <div key={x.id} className="rounded-xl border border-outline-variant/20 px-4 py-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-on-surface">{TIPO_PROCEDIMIENTO_LABEL[x.tipo]}{x.nombre && x.nombre !== TIPO_PROCEDIMIENTO_LABEL[x.tipo] ? ` · ${x.nombre}` : ''}</span>
                {x.pie && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">{PIE_LABEL[x.pie]}</span>}
                {x.ubicacion && <span className="text-xs text-on-surface-variant">{x.ubicacion}</span>}
                {x.sesionNumero != null && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Sesión {x.sesionNumero}{x.sesionesTotales ? ` / ${x.sesionesTotales}` : ''}</span>}
                <span className="flex-1" />
                {editable && <button onClick={() => quitar.pedir(`¿Quitar el procedimiento «${TIPO_PROCEDIMIENTO_LABEL[x.tipo]}»?`, 'Se quita de la atención (queda registro interno).', () => p.eliminarMut.mutate(x.id))} aria-label="Quitar procedimiento" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
              </div>
              {x.detalle && <p className="text-sm text-on-surface mt-1">{x.detalle}</p>}
              {x.anestesia && <p className="text-xs text-on-surface-variant mt-0.5">Anestesia: {x.anestesia}</p>}
              {x.parametros && Object.keys(x.parametros).length > 0 && (
                <p className="text-xs text-on-surface-variant mt-0.5">{Object.entries(x.parametros).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
              )}
              {x.registradoEtiqueta && <p className="text-[11px] text-on-surface-variant/70 mt-1">Registró: {x.registradoEtiqueta}</p>}
            </div>
          ))}
        </div>
      </section>

      {h.puedeRegistrar && !p.cerrada && (
        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
          <h4 className="text-sm font-semibold text-on-surface mb-3">Registrar procedimiento</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className={LBL}>Tipo</label>
              <select value={p.tipo} onChange={(e) => p.setTipo(e.target.value as TipoProcedimiento | '')} className={INPUT}>
                <option value="">Selecciona…</option>
                {(Object.keys(TIPO_PROCEDIMIENTO_LABEL) as TipoProcedimiento[]).map((t) => <option key={t} value={t}>{TIPO_PROCEDIMIENTO_LABEL[t]}</option>)}
              </select>
            </div>
            <div><label className={LBL}>Lado</label>
              <select value={p.pie} onChange={(e) => p.setPie(e.target.value as never)} className={INPUT}>
                <option value="">—</option><option value="izquierdo">Izquierdo</option><option value="derecho">Derecho</option><option value="ambos">Ambos</option>
              </select>
            </div>
            <div><label className={LBL}>Ubicación</label><input value={p.ubicacion} onChange={(e) => p.setUbicacion(e.target.value)} maxLength={200} placeholder="Ej. 1er ortejo, borde lateral" className={INPUT} /></div>
          </div>
          <div className="mt-3"><TextareaDictado label="Detalle" campo="detalle-proc" valor={p.detalle} setValor={p.setDetalle} dictado={dictadoProc} rows={2} maxLength={2000} placeholder="Descripción del procedimiento" resaltar={h.consulta.activo && h.consulta.seccion === 'procedimiento'} labelClass={LBL} inputClass={INPUT} /></div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div><label className={LBL}>Anestesia</label><input value={p.anestesia} onChange={(e) => p.setAnestesia(e.target.value)} maxLength={200} placeholder="Ej. Lidocaína 2% troncular" className={INPUT} /></div>
          </div>

          {p.esLaser && (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-sm">cardiology</span>Láser: parámetros y membresía</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><label className={LBL}>Longitud de onda</label><input value={p.laserLongitud} onChange={(e) => p.setLaserLongitud(e.target.value)} placeholder="Ej. 1064 nm" className={INPUT} /></div>
                <div><label className={LBL}>Energía</label><input value={p.laserEnergia} onChange={(e) => p.setLaserEnergia(e.target.value)} placeholder="Ej. 8 J/cm²" className={INPUT} /></div>
                <div><label className={LBL}>Disparos / notas</label><input value={p.laserDisparos} onChange={(e) => p.setLaserDisparos(e.target.value)} placeholder="Ej. 200 disparos" className={INPUT} /></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div><label className={LBL}>Membresía / paquete</label>
                  <select value={p.paqueteId} onChange={(e) => p.elegirPaquete(e.target.value)} className={INPUT}>
                    <option value="">Sin membresía</option>
                    {p.paquetes.map((q) => <option key={q.id} value={q.id}>{q.nombre} · {q.sesionesRestantes}/{q.sesionesTotal} disponibles</option>)}
                  </select>
                </div>
                <div><label className={LBL}>N.º de sesión</label><input value={p.sesionNumero} onChange={(e) => p.setSesionNumero(e.target.value.replace(/\D/g, '').slice(0, 3))} type="text" inputMode="numeric" placeholder="—" className={INPUT} /></div>
              </div>
              {p.paquetes.length === 0 && <p className="text-[11px] text-on-surface-variant mt-2">Este paciente no tiene membresías de láser activas.</p>}
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button disabled={!p.puedeGuardar || p.agregarMut.isPending} onClick={() => p.agregarMut.mutate()} className="px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Registrar procedimiento</button>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Bloque 3 · Escalas clínicas ─────────────────────────────────────────────
function PanelEscalas({ h, a }: { h: H; a: AtencionCompleta }) {
  const e = useEscalas(a, h.puedeRegistrar);
  const quitar = useConfirmarQuitar();
  const editable = h.puedeRegistrar && !e.cerrada;
  return (
    <div className="space-y-5">
      {quitar.dialogo}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-primary">monitor_heart</span>Escalas registradas</h3>
        {e.escalas.length === 0 && <p className="text-sm text-on-surface-variant">Ninguna registrada en esta atención.{editable ? ' Elige una escala abajo para aplicarla.' : ''}</p>}
        <div className="space-y-2">
          {e.escalas.map((x) => (
            <div key={x.id} className="flex items-center gap-3 rounded-xl border border-outline-variant/20 px-4 py-2.5">
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary shrink-0">{TIPO_ESCALA_LABEL[x.tipo]}</span>
              <span className="text-sm font-semibold text-on-surface flex-1">{x.resultado ?? '—'}</span>
              {x.tipo === 'monofilamento' && (
                <span className="flex gap-1 shrink-0" title="Verde = percibe · rojo = no percibe">
                  <MonofilamentoPie pie="izquierdo" valores={(x.datos.izquierdo as boolean[] | undefined) ?? []} compacto />
                  <MonofilamentoPie pie="derecho" valores={(x.datos.derecho as boolean[] | undefined) ?? []} compacto />
                </span>
              )}
              {x.registradoEtiqueta && <span className="text-[11px] text-on-surface-variant/70 hidden md:block">{x.registradoEtiqueta}</span>}
              {editable && <button onClick={() => quitar.pedir(`¿Quitar la escala «${TIPO_ESCALA_LABEL[x.tipo]}»?`, 'Se quita de la atención (queda registro interno).', () => e.eliminarMut.mutate(x.id))} aria-label="Quitar escala" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
            </div>
          ))}
        </div>
      </section>

      {e.seriesUlcera.length > 0 && (
        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-1"><span className="material-symbols-outlined mr-2 text-primary">show_chart</span>Evolución de úlceras</h3>
          <p className="text-xs text-on-surface-variant mb-3">Área (largo × ancho, cm²) por ubicación a lo largo de las visitas del paciente.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {e.seriesUlcera.map((sr) => {
              const primero = sr.puntos[0]!, ultimo = sr.puntos[sr.puntos.length - 1]!;
              const cambio = sr.puntos.length >= 2 && primero.area > 0 ? Math.round(((ultimo.area - primero.area) / primero.area) * 100) : null;
              return (
                <div key={sr.nombre} className="rounded-xl border border-outline-variant/20 p-3">
                  <p className="text-xs font-bold text-on-surface mb-1">{sr.nombre} · {sr.puntos.length} {sr.puntos.length === 1 ? 'medición' : 'mediciones'}
                    {cambio != null && <span className={`ml-2 font-semibold ${cambio < 0 ? 'text-emerald-700' : cambio > 0 ? 'text-rose-700' : 'text-on-surface-variant'}`}>{cambio > 0 ? '+' : ''}{cambio}% desde la primera</span>}
                  </p>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={sr.puntos.map((pt) => ({ ...pt, fecha: fmtFecha(pt.fecha) }))} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="fecha" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Line type="monotone" dataKey="area" name="Área (cm²)" stroke="#0044ab" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {h.puedeRegistrar && !e.cerrada && (
        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
          <h4 className="text-sm font-semibold text-on-surface mb-3">Aplicar escala</h4>
          <div className="max-w-xs mb-4"><label className={LBL}>Escala</label>
            <select value={e.tipo} onChange={(ev) => e.setTipo(ev.target.value as TipoEscala | '')} className={INPUT}>
              <option value="">Selecciona…</option>
              {(Object.keys(TIPO_ESCALA_LABEL) as TipoEscala[]).map((t) => <option key={t} value={t}>{TIPO_ESCALA_LABEL[t]}</option>)}
            </select>
          </div>

          {e.tipo === 'eva' && (
            <div className="mb-4">
              <label className={LBL}>Intensidad del dolor: <b className="text-primary text-sm">{e.eva}/10</b></label>
              <input type="range" min={0} max={10} value={e.eva} onChange={(ev) => e.setEva(Number(ev.target.value))} className="w-full accent-primary" />
              <div className="flex justify-between text-[10px] text-on-surface-variant"><span>Sin dolor</span><span>Máximo</span></div>
            </div>
          )}
          {e.tipo === 'wagner' && (
            <div className="mb-4 max-w-md"><label className={LBL}>Grado Wagner</label>
              <select value={e.wagner} onChange={(ev) => e.setWagner(Number(ev.target.value))} className={INPUT}>
                {['Piel intacta / sin lesión', 'Úlcera superficial', 'Úlcera profunda (tendón/cápsula)', 'Absceso u osteomielitis', 'Gangrena localizada', 'Gangrena extensa'].map((d, i) => <option key={i} value={i}>Grado {i} — {d}</option>)}
              </select>
            </div>
          )}
          {e.tipo === 'texas' && (
            <div className="mb-4 space-y-3">
              <div className="max-w-md"><label className={LBL}>Profundidad de la úlcera (grado)</label>
                <select value={e.texasGrado} onChange={(ev) => e.setTexasGrado(Number(ev.target.value))} className={INPUT}>
                  {['Pre/post-ulcerativa (piel intacta)', 'Superficial', 'Llega a tendón o cápsula', 'Llega a hueso o articulación'].map((d, i) => <option key={i} value={i}>{i} — {d}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm text-on-surface min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-outline-variant/40"><input type="checkbox" checked={e.texasInfeccion} onChange={(ev) => e.setTexasInfeccion(ev.target.checked)} className="accent-primary w-4 h-4" />Hay infección</label>
                <label className="flex items-center gap-2 text-sm text-on-surface min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border border-outline-variant/40"><input type="checkbox" checked={e.texasIsquemia} onChange={(ev) => e.setTexasIsquemia(ev.target.checked)} className="accent-primary w-4 h-4" />Hay isquemia</label>
              </div>
              <p className="text-sm"><span className={LBL}>Clasificación calculada</span><b className="text-primary text-base">Texas {e.texasGrado}-{e.texasEstadio}</b> <span className="text-on-surface-variant">· estadio {e.texasEstadio === 'A' ? 'sin infección ni isquemia' : e.texasEstadio === 'B' ? 'con infección' : e.texasEstadio === 'C' ? 'con isquemia' : 'con infección e isquemia'}</span></p>
            </div>
          )}
          {e.tipo === 'iwgdf' && (
            <div className="mb-4 space-y-3">
              <p className="text-xs text-on-surface-variant">Marca los factores presentes; la categoría y la frecuencia de control se calculan solas (IWGDF 2019).</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {([
                  ['psp', 'Pérdida de sensibilidad protectora (monofilamento alterado)'],
                  ['eap', 'Enfermedad arterial periférica (pulsos pedio / tibial ausentes)'],
                  ['deformidad', 'Deformidad del pie'],
                  ['ulceraPrevia', 'Úlcera previa'],
                  ['amputacion', 'Amputación previa'],
                  ['erc', 'Enfermedad renal terminal (diálisis)'],
                ] as const).map(([k, l]) => (
                  <label key={k} className={`flex items-center gap-2 text-sm text-on-surface min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl border ${e.iwgdfF[k] ? 'border-primary bg-primary/5' : 'border-outline-variant/40'}`}>
                    <input type="checkbox" checked={e.iwgdfF[k]} onChange={(ev) => e.setFactorIwgdf(k, ev.target.checked)} className="accent-primary w-4 h-4" />{l}
                    {k === 'psp' && e.pspSugerida && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 ml-auto">según monofilamento de hoy</span>}
                    {k === 'eap' && e.eapSugerida && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 ml-auto">según ITB / pulsos de hoy</span>}
                    {k === 'deformidad' && e.deformidadSugerida && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 ml-auto">según examen / Manchester de hoy</span>}
                  </label>
                ))}
              </div>
              <p className="text-sm"><span className={LBL}>Riesgo calculado</span>
                <b className={`text-base ${e.iwgdf >= 3 ? 'text-rose-700' : e.iwgdf === 2 ? 'text-amber-700' : e.iwgdf === 1 ? 'text-yellow-700' : 'text-emerald-700'}`}>Categoría {e.iwgdf} · {['Muy bajo', 'Bajo', 'Moderado', 'Alto'][e.iwgdf]}</b>
                <span className="text-on-surface-variant"> · {IWGDF_CONTROL[e.iwgdf]}</span>
              </p>
            </div>
          )}
          {e.tipo === 'termometria' && (
            <div className="mb-4 space-y-3">
              <p className="text-xs text-on-surface-variant">Temperatura (°C) en cada sitio de ambos pies. Una diferencia de 2 °C o más entre sitios equivalentes es señal temprana de preúlcera.</p>
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead><tr><th className="text-left pr-3 text-[10px] font-semibold uppercase text-on-surface-variant">Sitio</th>{MF_ETIQUETAS.map((s) => <th key={s} className="px-1 text-[10px] font-semibold uppercase text-on-surface-variant">{s}</th>)}</tr></thead>
                  <tbody>
                    {(['izq', 'der'] as const).map((lado) => (
                      <tr key={lado}>
                        <td className="pr-3 font-bold text-on-surface">{lado === 'izq' ? 'Izquierdo' : 'Derecho'}</td>
                        {(lado === 'izq' ? e.tempIzq : e.tempDer).map((v, i) => (
                          <td key={i} className="px-1 py-1"><input type="number" step="0.1" min={20} max={45} inputMode="decimal" value={v} onChange={(ev) => e.setTemp(lado, i, ev.target.value)} placeholder="°C" className={`${INPUT} w-20 text-center`} /></td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {e.termoDeltaMax != null && (
                <p className="text-sm"><span className={LBL}>Diferencia máxima entre pies</span>
                  <b className={`text-base ${e.termoDeltaMax >= 2 ? 'text-rose-700' : 'text-emerald-700'}`}>{e.termoDeltaMax.toFixed(1)} °C</b>
                  <span className="text-on-surface-variant">{e.termoDeltaMax >= 2 ? ' · alerta: posible preúlcera, revisar el sitio' : ' · sin diferencia significativa'}</span>
                </p>
              )}
            </div>
          )}
          {e.tipo === 'monofilamento' && (
            <div className="mb-4 space-y-3">
              <p className="text-xs text-on-surface-variant">Toca cada punto según lo que responde el paciente: <b className="text-emerald-700">verde = percibe</b>, <b className="text-rose-700">rojo = no percibe</b>. Sitios: {MF_ETIQUETAS.join(', ')}.{e.mfAnterior ? ' Los puntos con anillo ámbar cambiaron respecto de la visita anterior.' : ''}</p>
              <div className="flex gap-4 justify-center">
                <MonofilamentoPie pie="izquierdo" valores={e.mfIzq} anterior={e.mfAnterior?.izquierdo} onToggle={(i) => e.toggleMf('izq', i)} />
                <MonofilamentoPie pie="derecho" valores={e.mfDer} anterior={e.mfAnterior?.derecho} onToggle={(i) => e.toggleMf('der', i)} />
              </div>
              {e.mfAnterior && (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3">
                  <p className="text-xs font-semibold text-on-surface mb-2">Visita anterior · {fmtFecha(e.mfAnterior.fecha)} · Izq {e.mfAnterior.izquierdo.filter(Boolean).length}/{e.mfAnterior.izquierdo.length} · Der {e.mfAnterior.derecho.filter(Boolean).length}/{e.mfAnterior.derecho.length} percibidos</p>
                  <div className="flex gap-3 justify-center">
                    <MonofilamentoPie pie="izquierdo" valores={e.mfAnterior.izquierdo} compacto />
                    <MonofilamentoPie pie="derecho" valores={e.mfAnterior.derecho} compacto />
                  </div>
                </div>
              )}
            </div>
          )}
          {e.tipo === 'ulcera' && (
            <div className="mb-4 space-y-3">
              <p className="text-xs text-on-surface-variant">Mide la úlcera en cada visita (cm). El área se calcula como largo × ancho y se grafica por ubicación.</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div><label className={LBL}>Largo (cm)</label><input type="number" step="0.1" min={0} inputMode="decimal" value={e.ulLargo} onChange={(ev) => e.setUlLargo(ev.target.value)} className={INPUT} /></div>
                <div><label className={LBL}>Ancho (cm)</label><input type="number" step="0.1" min={0} inputMode="decimal" value={e.ulAncho} onChange={(ev) => e.setUlAncho(ev.target.value)} className={INPUT} /></div>
                <div><label className={LBL}>Profundidad (cm)</label><input type="number" step="0.1" min={0} inputMode="decimal" value={e.ulProf} onChange={(ev) => e.setUlProf(ev.target.value)} placeholder="Opcional" className={INPUT} /></div>
                <div><label className={LBL}>Lado</label>
                  <select value={e.ulPie} onChange={(ev) => e.setUlPie(ev.target.value as 'izquierdo' | 'derecho' | '')} className={INPUT}><option value="">—</option><option value="izquierdo">Izquierdo</option><option value="derecho">Derecho</option></select>
                </div>
                <div><label className={LBL}>Ubicación</label>
                  <input value={e.ulUbicacion} onChange={(ev) => e.setUlUbicacion(ev.target.value)} list="zonas-ulcera" placeholder="Ej. Talón" className={INPUT} />
                  <datalist id="zonas-ulcera">{ZONAS_PIE.map((z) => <option key={z.id} value={z.etiqueta} />)}</datalist>
                </div>
              </div>
              {e.ulArea != null && (
                <p className="text-sm"><span className={LBL}>Área calculada</span><b className="text-primary text-base">{e.ulArea} cm²</b>
                  {e.ulAnterior && (
                    <span className={`ml-2 ${e.ulArea < e.ulAnterior.area ? 'text-emerald-700' : e.ulArea > e.ulAnterior.area ? 'text-rose-700' : 'text-on-surface-variant'}`}>
                      · anterior {e.ulAnterior.area} cm² ({fmtFecha(e.ulAnterior.fecha)}){e.ulAnterior.area > 0 ? ` → ${e.ulArea > e.ulAnterior.area ? '+' : ''}${Math.round(((e.ulArea - e.ulAnterior.area) / e.ulAnterior.area) * 100)}%` : ''}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {e.tipo === 'itb' && <FormItb e={e} />}
          {e.tipo === 'osi' && <FormOsi e={e} />}
          {e.tipo === 'manchester' && <FormManchester e={e} />}
          {e.tipo === 'examen' && <FormExamenPie e={e} />}

          {e.tipo && (
            <div className="flex justify-end">
              <button disabled={!e.puedeGuardar || e.guardarMut.isPending} onClick={() => e.guardarMut.mutate()} className="px-5 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Registrar escala</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Bloque 3 · Podograma (mapa interactivo) ─────────────────────────────────
// Vista PLANTAR: las dos plantas se ven como en la foto original —dedos arriba, talón abajo y los dedos
// gordos hacia el centro— y cada pie se inclina unos 20° hacia afuera, pivotando en el talón, para que
// juntas se lean como una PISADA (utils/giroSilueta.ts). Como en esa foto el pie de la izquierda es el
// DERECHO del paciente, en la planta las dos columnas van en ese orden (derecho, izquierdo) y no se
// rotula el pie; en el dorso sí se rotula y no se inclina nada.
// La inclinación es solo de presentación: lo que se guarda son las coordenadas del pie sin inclinar, y
// el marco que mide los toques (`cajaRef`) NO se inclina; la capa de dentro sí.
function MapaPie({ pie, vista, marcas, pendiente, onClick, modo = 'punto', dibujo = [], pincel, visible, historial, onMoverMarca, onTocarMarca }: {
  pie: 'izquierdo' | 'derecho'; vista: VistaSilueta; marcas: MarcaPodograma[]; pendiente: { pie: string; vista: VistaSilueta; x: number; y: number } | null;
  onClick: (x: number, y: number) => void;
  modo?: ModoSilueta; dibujo?: AnotacionPodograma[];
  pincel?: { herramienta: 'lapiz' | 'borrador' | 'etiquetar'; color: string; grosor: number; onTrazo: (t: AnotacionPodograma) => void; onBorrar: (x: number, y: number, aspecto: number) => void; onSeleccionar: (x: number, y: number, aspecto: number) => void; seleccionado: number | null };
  /** Capas: si devuelve false, ese tipo de lesión no se muestra. */
  visible?: (tipo: TipoLesion | null | undefined) => boolean;
  /** Modo Historial: registros de todas las visitas en este pie y la zona elegida. */
  historial?: { eventos: EventoZona[]; atencionActual: string; zonaSel: { x: number; y: number } | null; onElegir: (x: number, y: number) => void };
  /** Modo Punto (editable): arrastrar un punto ya puesto lo mueve; tocarlo abre su edición. */
  onMoverMarca?: (id: string, x: number, y: number) => void;
  onTocarMarca?: (id: string) => void;
}) {
  const ver = visible ?? (() => true);
  // Solo las marcas de ESTA silueta (planta o dorso) y de las capas visibles; las antiguas sin vista son de la planta.
  const propias = marcas.filter((m) => m.pie === pie && (m.vista ?? 'plantar') === vista && ver(m.tipoLesion));
  const pintando = modo === 'pintar' && !!pincel;
  const enHistorial = modo === 'historial' && !!historial;
  const aspecto = proporcionSilueta(vista);
  const arrastrable = modo === 'punto' && !!onMoverMarca;
  const giro = giroSilueta(vista, pie);
  /** Marco recto de la caja del pie: mide los toques aunque lo de dentro esté inclinado. */
  const cajaRef = useRef<HTMLDivElement | null>(null);
  // Arrastre de un punto ya puesto: posición provisional mientras se mueve (se confirma al soltar).
  const [arrastre, setArrastre] = useState<{ id: string; x: number; y: number } | null>(null);
  const inicioRef = useRef<{ id: string; cx: number; cy: number; movido: boolean } | null>(null);
  const posEnCaja = (ev: EventoPuntero<HTMLElement>): [number, number] => {
    const caja = (cajaRef.current ?? ev.currentTarget.parentElement!).getBoundingClientRect();
    return puntoTocado((ev.clientX - caja.left) / caja.width, (ev.clientY - caja.top) / caja.height, giro, aspecto);
  };
  return (
    <div className="flex-1 min-w-[130px] max-w-[200px]">
      {/* En la PLANTA no se rotula el pie (a pedido del doctor): la planta se mira «a través», igual que
          el dorso, así que el pie izquierdo es el de la izquierda en las dos vistas. En el dorso sí se rotula. */}
      {vista === 'dorsal'
        ? <p className="text-center text-xs font-bold text-on-surface-variant mb-1">{pie === 'izquierdo' ? 'Izquierdo' : 'Derecho'}</p>
        : <p className="text-center text-xs font-bold text-transparent mb-1 select-none" aria-hidden>·</p>}
      <div ref={cajaRef} data-testid={`mapa-pie-${pie}`} title={pie === 'izquierdo' ? 'Pie izquierdo' : 'Pie derecho'} className={`relative select-none ${pintando ? '' : 'cursor-crosshair'}`} style={{ aspectRatio: aspectoSilueta(vista) }}
        onClick={(ev) => {
          if (pintando) return;
          const r = ev.currentTarget.getBoundingClientRect();
          const [x, y] = puntoTocado((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, giro, aspecto);
          if (enHistorial) historial!.onElegir(x, y); else onClick(x, y);
        }}>
        {/* Capa inclinada: la foto, los trazos y las marcas giran JUNTOS, así cada marca sigue en su zona. */}
        <div className="absolute inset-0" style={estiloGiro(giro)}>
        <SiluetaPie espejo={pie === 'derecho'} vista={vista} />
        {enHistorial ? (
          <>
            {historial!.eventos.map((e, i) => (
              <span key={i} title={`${fmtFecha(e.fecha)} · ${e.texto}`} className="absolute -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-white shadow pointer-events-none"
                style={{ left: `${e.x * 100}%`, top: `${e.y * 100}%`, background: e.color, opacity: e.atencionId === historial!.atencionActual ? 1 : 0.55 }} />
            ))}
            {historial!.zonaSel && (
              <span data-testid="zona-elegida" className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full border-[3px] border-primary bg-primary/15 pointer-events-none animate-pulse"
                style={{ left: `${historial!.zonaSel.x * 100}%`, top: `${historial!.zonaSel.y * 100}%` }} />
            )}
          </>
        ) : (
          <>
            <LienzoSilueta anotaciones={dibujo} aspecto={aspecto} giro={giro} caja={cajaRef} editable={pintando} herramienta={pincel?.herramienta ?? 'lapiz'} color={pincel?.color ?? '#ef4444'} grosor={pincel?.grosor ?? 16}
              onTrazo={(t) => pincel?.onTrazo(t)} onBorrar={(x, y) => pincel?.onBorrar(x, y, aspecto)}
              onSeleccionar={(x, y) => pincel?.onSeleccionar(x, y, aspecto)} seleccionado={pintando ? pincel?.seleccionado ?? null : null}
              oculto={(a) => a.tipo === 'trazo' && !ver(a.tipoLesion)} />
            {propias.map((m) => {
              const pos = arrastre?.id === m.id ? arrastre : m;
              return (
                <span key={m.id} data-marca={m.id} title={`${TIPO_LESION_LABEL[m.tipoLesion]}${m.nota ? ` · ${m.nota}` : ''}${arrastrable ? ' · arrastra para mover, toca para editar' : ''}`}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center ${arrastrable ? `w-7 h-7 touch-none ${arrastre?.id === m.id ? 'cursor-grabbing z-10' : 'cursor-grab'}` : 'w-3 h-3'} ${pintando ? 'pointer-events-none' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  onClick={arrastrable ? (ev) => ev.stopPropagation() : undefined}
                  onPointerDown={arrastrable ? (ev) => {
                    ev.stopPropagation(); ev.preventDefault();
                    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
                    inicioRef.current = { id: m.id, cx: ev.clientX, cy: ev.clientY, movido: false };
                  } : undefined}
                  onPointerMove={arrastrable ? (ev) => {
                    const ini = inicioRef.current;
                    if (!ini || ini.id !== m.id) return;
                    if (!ini.movido && Math.hypot(ev.clientX - ini.cx, ev.clientY - ini.cy) < 5) return; // temblor: todavía es un toque
                    ini.movido = true;
                    const [x, y] = posEnCaja(ev);
                    setArrastre({ id: m.id, x, y });
                  } : undefined}
                  onPointerUp={arrastrable ? (ev) => {
                    const ini = inicioRef.current;
                    inicioRef.current = null;
                    if (!ini || ini.id !== m.id) return;
                    if (ini.movido) { const [x, y] = posEnCaja(ev); onMoverMarca!(m.id, x, y); } else onTocarMarca?.(m.id);
                    setArrastre(null);
                  } : undefined}
                  onPointerCancel={arrastrable ? () => { inicioRef.current = null; setArrastre(null); } : undefined}>
                  <span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: COLOR_LESION[m.tipoLesion] }} />
                </span>
              );
            })}
            {pendiente && pendiente.pie === pie && pendiente.vista === vista && (
              <span className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 border-primary bg-primary/40 animate-pulse"
                style={{ left: `${pendiente.x * 100}%`, top: `${pendiente.y * 100}%` }} />
            )}
          </>
        )}
        </div>
      </div>
    </div>
  );
}

type ModoSilueta = 'punto' | 'pintar' | 'historial';
const MODOS_EDITAR: [ModoSilueta, string, string][] = [['punto', 'location_on', 'Punto'], ['pintar', 'brush', 'Pintar'], ['historial', 'history', 'Historial']];
const MODOS_VER: [ModoSilueta, string, string][] = [['punto', 'visibility', 'Ver'], ['historial', 'history', 'Historial']];
type Pod = ReturnType<typeof usePodograma>;

function FotoHistorial({ id }: { id: string }) {
  const { url } = useFotoUrl(id);
  return <span className="w-14 h-10 rounded-md overflow-hidden bg-surface-container-low border border-outline-variant/30 shrink-0 inline-block">{url && <img src={url} alt="" className="w-full h-full object-cover" />}</span>;
}

/** Modo Historial: zonas con registros (todas las visitas) y la línea de tiempo de la zona elegida. */
function HistorialZona({ pod }: { pod: Pod }) {
  const sel = pod.zonaHist;
  const porFecha = new Map<string, EventoZona[]>();
  for (const e of pod.eventosZonaHist) { if (!porFecha.has(e.fecha)) porFecha.set(e.fecha, []); porFecha.get(e.fecha)!.push(e); }
  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-[270px_1fr] gap-4" data-testid="historial-zonas">
      <div>
        <p className={LBL}>Zonas con registros · {VISTA_SILUETA_LABEL[pod.vistaSilueta]}</p>
        {pod.cargandoHistorial && !pod.zonasHistorial.length && <p className="text-xs text-on-surface-variant">Cargando historial…</p>}
        {!pod.cargandoHistorial && !pod.zonasHistorial.length && <p className="text-xs text-on-surface-variant">Todavía no hay registros en esta vista.</p>}
        <div className="space-y-1">
          {pod.zonasHistorial.map((z) => {
            const activa = !!sel && sel.vista === z.vista && sel.pie === z.pie && sel.zonaId === z.zonaId;
            return (
              <button key={z.clave} onClick={() => pod.setZonaHist({ vista: z.vista, pie: z.pie, zonaId: z.zonaId })}
                className={`w-full min-h-[40px] lg:min-h-0 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${activa ? 'border-primary bg-primary/5' : 'border-outline-variant/30 hover:bg-surface-container-low'}`}>
                <span className="flex -space-x-1 shrink-0">{z.colores.map((c) => <span key={c} className="w-2.5 h-2.5 rounded-full border border-white" style={{ background: c }} />)}</span>
                <span className="flex-1 text-xs text-on-surface"><b>{z.etiqueta}</b> · {z.pie === 'izquierdo' ? 'Izq' : 'Der'}</span>
                <span className="text-[10px] text-on-surface-variant whitespace-nowrap">{z.total} · {fmtFecha(z.ultima)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        {!sel ? <p className="text-sm text-on-surface-variant">Toca una zona del pie o elige una de la lista para ver qué pasó ahí en cada visita.</p> : (
          <>
            <h4 className="text-sm font-semibold text-on-surface mb-3 flex items-center gap-1.5"><span className="material-symbols-outlined text-primary text-base">history</span>{zonaPorId(sel.zonaId).etiqueta} · pie {sel.pie} · {VISTA_SILUETA_LABEL[sel.vista]}</h4>
            {!pod.eventosZonaHist.length && <p className="text-sm text-on-surface-variant">Sin registros en esta zona.</p>}
            <ol className="border-l-2 border-outline-variant/40 ml-2 space-y-3" data-testid="linea-tiempo-zona">
              {[...porFecha.entries()].map(([fecha, evs]) => (
                <li key={fecha} className="ml-4 relative">
                  <span className="absolute -left-[23px] top-1 w-3 h-3 rounded-full bg-primary border-2 border-white" />
                  <p className="text-xs font-bold text-on-surface">{fmtFecha(fecha)} <span className="font-normal text-on-surface-variant">· {evs[0]!.profesional}</span></p>
                  <ul className="mt-1 space-y-1">
                    {evs.map((e, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-on-surface">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: e.color }} />
                        <span className="material-symbols-outlined text-sm text-on-surface-variant" title={FUENTE_LABEL[e.fuente]}>{FUENTE_ICONO[e.fuente]}</span>
                        <span className="flex-1">{e.texto}</span>
                        {e.fotoId && <FotoHistorial id={e.fotoId} />}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

const COLORES_ANOTACION = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#ffffff'];
// Herramientas del lienzo. "Mover" no dibuja: deja desplazar la página con el dedo (en tablet es
// la herramienta inicial, para no dejar trazos por accidente).
const HERRAMIENTAS: { id: 'mover' | 'lapiz' | 'texto' | 'borrador' | 'etiquetar'; icon: string; label: string }[] = [
  { id: 'mover', icon: 'pan_tool', label: 'Mover' },
  { id: 'lapiz', icon: 'edit', label: 'Lápiz' },
  { id: 'texto', icon: 'text_fields', label: 'Texto' },
  { id: 'borrador', icon: 'ink_eraser', label: 'Borrador' },
  { id: 'etiquetar', icon: 'label', label: 'Etiquetar' },
];
// Botones de 44px de alto en pantallas táctiles (mínimo cómodo para el dedo); compactos en escritorio.
const BTN_TOOL = (activo: boolean) => `min-h-[44px] lg:min-h-0 px-3 lg:px-2.5 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs font-semibold flex items-center gap-1 border disabled:opacity-40 ${activo ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant/40 text-on-surface hover:bg-surface-container-high'}`;

// Casilla de una de las 4 vistas del podograma (miniatura, seleccionar para anotar, cargar/reemplazar).
function CasillaVista({ vista, img, seleccionada, puedeEditar, subiendo, onSeleccionar, onCargar }: {
  vista: VistaPodograma; img: ImagenPodograma | undefined; seleccionada: boolean; puedeEditar: boolean; subiendo: boolean;
  onSeleccionar: () => void; onCargar: () => void;
}) {
  const mini = useMiniaturaPodograma(img?.id);
  return (
    <div className={`rounded-xl border-2 overflow-hidden flex flex-col ${seleccionada ? 'border-primary shadow-md shadow-primary/10' : 'border-outline-variant/30'}`}>
      <button onClick={img ? onSeleccionar : onCargar} disabled={!img && !puedeEditar} className="relative aspect-[4/3] bg-surface-container-low flex items-center justify-center overflow-hidden disabled:cursor-default">
        {img
          ? (mini.url ? <img src={mini.url} alt={VISTA_PODOGRAMA_LABEL[vista]} className="w-full h-full object-cover" /> : <Skeleton className="w-full h-full" />)
          : <span className="flex flex-col items-center gap-1 text-on-surface-variant"><span className="material-symbols-outlined text-3xl">add_photo_alternate</span><span className="text-xs font-semibold">{puedeEditar ? 'Cargar imagen' : 'Sin imagen'}</span></span>}
        {img && img.anotaciones.length > 0 && <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary text-on-primary">{img.anotaciones.length}</span>}
      </button>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5 bg-surface-container-lowest">
        <span className="text-xs font-bold text-on-surface truncate">{VISTA_PODOGRAMA_LABEL[vista]}</span>
        {puedeEditar && img && <button onClick={onCargar} disabled={subiendo} title="Reemplazar imagen" className="text-[11px] font-semibold text-primary hover:underline shrink-0 flex items-center gap-0.5 disabled:opacity-50"><span className="material-symbols-outlined text-sm">sync</span>Reemplazar</button>}
      </div>
    </div>
  );
}

function PanelPodograma({ h, a }: { h: H; a: AtencionCompleta }) {
  // La vista (planta/dorso) y el modo vienen de la página: así no se pierden al cambiar de atención.
  const pod = usePodograma(a, h.puedeRegistrar, { vista: h.vistaSilueta, setVista: h.setVistaSilueta, modo: h.modoSilueta, setModo: h.setModoSilueta });
  const inputRef = useRef<HTMLInputElement>(null);
  // Un solo <input type=file> oculto para las 4 casillas: se recuerda a qué vista va antes de abrirlo.
  const vistaPendienteRef = useRef<VistaPodograma | null>(null);
  const abrirSelector = (vista: VistaPodograma | null) => { vistaPendienteRef.current = vista; inputRef.current?.click(); };
  const mostrarImagen = !pod.verSilueta;
  const cargadas = VISTAS_PODOGRAMA.filter((v) => pod.porVista[v]).length;
  const quitar = useConfirmarQuitar();
  return (
    <div className="space-y-5">
      {quitar.dialogo}
      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center"><span className="material-symbols-outlined mr-2 text-primary">footprint</span>Podograma</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => pod.setVerSilueta(!pod.verSilueta)} className="px-3 py-1.5 border border-outline-variant rounded-lg text-xs font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1">
              <span className="material-symbols-outlined text-base">{pod.verSilueta ? 'image' : 'footprint'}</span>{pod.verSilueta ? 'Ver imágenes' : 'Ver silueta'}
            </button>
            {pod.puedeEditar && <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { pod.subirArchivo(e.target.files?.[0], vistaPendienteRef.current); vistaPendienteRef.current = null; e.target.value = ''; }} />}
          </div>
        </div>
        <p className="text-xs text-on-surface-variant mb-4">
          {mostrarImagen
            ? `La Baro entrega 4 imágenes: frontal y posterior de cada pie (${cargadas} de 4 cargadas). Toca una casilla para ${pod.puedeEditar ? 'cargar o anotar' : 'ver'} esa vista.`
            : (pod.puedeEditar ? 'Con «Punto» ubicas una lesión con un clic (arrastra un punto para moverlo o tócalo para editarlo); con «Pintar» dibujas a mano sobre el pie. «Dorso» es para las uñas y el empeine.' : 'Mapa de lesiones de la atención.')}
        </p>

        {mostrarImagen ? (
          <>
            {/* Las 4 vistas fijas, siempre visibles (vacías o con miniatura) */}
            <div className="grid grid-cols-2 gap-3 mb-4 max-w-[560px]">
              {VISTAS_PODOGRAMA.map((v) => (
                <CasillaVista key={v} vista={v} img={pod.porVista[v]} seleccionada={!!pod.porVista[v] && pod.imagenSel?.id === pod.porVista[v]?.id} puedeEditar={pod.puedeEditar} subiendo={pod.subirMut.isPending}
                  onSeleccionar={() => { const img = pod.porVista[v]; if (img) pod.setImagenSelId(img.id); }} onCargar={() => abrirSelector(v)} />
              ))}
            </div>
            {pod.otras.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-3">
                <span className="text-[11px] text-on-surface-variant self-center">Otras imágenes:</span>
                {pod.otras.map((img, i) => (
                  <button key={img.id} onClick={() => pod.setImagenSelId(img.id)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold border max-w-[220px] truncate ${pod.imagenSel?.id === img.id ? 'border-primary bg-primary/5 text-primary' : 'border-outline-variant/40 text-on-surface hover:bg-surface-container-low'}`}>
                    {i + 1}. {img.descripcion || img.nombreArchivo}
                  </button>
                ))}
              </div>
            )}
            {pod.subirMut.isPending && <p className="text-xs text-primary mb-3 flex items-center gap-1"><span className="material-symbols-outlined text-base animate-spin">progress_activity</span>Subiendo imagen…</p>}
            {pod.imagenSel && (<>
            <h4 className="text-sm font-semibold text-on-surface mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-base text-primary">edit_square</span>{pod.imagenSel.vista ? VISTA_PODOGRAMA_LABEL[pod.imagenSel.vista] : (pod.imagenSel.descripcion || pod.imagenSel.nombreArchivo)}</h4>
            {pod.puedeEditar && (
              <div className="space-y-2 mb-3">
                {/* Fila 1: herramientas grandes, en una sola línea deslizable si no entran */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {HERRAMIENTAS.map((t) => <button key={t.id} onClick={() => pod.setHerramienta(t.id)} className={`${BTN_TOOL(pod.herramienta === t.id)} shrink-0`} title={t.label}><span className="material-symbols-outlined text-base">{t.icon}</span>{t.label}</button>)}
                  <span className="w-px h-6 bg-outline-variant/30 mx-1 shrink-0" />
                  <button onClick={pod.deshacer} disabled={!pod.anotaciones.length} className={`${BTN_TOOL(false)} shrink-0`} title="Deshacer"><span className="material-symbols-outlined text-base">undo</span><span className="hidden sm:inline">Deshacer</span></button>
                  <button onClick={pod.limpiarAnotaciones} disabled={!pod.anotaciones.length} className={`${BTN_TOOL(false)} shrink-0`} title="Limpiar anotaciones"><span className="material-symbols-outlined text-base">delete_sweep</span><span className="hidden sm:inline">Limpiar</span></button>
                </div>
                {/* Fila 2: qué se marca (lápiz), color (texto) o el trazo a etiquetar; solo lo que la herramienta usa */}
                {pod.herramienta === 'lapiz' && (
                  <div className="flex flex-col items-center gap-2">
                    <SelectorLesion titulo="¿Qué estás marcando?" valor={pod.tipoBaro} onCambio={pod.setTipoBaro} />
                    <label className="text-[10px] font-semibold uppercase text-on-surface-variant flex items-center gap-2">Grosor<input type="range" min={1} max={20} value={pod.grosor} onChange={(e) => pod.setGrosor(Number(e.target.value))} className="w-28 lg:w-20 h-8 accent-primary" /></label>
                  </div>
                )}
                {pod.herramienta === 'texto' && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {COLORES_ANOTACION.map((c) => <button key={c} onClick={() => pod.setColor(c)} title={c} className={`w-9 h-9 lg:w-6 lg:h-6 rounded-full border-2 ${pod.color === c ? 'border-primary scale-110' : 'border-outline-variant/40'}`} style={{ background: c }} />)}
                  </div>
                )}
                {pod.herramienta === 'etiquetar' && pod.anotSel != null && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[180px]"><label className={LBL}>Qué es</label>
                      <select value={pod.anotSelTipo} onChange={(ev) => pod.setAnotSelTipo(ev.target.value as TipoLesion)} className={INPUT}>{(Object.keys(TIPO_LESION_LABEL) as TipoLesion[]).map((t) => <option key={t} value={t}>{etiquetaLesion(t)}</option>)}</select>
                    </div>
                    <div className="flex-[2] min-w-[180px]"><label className={LBL}>Detalle</label><input value={pod.anotSelNota} onChange={(ev) => pod.setAnotSelNota(ev.target.value)} maxLength={200} placeholder="Opcional (ej. borde lateral inflamado)" className={INPUT} /></div>
                    <button onClick={pod.aplicarEtiquetaAnotacion} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold">Aplicar</button>
                  </div>
                )}
                <p className="text-[11px] text-on-surface-variant">
                  {pod.herramienta === 'mover' ? 'Modo mover: desplaza la página con el dedo sin dibujar. Toca "Lápiz" para marcar.'
                    : pod.herramienta === 'lapiz' ? 'Elige qué es y dibuja con el dedo, el lápiz o el mouse.'
                    : pod.herramienta === 'texto' ? 'Toca el punto donde va el texto, escribe y confirma con Enter.'
                    : pod.herramienta === 'etiquetar' ? (pod.anotSel != null ? 'Cambia qué es o agrega un detalle y toca «Aplicar»; luego «Guardar anotaciones».' : 'Toca un trazo para indicar qué es (callo, uñero, dolor…).')
                    : 'Toca un trazo o un texto para quitarlo.'}
                </p>
              </div>
            )}
            <div className="w-full">
              {pod.cargandoImagen || !pod.urlImagen
                ? <Skeleton className="h-80 w-full" />
                : <PodogramaEditor url={pod.urlImagen} anotaciones={pod.anotaciones} herramienta={pod.herramienta} color={pod.herramienta === 'lapiz' ? COLOR_LESION[pod.tipoBaro] : pod.color} grosor={pod.grosor} editable={pod.puedeEditar}
                    onTrazo={pod.agregarAnotacion} onTexto={(x, y, texto) => pod.agregarAnotacion({ tipo: 'texto', x, y, texto, color: pod.color })} onBorrar={pod.borrarEn}
                    onSeleccionar={pod.seleccionarEn} seleccion={pod.herramienta === 'etiquetar' ? pod.anotSel : null} oculto={pod.trazoOculto} />}
            </div>
            <LeyendaLesiones items={calcularLeyenda(trazosComoLeyenda(pod.anotaciones))} ocultos={pod.capasOcultas} onAlternar={pod.alternarCapa} onMostrarTodo={pod.mostrarTodasCapas} />
            {/* Guardar / Descartar: barra pegada abajo mientras haya cambios; en tablet nunca queda fuera de vista */}
            {pod.puedeEditar && pod.sucio && (
              <div className="sticky bottom-2 z-10 mt-3 flex items-center justify-end gap-2 rounded-xl border border-primary/30 bg-surface-container-lowest/95 backdrop-blur p-2 shadow-lg">
                <span className="text-xs text-on-surface-variant mr-auto pl-1">Cambios sin guardar</span>
                <button onClick={pod.descartar} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-lg text-sm lg:text-xs font-semibold text-on-surface hover:bg-surface-container-high">Descartar</button>
                <button onClick={pod.guardarAnotaciones} disabled={pod.guardarAnotacionesMut.isPending} className="min-h-[44px] lg:min-h-0 px-5 py-2 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold flex items-center gap-1 disabled:opacity-50"><span className="material-symbols-outlined text-base">save</span>Guardar anotaciones</button>
              </div>
            )}
            {pod.imagenSel && (
              <div className="flex items-center gap-2 flex-wrap mt-3 text-[11px] text-on-surface-variant">
                <span className="material-symbols-outlined text-sm">image</span>
                <span className="font-semibold text-on-surface truncate max-w-[260px]">{pod.imagenSel.nombreArchivo}</span>
                <span>· {(pod.imagenSel.tamano / 1024).toFixed(0)} KB</span>
                {pod.imagenSel.subidoEtiqueta && <span>· subida por {pod.imagenSel.subidoEtiqueta}</span>}
                <span>· {pod.anotaciones.length} anotación(es){pod.sucio ? ' (sin guardar)' : ''}</span>
                <span className="flex-1" />
                {pod.puedeEditar && <button onClick={() => quitar.pedir('¿Quitar esta imagen de la Baro?', 'Deja de verse en la atención (el archivo se conserva).', () => pod.eliminarImagenMut.mutate(pod.imagenSel!.id))} disabled={pod.eliminarImagenMut.isPending} className="min-h-[44px] lg:min-h-0 text-rose-600 font-semibold hover:underline flex items-center gap-1"><span className="material-symbols-outlined text-sm">delete</span>Quitar imagen</button>}
              </div>
            )}
            </>)}
          </>
        ) : (
          <>
            {/* Planta / Dorso: dos siluetas, cada una con sus propias marcas */}
            <div className="flex justify-center mb-4">
              <div className="inline-flex rounded-xl border border-outline-variant/40 p-1 bg-surface-container-low" role="tablist">
                {(['plantar', 'dorsal'] as const).map((v) => {
                  const n = pod.marcas.filter((m) => (m.vista ?? 'plantar') === v).length;
                  return (
                    <button key={v} role="tab" aria-selected={pod.vistaSilueta === v} onClick={() => pod.setVistaSilueta(v)}
                      className={`min-h-[44px] lg:min-h-0 px-4 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs font-semibold flex items-center gap-1.5 transition-colors ${pod.vistaSilueta === v ? 'bg-primary text-on-primary shadow' : 'text-on-surface-variant hover:text-on-surface'}`}>
                      {v === 'plantar' ? 'Planta' : 'Dorso (uñas)'}
                      {n > 0 && <span className={`text-[10px] px-1.5 rounded ${pod.vistaSilueta === v ? 'bg-on-primary/20' : 'bg-surface-container-high'}`}>{n}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Punto (marca con un clic) · Pintar (trazos a mano) · Historial (todas las visitas, por zona) */}
            {(
              <div className="flex flex-col items-center gap-2 mb-4">
                <div className="inline-flex rounded-xl border border-outline-variant/40 p-1 bg-surface-container-low">
                  {(pod.puedeEditar ? MODOS_EDITAR : MODOS_VER).map(([m, icon, label]) => (
                    <button key={m} onClick={() => pod.setModoSilueta(m)} aria-pressed={pod.modoSilueta === m}
                      className={`min-h-[44px] lg:min-h-0 px-4 py-2 lg:py-1.5 rounded-lg text-sm lg:text-xs font-semibold flex items-center gap-1.5 transition-colors ${pod.modoSilueta === m ? 'bg-surface-container-lowest text-primary border border-primary/30 shadow' : 'text-on-surface-variant hover:text-on-surface border border-transparent'}`}>
                      <span className="material-symbols-outlined text-base">{icon}</span>{label}
                    </button>
                  ))}
                </div>
                {pod.modoSilueta === 'pintar' && (
                  <>
                    <div className="flex items-center justify-center gap-2 flex-wrap">
                      {([['lapiz', 'brush', 'Pincel'], ['borrador', 'ink_eraser', 'Borrador'], ['etiquetar', 'label', 'Etiquetar']] as const).map(([t, icon, label]) => (
                        <button key={t} onClick={() => pod.setHerrDibujo(t)} className={BTN_TOOL(pod.herrDibujo === t)} title={t === 'etiquetar' ? 'Toca un trazo para indicar qué es' : undefined}>
                          <span className="material-symbols-outlined text-base">{icon}</span>{label}
                        </button>
                      ))}
                      {pod.herrDibujo === 'lapiz' && (
                        <label className="text-[10px] font-semibold uppercase text-on-surface-variant flex items-center gap-2">Grosor<input type="range" min={4} max={40} value={pod.grosorDibujo} onChange={(e) => pod.setGrosorDibujo(Number(e.target.value))} className="w-28 lg:w-20 h-8 accent-primary" /></label>
                      )}
                      <span className="w-px h-6 bg-outline-variant/30 mx-1" />
                      <button onClick={pod.deshacerDibujo} disabled={!pod.puedeDeshacerDibujo} className={BTN_TOOL(false)} title="Deshacer"><span className="material-symbols-outlined text-base">undo</span><span className="hidden sm:inline">Deshacer</span></button>
                      <button onClick={pod.limpiarDibujo} disabled={!pod.hayDibujoEnVista} className={BTN_TOOL(false)} title="Limpiar esta vista"><span className="material-symbols-outlined text-base">delete_sweep</span><span className="hidden sm:inline">Limpiar</span></button>
                      {/* Guardar / Descartar junto a las herramientas: nunca tapan el pie mientras se pinta */}
                      {pod.dibujoSucio && (
                        <>
                          <button onClick={pod.descartarDibujo} className={BTN_TOOL(false)} title="Descartar cambios"><span className="material-symbols-outlined text-base">close</span><span className="hidden sm:inline">Descartar</span></button>
                          <button onClick={() => pod.guardarDibujoMut.mutate()} disabled={pod.guardarDibujoMut.isPending} className="min-h-[44px] lg:min-h-0 px-4 py-2 lg:py-1.5 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold flex items-center gap-1 disabled:opacity-50"><span className="material-symbols-outlined text-base">save</span>{pod.guardarDibujoMut.isPending ? 'Guardando…' : 'Guardar dibujo'}</button>
                        </>
                      )}
                    </div>
                    {pod.herrDibujo === 'lapiz' && <SelectorLesion titulo="¿Qué estás pintando?" valor={pod.tipoDibujo} onCambio={pod.setTipoDibujo} />}
                    {pod.herrDibujo === 'etiquetar' && pod.trazoSel && (
                      <div className="w-full max-w-2xl rounded-xl border border-primary/30 bg-primary/5 p-3 flex flex-wrap items-end gap-2" data-testid="editor-trazo">
                        <p className="w-full text-xs font-semibold text-primary">Trazo elegido · pie {pod.trazoSel.pie} · {VISTA_SILUETA_LABEL[pod.vistaSilueta]}</p>
                        <div className="flex-1 min-w-[180px]"><label className={LBL}>Qué es</label>
                          <select value={pod.selTipo} onChange={(ev) => pod.setSelTipo(ev.target.value as TipoLesion)} className={INPUT}>{(Object.keys(TIPO_LESION_LABEL) as TipoLesion[]).map((t) => <option key={t} value={t}>{etiquetaLesion(t)}</option>)}</select>
                        </div>
                        <div className="flex-[2] min-w-[180px]"><label className={LBL}>Detalle</label><input value={pod.selNota} onChange={(ev) => pod.setSelNota(ev.target.value)} maxLength={200} placeholder="Opcional (ej. doloroso al apoyar)" className={INPUT} /></div>
                        <button onClick={pod.aplicarEtiquetaTrazo} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold">Aplicar</button>
                        <button onClick={pod.quitarTrazoSel} className={BTN_TOOL(false)}><span className="material-symbols-outlined text-base">delete</span>Quitar trazo</button>
                      </div>
                    )}
                    <p className="text-[11px] text-on-surface-variant">
                      {pod.herrDibujo === 'lapiz' ? 'Elige qué es y pinta con el dedo, el lápiz o el mouse sobre el pie.'
                        : pod.herrDibujo === 'borrador' ? 'Toca un trazo para quitarlo.'
                        : pod.trazoSel ? 'Cambia qué es o agrega un detalle y toca «Aplicar».' : 'Toca un trazo para indicar qué es (callo, uñero, dolor…) o agregarle un detalle.'}
                      {pod.dibujoSucio ? ' Hay cambios sin guardar.' : ''}
                    </p>
                  </>
                )}
                {pod.modoSilueta === 'historial' && <p className="text-[11px] text-on-surface-variant text-center">Todas las visitas del paciente en esta vista (lo de hoy más intenso). Toca una zona del pie para ver su historial.</p>}
              </div>
            )}
            {/* En la planta, la foto pone el pie derecho a la izquierda: se respeta ese orden para que se
                vea como la original. En el dorso, el izquierdo va a la izquierda. */}
            <div className="flex justify-center gap-8 px-6 pb-8">
              {(pod.vistaSilueta === 'plantar' ? (['derecho', 'izquierdo'] as const) : (['izquierdo', 'derecho'] as const)).map((pie) => (
                <MapaPie key={pie} pie={pie} vista={pod.vistaSilueta} marcas={pod.marcas} pendiente={pod.pendiente} onClick={(x, y) => pod.marcarPunto(pie, x, y)}
                  modo={pod.modoSilueta} dibujo={pod.dibujoDe(pod.vistaSilueta, pie)} visible={pod.capaVisible}
                  onMoverMarca={pod.puedeEditar ? pod.moverMarca : undefined}
                  onTocarMarca={pod.puedeEditar ? (id) => { pod.tocarMarca(id); setTimeout(() => document.getElementById(`marca-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); } : undefined}
                  historial={{ eventos: pod.puntosHistorial(pie), atencionActual: a.id, zonaSel: pod.zonaHist && pod.zonaHist.pie === pie && pod.zonaHist.vista === pod.vistaSilueta ? coordZona(pod.zonaHist.zonaId, pie) : null, onElegir: (x, y) => pod.elegirZonaHistorial(pie, x, y) }}
                  pincel={pod.puedeEditar ? { herramienta: pod.herrDibujo, color: COLOR_LESION[pod.tipoDibujo], grosor: pod.grosorDibujo, onTrazo: (t) => pod.agregarTrazoSilueta(pie, t), onBorrar: (x, y, asp) => pod.borrarTrazoSilueta(pie, x, y, asp), onSeleccionar: (x, y, asp) => pod.seleccionarTrazoSilueta(pie, x, y, asp), seleccionado: pod.trazoSel?.pie === pie ? pod.trazoSel.indice : null } : undefined} />
              ))}
            </div>
            {/* Leyenda: qué significa cada color (puntos y trazos de esta vista), con los detalles escritos */}
            {pod.modoSilueta !== 'historial' && <LeyendaLesiones items={calcularLeyenda([
              ...(['izquierdo', 'derecho'] as const).flatMap((pie) => trazosComoLeyenda(pod.dibujoDe(pod.vistaSilueta, pie), pie === 'izquierdo' ? 'Izq' : 'Der')),
              ...pod.marcas.filter((m) => (m.vista ?? 'plantar') === pod.vistaSilueta).map((m) => ({ tipo: m.tipoLesion, color: COLOR_LESION[m.tipoLesion], nota: m.nota, clase: 'punto' as const, lugar: m.pie === 'izquierdo' ? 'Izq' : 'Der' })),
            ])} ocultos={pod.capasOcultas} onAlternar={pod.alternarCapa} onMostrarTodo={pod.mostrarTodasCapas} />}
            {pod.modoSilueta === 'historial' && <HistorialZona pod={pod} />}
            {/* Guardar / Descartar el dibujo: barra pegada abajo mientras haya cambios */}
            {pod.puedeEditar && pod.dibujoSucio && pod.modoSilueta !== 'pintar' && (
              <div className="mt-3 flex items-center justify-end gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2">
                <span className="text-xs text-on-surface-variant mr-auto pl-1">Dibujo sin guardar</span>
                <button onClick={pod.descartarDibujo} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-lg text-sm lg:text-xs font-semibold text-on-surface hover:bg-surface-container-high">Descartar</button>
                <button onClick={() => pod.guardarDibujoMut.mutate()} disabled={pod.guardarDibujoMut.isPending} className="min-h-[44px] lg:min-h-0 px-5 py-2 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold flex items-center gap-1 disabled:opacity-50"><span className="material-symbols-outlined text-base">save</span>{pod.guardarDibujoMut.isPending ? 'Guardando…' : 'Guardar dibujo'}</button>
              </div>
            )}
            {pod.modoSilueta === 'punto' && pod.pendiente && (
              <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <p className="text-xs font-semibold text-primary mb-2">Nueva lesión en pie {pod.pendiente.pie} · {VISTA_SILUETA_LABEL[pod.pendiente.vista]}</p>
                <div className="grid grid-cols-1 md:grid-cols-[280px_1fr_auto] gap-3 items-end">
                  <div><label className={LBL}>Qué es</label>
                    <select value={pod.tipoLesion} onChange={(ev) => pod.setTipoLesion(ev.target.value as TipoLesion)} className={INPUT}>
                      {(Object.keys(TIPO_LESION_LABEL) as TipoLesion[]).map((t) => <option key={t} value={t}>{etiquetaLesion(t)}</option>)}
                    </select>
                  </div>
                  <div><label className={LBL}>Detalle</label><input value={pod.nota} onChange={(ev) => pod.setNota(ev.target.value)} placeholder="Opcional (ej. doloroso al apoyar)" className={INPUT} /></div>
                  <div className="flex gap-2">
                    <button onClick={() => pod.cancelar()} className="px-3 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high">Cancelar</button>
                    <button disabled={pod.agregarMut.isPending} onClick={() => pod.agregarMut.mutate()} className="px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">Guardar</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h4 className="text-sm font-semibold text-on-surface mb-3">Lesiones marcadas ({pod.marcas.length})</h4>
        {pod.marcas.length === 0 && !pod.dibujosGuardados.length && <p className="text-sm text-on-surface-variant">Sin lesiones marcadas.</p>}
        <div className="space-y-1.5">
          {pod.marcas.map((m) => (
            <div key={m.id} id={`marca-${m.id}`} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${pod.marcaEdit?.id === m.id ? 'border-primary bg-primary/5' : 'border-outline-variant/20'}`}>
              <span className="w-3 h-3 rounded-full border border-white shadow shrink-0" style={{ background: COLOR_LESION[m.tipoLesion] }} />
              <span className="text-sm font-semibold text-on-surface">{TIPO_LESION_LABEL[m.tipoLesion]}</span>
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">{m.pie === 'izquierdo' ? 'Izq' : 'Der'}</span>
              <button onClick={() => { pod.setVerSilueta(true); pod.setVistaSilueta(m.vista ?? 'plantar'); }} title="Ver en la silueta" className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant hover:bg-surface-container-high">{VISTA_SILUETA_LABEL[m.vista ?? 'plantar']}</button>
              {m.zona && <span className="text-xs text-on-surface-variant">{m.zona}</span>}
              {m.nota && <span className="text-xs text-on-surface-variant">· {m.nota}</span>}
              <span className="flex-1" />
              {pod.puedeEditar && <button onClick={() => pod.setMarcaEdit({ id: m.id, tipo: m.tipoLesion, nota: m.nota ?? '' })} title="Cambiar qué es o el detalle" aria-label="Editar lesión" className="material-symbols-outlined text-on-surface-variant/60 hover:text-primary text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">edit</button>}
              {pod.puedeEditar && <button onClick={() => quitar.pedir(`¿Quitar la lesión «${TIPO_LESION_LABEL[m.tipoLesion]}»?`, 'Se quita del podograma (queda registro interno).', () => pod.eliminarMut.mutate(m.id))} aria-label="Quitar lesión" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 flex items-center justify-center">delete</button>}
              {pod.marcaEdit?.id === m.id && (
                <div className="basis-full flex flex-wrap items-end gap-2 mt-2">
                  <div className="flex-1 min-w-[180px]"><label className={LBL}>Qué es</label>
                    <select value={pod.marcaEdit.tipo} onChange={(ev) => pod.setMarcaEdit({ ...pod.marcaEdit!, tipo: ev.target.value as TipoLesion })} className={INPUT}>{(Object.keys(TIPO_LESION_LABEL) as TipoLesion[]).map((t) => <option key={t} value={t}>{etiquetaLesion(t)}</option>)}</select>
                  </div>
                  <div className="flex-[2] min-w-[180px]"><label className={LBL}>Detalle</label><input value={pod.marcaEdit.nota} onChange={(ev) => pod.setMarcaEdit({ ...pod.marcaEdit!, nota: ev.target.value })} maxLength={500} className={INPUT} /></div>
                  <button onClick={() => pod.setMarcaEdit(null)} className={BTN_TOOL(false)}>Cancelar</button>
                  <button onClick={() => pod.editarMarcaMut.mutate(pod.marcaEdit!)} disabled={pod.editarMarcaMut.isPending} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm lg:text-xs font-bold disabled:opacity-50">Guardar</button>
                </div>
              )}
            </div>
          ))}
        </div>
        {pod.dibujosGuardados.length > 0 && (
          <div className="flex gap-2 flex-wrap mt-3">
            {pod.dibujosGuardados.map((d) => (
              <button key={d.id} onClick={() => { pod.setVerSilueta(true); pod.setVistaSilueta(d.vista); }} title={d.registradoEtiqueta ? `Dibujó ${d.registradoEtiqueta}` : undefined}
                className="text-xs px-2.5 py-1 rounded-lg border border-outline-variant/40 text-on-surface hover:bg-surface-container-low flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-primary">brush</span>Dibujo · {VISTA_SILUETA_LABEL[d.vista]} · {d.pie === 'izquierdo' ? 'Izq' : 'Der'} · {d.anotaciones.length} trazo{d.anotaciones.length === 1 ? '' : 's'}{resumenTipos(d.anotaciones) ? ` · ${resumenTipos(d.anotaciones)}` : ''}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── 1.8 · Fotos clínicas por atención + 1.9 antes/después ──────────────────
function MiniaturaFoto({ foto, puedeEditar, onEliminar, onMedir }: { foto: FotoClinica; puedeEditar: boolean; onEliminar: () => void; onMedir?: () => void }) {
  const { url } = useFotoUrl(foto.id);
  return (
    <div className="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest">
      <div className="aspect-[4/3] bg-surface-container-low flex items-center justify-center overflow-hidden">
        {url ? <img src={url} alt={foto.zona ?? 'Foto clínica'} className="w-full h-full object-cover" /> : <Skeleton className="w-full h-full" />}
      </div>
      <div className="px-2 py-1.5 text-[11px] text-on-surface-variant flex items-center gap-1 flex-wrap">
        <span className="font-bold text-on-surface">{foto.zona || CATEGORIA_FOTO_LABEL[foto.categoria]}</span>
        {foto.pie && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold uppercase text-[9px]">{PIE_LABEL[foto.pie]}</span>}
        <span>· {fmtFechaLima(foto.tomadaEn)}</span>
        <span className="flex-1" />
        {onMedir && <button onClick={onMedir} title="Medir úlcera sobre la foto" aria-label="Medir úlcera" className="material-symbols-outlined text-on-surface-variant/60 hover:text-primary text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 lg:text-base flex items-center justify-center">straighten</button>}
        {puedeEditar && <button onClick={onEliminar} title="Quitar foto" aria-label="Quitar foto" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg min-w-[44px] min-h-[44px] lg:min-w-0 lg:min-h-0 lg:text-base flex items-center justify-center">delete</button>}
        {foto.descripcion && <span className="w-full truncate">{foto.descripcion}</span>}
      </div>
    </div>
  );
}

const etiquetaFoto = (x: { tomadaEn: string; zona: string | null; categoria: CategoriaFoto; pie: Pie | null }) =>
  `${fmtFechaLima(x.tomadaEn)} · ${x.zona || CATEGORIA_FOTO_LABEL[x.categoria]}${x.pie ? ` · ${PIE_LABEL[x.pie]}` : ''}`;

type FotosHc = ReturnType<typeof useFotosClinicas>;

/** Foto tomada o elegida que aún no se guarda: vista previa + sus datos; «Guardar» la sube a la atención. */
function FotoPorGuardar({ p, f }: { p: FotoPendiente; f: FotosHc }) {
  const guardando = f.guardando.includes(p.id);
  const set = (c: Partial<CamposPendiente>) => f.actualizarPendiente(p.id, c);
  return (
    <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-3 flex flex-col md:flex-row gap-3" data-testid="foto-por-guardar">
      <img src={p.url} alt="Vista previa de la foto" className="w-full md:w-48 aspect-[4/3] object-cover rounded-lg bg-surface-container-low shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div><label className={LBL}>Zona</label>
            <input value={p.zona} onChange={(e) => set({ zona: e.target.value })} list="zonas-foto" placeholder="Ej. uña 1, talón" className={INPUT} data-campo="zona" />
          </div>
          <div><label className={LBL}>Lado</label>
            <select value={p.pie} onChange={(e) => set({ pie: e.target.value as Pie | '' })} className={INPUT} data-campo="pie">
              <option value="">—</option><option value="izquierdo">Izquierdo</option><option value="derecho">Derecho</option><option value="ambos">Ambos</option>
            </select>
          </div>
          <div><label className={LBL}>Tipo</label>
            <select value={p.categoria} onChange={(e) => set({ categoria: e.target.value as CategoriaFoto })} className={INPUT} data-campo="categoria">
              {(Object.keys(CATEGORIA_FOTO_LABEL) as CategoriaFoto[]).map((c) => <option key={c} value={c}>{CATEGORIA_FOTO_LABEL[c]}</option>)}
            </select>
          </div>
          <div><label className={LBL}>Descripción</label><input value={p.descripcion} onChange={(e) => set({ descripcion: e.target.value })} placeholder="Opcional" className={INPUT} data-campo="descripcion" /></div>
        </div>
        {(!p.zona.trim() || !p.pie) && (
          <p className="text-[11px] text-amber-700 flex items-center gap-1"><span className="material-symbols-outlined text-sm">warning</span>
            {!p.zona.trim() ? 'Sin zona: el antes/después y el historial por zona no la encontrarán.' : 'Falta el lado.'}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => f.guardarPendiente(p.id)} disabled={guardando} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
            <span className="material-symbols-outlined text-base">save</span>{guardando ? 'Guardando…' : 'Guardar'}
          </button>
          {f.pendientes.length > 1 && (
            <button onClick={() => f.aplicarATodas(p.id)} disabled={guardando} className="min-h-[44px] lg:min-h-0 px-3 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5 disabled:opacity-50">
              <span className="material-symbols-outlined text-base">content_copy</span>Copiar zona y lado a las demás
            </button>
          )}
          <button onClick={() => f.descartarPendiente(p.id)} disabled={guardando} className="min-h-[44px] lg:min-h-0 px-3 py-2 rounded-xl text-sm font-semibold text-rose-700 hover:bg-rose-50 flex items-center gap-1.5 disabled:opacity-50">
            <span className="material-symbols-outlined text-base">delete</span>Descartar
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelFotos({ h, a }: { h: H; a: AtencionCompleta }) {
  const f = useFotosClinicas(a, h.puedeRegistrar);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const antesUrl = useFotoUrl(f.antes?.id);
  const despuesUrl = useFotoUrl(f.despues?.id);
  const quitar = useConfirmarQuitar();
  // Pedal Bluetooth (o teclado): con el pedal activo, Av Pág o las flechas disparan "Tomar foto".
  // Un pedal de pasar páginas es un teclado de un botón; no se toma si se está escribiendo en un campo.
  useEffect(() => {
    if (!f.puedeEditar || !f.pedalActivo || f.fantasmaAbierta) return; // con la foto fantasma abierta, el pedal captura allí
    const alPresionar = (ev: KeyboardEvent) => {
      if (!['PageDown', 'PageUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(ev.key) || ev.ctrlKey || ev.altKey || ev.metaKey) return;
      // Solo se ignora mientras se escribe (texto, números, listas); casillas y botones dejan pasar el pedal.
      const t = ev.target as HTMLElement | null;
      const escribiendo = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
        || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file'].includes((t as HTMLInputElement).type)));
      if (escribiendo) return;
      ev.preventDefault();
      camRef.current?.click(); // la foto queda «por guardar»: se puede seguir tomando mientras otra sube
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [f.puedeEditar, f.pedalActivo, f.fantasmaAbierta]);
  return (
    <div className="space-y-5">
      {f.puedeEditar && (
        <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-primary">photo_camera</span>Nueva foto</h3>
          <div className="flex flex-wrap gap-2">
            {/* capture="environment" abre la cámara trasera en tablet/celular; en PC abre el selector.
                La foto NO se sube al instante: queda en «Por guardar» hasta pulsar Guardar. */}
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { f.agregarArchivos(e.target.files); e.target.value = ''; }} />
            <input ref={galRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={(e) => { f.agregarArchivos(e.target.files); e.target.value = ''; }} />
            <button onClick={() => camRef.current?.click()} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">photo_camera</span>Tomar foto
            </button>
            <button onClick={() => galRef.current?.click()} className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base">upload</span>Subir de la galería
            </button>
            <button onClick={() => f.setFantasmaAbierta(true)} disabled={!f.todas.length}
              title={f.todas.length ? 'Cámara en vivo con una foto anterior en transparencia, para repetir el mismo encuadre' : 'Necesitas al menos una foto anterior del paciente'}
              className="min-h-[44px] lg:min-h-0 px-4 py-2 border border-outline-variant rounded-xl text-sm font-semibold text-on-surface hover:bg-surface-container-high flex items-center gap-1.5 disabled:opacity-40">
              <span className="material-symbols-outlined text-base">filter_center_focus</span>Foto fantasma
            </button>
            <label className="ml-auto flex items-center gap-2 text-xs text-on-surface-variant min-h-[44px] lg:min-h-0" title="Un pedal Bluetooth de pasar páginas envía Av Pág o flechas">
              <input type="checkbox" checked={f.pedalActivo} onChange={(e) => { f.setPedalActivo(e.target.checked); e.currentTarget.blur(); }} className="accent-primary w-4 h-4" data-testid="pedal-fotos" />
              <span className="material-symbols-outlined text-base">keyboard</span>Pedal o teclado: Av Pág o flechas toman la foto
            </label>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-2">En la tablet, "Tomar foto" abre la cámara. La foto queda en «Por guardar» con su vista previa: completa zona, lado y tipo, y pulsa «Guardar»; recién ahí pasa a «Fotos de esta atención».</p>
          <datalist id="zonas-foto">{f.sugerenciasZona.map((z) => <option key={z} value={z} />)}</datalist>
          {f.pendientes.length > 0 && (
            <div className="mt-4 space-y-3" data-testid="fotos-por-guardar">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-amber-800 flex items-center gap-1"><span className="material-symbols-outlined text-base">pending</span>Por guardar ({f.pendientes.length})</span>
                <span className="flex-1" />
                {f.pendientes.length > 1 && (
                  <button onClick={() => void f.guardarTodas()} disabled={f.guardando.length > 0} className="min-h-[44px] lg:min-h-0 px-4 py-2 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
                    <span className="material-symbols-outlined text-base">done_all</span>Guardar todas ({f.pendientes.length})
                  </button>
                )}
              </div>
              {f.pendientes.map((p) => <FotoPorGuardar key={p.id} p={p} f={f} />)}
            </div>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-3"><span className="material-symbols-outlined mr-2 text-primary">photo_library</span>Fotos de esta atención ({f.fotos.length})</h3>
        {f.fotos.length === 0 && <p className="text-sm text-on-surface-variant">Sin fotos en esta atención.{f.puedeEditar ? ' Toca «Tomar foto» arriba; la foto queda «por guardar» hasta que la guardes.' : ''}</p>}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {f.fotos.map((foto) => <MiniaturaFoto key={foto.id} foto={foto} puedeEditar={f.puedeEditar} onEliminar={() => quitar.pedir('¿Quitar esta foto?', 'Deja de verse en la historia (el archivo se conserva).', () => f.eliminarMut.mutate(foto.id))} onMedir={f.puedeEditar && foto.categoria === 'lesion' ? () => f.setFotoMedir(foto) : undefined} />)}
        </div>
      </section>
      {quitar.dialogo}

      <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center mb-1"><span className="material-symbols-outlined mr-2 text-primary">compare</span>Antes / después</h3>
        <p className="text-xs text-on-surface-variant mb-3">Compara dos fotos de la misma zona, de esta u otras atenciones del paciente. Ideal para mostrarle al paciente cómo va el tratamiento.</p>
        {f.todas.length < 2 ? (
          <p className="text-sm text-on-surface-variant">Se necesitan al menos dos fotos del paciente para comparar.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div><label className={LBL}>Zona</label>
                <select value={f.zonaComparar} onChange={(e) => f.elegirZona(e.target.value)} className={INPUT}>
                  <option value="">Todas las zonas</option>
                  {f.zonas.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div><label className={LBL}>Antes</label>
                <select value={f.antes?.id ?? ''} onChange={(e) => f.setAntesId(e.target.value)} className={INPUT}>
                  {f.enZona.map((x) => <option key={x.id} value={x.id}>{etiquetaFoto(x)}</option>)}
                </select>
              </div>
              <div><label className={LBL}>Después</label>
                <select value={f.despues?.id ?? ''} onChange={(e) => f.setDespuesId(e.target.value)} className={INPUT}>
                  {f.enZona.map((x) => <option key={x.id} value={x.id}>{etiquetaFoto(x)}</option>)}
                </select>
              </div>
            </div>
            {f.antes && f.despues && f.antes.id !== f.despues.id
              ? <ComparadorFotos urlAntes={antesUrl.url} urlDespues={despuesUrl.url} etiquetaAntes={`Antes · ${fmtFechaLima(f.antes.tomadaEn)}`} etiquetaDespues={`Después · ${fmtFechaLima(f.despues.tomadaEn)}`} />
              : <p className="text-sm text-on-surface-variant">Elige dos fotos distintas.</p>}
          </>
        )}
      </section>
      {f.fantasmaAbierta && <CamaraFantasma referencias={f.todas} onCapturar={f.capturarFantasma} onClose={() => f.setFantasmaAbierta(false)} />}
      {f.fotoMedir && (
        <MedidorUlcera fotoId={f.fotoMedir.id} titulo={`${f.fotoMedir.zona || 'Foto'}${f.fotoMedir.pie ? ` · ${PIE_LABEL[f.fotoMedir.pie]}` : ''} · ${fmtFecha(f.fotoMedir.tomadaEn)}`}
          guardando={f.medirMut.isPending} onClose={() => f.setFotoMedir(null)} onGuardar={(m) => f.medirMut.mutate({ foto: f.fotoMedir!, ...m })} />
      )}
    </div>
  );
}
