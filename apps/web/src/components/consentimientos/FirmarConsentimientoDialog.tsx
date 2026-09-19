// Firmar un consentimiento informado en la tablet, EN CUALQUIER MOMENTO: desde la cita en la agenda
// (antes de la atención), dentro de la atención o desde la historia. Vista pura: la lógica vive en
// services/firmarConsentimientoService.ts.
import { useState } from 'react';
import type { OrigenFirma } from '../../api/consentimientos';
import { useFirmarConsentimiento, verConsentimientoPdf } from '../../services/firmarConsentimientoService';
import { FirmaPad } from '../historiaClinica/FirmaPad';
import { DocumentoConsentimiento } from './DocumentoConsentimiento';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';
const BLOQUE = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 space-y-3';
const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });

export function FirmarConsentimientoDialog({ origen, plantillaInicial, onClose }: { origen: OrigenFirma; plantillaInicial?: string | null; onClose: () => void }) {
  const [listo, setListo] = useState<{ id: string; numero: number } | null>(null);
  const f = useFirmarConsentimiento(origen, { plantillaInicial, onListo: setListo });
  const c = f.plantilla?.contenido ?? null;

  return (
    <div className="fixed inset-0 z-[125] bg-black/45 flex items-stretch lg:items-center justify-center lg:p-4" onClick={onClose}>
      <div className="bg-surface w-full lg:max-w-4xl lg:rounded-3xl shadow-2xl flex flex-col max-h-screen lg:max-h-[94vh]" onClick={(e) => e.stopPropagation()} data-testid="dialogo-firmar-consentimiento">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-outline-variant/30">
          <span className="material-symbols-outlined text-primary text-2xl">contract_edit</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-on-surface">Consentimiento informado</h3>
            {f.ctx && (
              <p className="text-xs text-on-surface-variant truncate">
                {f.nombrePaciente} · {f.ctx.paciente.tipoDocumento} {f.ctx.paciente.numeroDocumento}
                {f.ctx.historiaNumero != null && <> · HC N° {String(f.ctx.historiaNumero).padStart(6, '0')}</>}
                {f.ctx.sede && <> · Sede {f.ctx.sede.nombre}</>}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface" aria-label="Cerrar"><span className="material-symbols-outlined">close</span></button>
        </header>

        {listo ? (
          <div className="p-8 text-center space-y-4" data-testid="consentimiento-listo">
            <span className="material-symbols-outlined text-5xl text-emerald-600">task_alt</span>
            <p className="text-lg font-bold text-on-surface">Consentimiento N° {String(listo.numero).padStart(5, '0')} firmado</p>
            <p className="text-sm text-on-surface-variant">Quedó en la historia clínica. Imprime los dos ejemplares: uno se archiva y el otro se entrega al paciente (ahí va la huella digital).</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => verConsentimientoPdf(listo.id)} className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold flex items-center gap-2"><span className="material-symbols-outlined text-base">print</span>Ver e imprimir (2 ejemplares)</button>
              <button onClick={onClose} className="px-5 py-2.5 border border-outline-variant rounded-xl text-sm font-bold text-on-surface">Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4">
              {f.cargando && <p className="text-sm text-on-surface-variant">Cargando…</p>}
              {f.error && <p className="text-sm text-rose-700">{f.error.message}</p>}
              {f.ctx && (
                <>
                  {/* 1 · Qué consentimiento (primero los que exige el tratamiento de la cita) */}
                  <div className={BLOQUE}>
                    <p className={LBL}>Consentimiento</p>
                    {f.ctx.plantillas.length === 0 && <p className="text-sm text-on-surface-variant">No hay plantillas de consentimiento activas.</p>}
                    <div className="flex flex-wrap gap-2">
                      {f.ctx.plantillas.map((p) => (
                        <button key={p.id} type="button" onClick={() => f.setPlantillaId(p.id)} data-testid={`plantilla-${p.clave ?? p.id}`}
                          className={`text-left px-3 py-2 rounded-xl border text-sm ${f.plantilla?.id === p.id ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-variant/50 text-on-surface hover:border-primary/60'}`}>
                          {p.nombre}
                          {p.requerida && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Para este tratamiento</span>}
                          {p.firmado && <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">Firmado el {fmt(p.firmado.firmadoEn)}</span>}
                          {!p.oficial && <span className="ml-2 text-[10px] text-on-surface-variant">(texto de muestra)</span>}
                        </button>
                      ))}
                    </div>
                    {f.plantilla?.firmado && <p className="text-xs text-emerald-800">Ya hay uno vigente (N° {String(f.plantilla.firmado.numero).padStart(5, '0')}). Puedes firmar otro si el procedimiento cambió.</p>}
                  </div>

                  {f.plantilla && (
                    <>
                      {/* 2 · Quién firma */}
                      <div className={BLOQUE}>
                        <div className="flex flex-wrap gap-2">
                          {(['paciente', 'apoderado'] as const).map((r) => (
                            <button key={r} type="button" onClick={() => f.setRelacion(r)} data-testid={`firmante-${r}`}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${f.relacion === r ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant text-on-surface-variant'}`}>
                              {r === 'paciente' ? 'Firma el paciente' : 'Firma su representante legal'}
                            </button>
                          ))}
                        </div>
                        {f.relacion === 'apoderado' && (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div><label className={LBL}>Nombres del representante</label><input value={f.repNombre} onChange={(e) => f.setRepNombre(e.target.value)} maxLength={200} className={INPUT} data-testid="rep-nombre" /></div>
                            <div><label className={LBL}>Documento</label><input value={f.repDocumento} onChange={(e) => f.setRepDocumento(e.target.value)} maxLength={20} className={INPUT} data-testid="rep-documento" /></div>
                            <div><label className={LBL}>Parentesco o vínculo</label><input value={f.repParentesco} onChange={(e) => f.setRepParentesco(e.target.value)} maxLength={80} placeholder="Madre, padre, tutor…" className={INPUT} data-testid="rep-parentesco" /></div>
                          </div>
                        )}
                        {f.oficial && (
                          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
                            <div><label className={LBL}>Domicilio (opcional)</label><input value={f.domicilio} onChange={(e) => f.setDomicilio(e.target.value)} maxLength={300} className={INPUT} data-testid="domicilio" /></div>
                            <div><label className={LBL}>Teléfono de contacto</label><input value={f.telefono} onChange={(e) => f.setTelefono(e.target.value)} maxLength={30} className={INPUT} /></div>
                          </div>
                        )}
                      </div>

                      {/* 3 · Lo que completa el profesional */}
                      {c && (
                        <div className={BLOQUE}>
                          <p className={LBL}>Lo completa el profesional tratante</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {c.campos.dedos && <div><label className={LBL}>Dedo o dedos a intervenir</label><input value={f.dedos} onChange={(e) => f.setDedos(e.target.value)} maxLength={200} placeholder="Ej. 1er dedo pie derecho, borde externo" className={INPUT} data-testid="dedos" /></div>}
                            {c.campos.alcance.length > 0 && (
                              <div>
                                <label className={LBL}>Alcance</label>
                                <div className="flex flex-wrap gap-2">
                                  {c.campos.alcance.map((a) => (
                                    <button key={a} type="button" onClick={() => f.setAlcance(a)} data-testid={`alcance-${a}`}
                                      className={`px-3 py-2 rounded-lg text-sm border ${f.alcance === a ? 'border-primary bg-primary/10 text-primary font-semibold' : 'border-outline-variant text-on-surface'}`}>{a}</button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div>
                            <label className={LBL}>Riesgos particulares en su caso</label>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                              {c.riesgosParticulares.map((r) => (
                                <label key={r} className="flex items-center gap-2 text-sm text-on-surface cursor-pointer py-1">
                                  <input type="checkbox" checked={f.riesgos.includes(r)} onChange={() => f.alternarRiesgo(r)} className="w-5 h-5 lg:w-4 lg:h-4" data-testid="riesgo-particular" />
                                  <span>{r}</span>
                                  {f.plantilla?.riesgosSugeridos.includes(r) && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-800" title="La historia clínica lo registra">según la historia</span>}
                                </label>
                              ))}
                            </div>
                            <input value={f.otraCondicion} onChange={(e) => f.setOtraCondicion(e.target.value)} maxLength={300} placeholder="Otra condición (opcional)" className={INPUT + ' mt-2'} />
                          </div>
                        </div>
                      )}

                      {/* 4 · El documento que se lee */}
                      <div className={BLOQUE}>
                        <p className={LBL}>Entregue la tablet {f.relacion === 'paciente' ? 'al paciente' : 'al representante'}: que lea el documento</p>
                        {c ? (
                          <div className="max-h-[55vh] overflow-y-auto pr-1">
                            <DocumentoConsentimiento c={c} riesgosMarcados={f.riesgos} otraCondicion={f.otraCondicion} dedos={f.dedos} alcance={f.alcance} />
                          </div>
                        ) : (
                          <>
                            <div><label className={LBL}>Procedimiento que se autoriza</label><input value={f.procedimientoLibre} onChange={(e) => f.setProcedimientoLibre(e.target.value)} maxLength={300} className={INPUT} /></div>
                            {f.textoEditado === null
                              ? <div className="rounded-xl bg-surface-container-low/60 border border-outline-variant/30 px-4 py-3 text-sm leading-relaxed whitespace-pre-line max-h-72 overflow-y-auto">{f.textoLibre}</div>
                              : <textarea value={f.textoEditado} onChange={(e) => f.setTextoEditado(e.target.value)} rows={10} maxLength={20000} className={INPUT} />}
                            <button type="button" onClick={() => f.setTextoEditado(f.textoEditado === null ? f.textoLibre : null)} className="text-xs text-primary font-semibold hover:underline">{f.textoEditado === null ? 'Ajustar texto' : 'Deshacer mis cambios'}</button>
                          </>
                        )}
                      </div>

                      {/* 5 · Firmas */}
                      <div className={BLOQUE}>
                        <p className={LBL}>{f.relacion === 'paciente' ? `Firma del paciente · ${f.nombrePaciente}` : `Firma del representante legal${f.repNombre.trim() ? ` · ${f.repNombre.trim()}` : ''}`}</p>
                        <FirmaPad trazos={f.firma} onChange={f.setFirma} deshabilitado={f.firmarMut.isPending} />
                      </div>
                      <div className={BLOQUE}>
                        <p className={LBL}>Firma del profesional tratante (opcional){f.ctx.profesional ? ` · ${f.ctx.profesional.nombre}${f.ctx.profesional.colegiatura ? ` · ${f.ctx.profesional.colegiatura}` : ''}` : ''}</p>
                        <p className="text-xs text-on-surface-variant -mt-1">Si no firma aquí, firma y sella el ejemplar impreso.</p>
                        <FirmaPad trazos={f.firmaProfesional} onChange={f.setFirmaProfesional} deshabilitado={f.firmarMut.isPending} />
                      </div>
                      <div className={BLOQUE}>
                        <label className="flex items-center gap-2 text-sm font-semibold text-on-surface cursor-pointer">
                          <input type="checkbox" checked={f.conTestigo} onChange={(e) => f.setConTestigo(e.target.checked)} className="w-5 h-5 lg:w-4 lg:h-4" data-testid="con-testigo" />Firma un testigo (opcional)
                        </label>
                        {f.conTestigo && (
                          <>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div><label className={LBL}>Nombre del testigo</label><input value={f.testigoNombre} onChange={(e) => f.setTestigoNombre(e.target.value)} maxLength={200} className={INPUT} /></div>
                              <div><label className={LBL}>DNI</label><input value={f.testigoDocumento} onChange={(e) => f.setTestigoDocumento(e.target.value)} maxLength={20} className={INPUT} /></div>
                            </div>
                            <FirmaPad trazos={f.firmaTestigo} onChange={f.setFirmaTestigo} deshabilitado={f.firmarMut.isPending} />
                          </>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <footer className="px-5 py-3 border-t border-outline-variant/30 flex flex-wrap items-center gap-3 bg-surface-container-low/40">
              {f.faltantes.length > 0 && <span className="text-xs text-on-surface-variant flex-1 min-w-[200px]" data-testid="faltantes-consentimiento">Falta {f.faltantes.join(', ')}.</span>}
              <span className="flex-1" />
              <button type="button" onClick={onClose} className="px-4 py-2 border border-outline-variant rounded-xl text-sm font-bold text-on-surface hover:bg-surface-container-high">Cancelar</button>
              <button type="button" disabled={f.faltantes.length > 0 || f.firmarMut.isPending} onClick={() => f.firmarMut.mutate()} data-testid="registrar-consentimiento"
                className="px-5 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold disabled:opacity-50">{f.firmarMut.isPending ? 'Guardando…' : 'Registrar consentimiento firmado'}</button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
