import { useState } from 'react';
import type { AtencionCompleta } from '../../api/historiaClinica';
import { TIPO_DOC_LABEL, TIPO_ITEM_LABEL, type TipoDocumentoReceta } from '../../api/recetas';
import { useEmitirRecetaForm, type ItemBorrador } from '../../services/historiaClinicaService';
import { AlergiasBanner } from './AlergiasBanner';
import { BuscadorMedicamento } from './Buscadores';

const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-2.5 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-0.5';
const ETIQ: Record<string, string> = { MEDICAMENTO_RX: 'bg-rose-100 text-rose-700', MEDICAMENTO_OTC: 'bg-emerald-100 text-emerald-700', PRODUCTO: 'bg-amber-100 text-amber-800', SERVICIO: 'bg-primary/10 text-primary' };
const ICONO: Record<string, string> = { MEDICAMENTO_RX: 'pill', MEDICAMENTO_OTC: 'pill', PRODUCTO: 'inventory_2', SERVICIO: 'medical_services' };

// Emitir RECETA MÉDICA (solo médico) o INDICACIONES PODOLÓGICAS (a nombre del profesional que atendió).
// Modelo: el DIAGNÓSTICO es el ancla. Se elige "para qué diagnóstico" y todo lo que se agrega
// (servicio, medicamento o producto) queda agrupado bajo él, igual que en el documento impreso.
export function EmitirRecetaModal({ atencion, tipoDocumento, onClose }: { atencion: AtencionCompleta; tipoDocumento: TipoDocumentoReceta; onClose: () => void }) {
  const f = useEmitirRecetaForm(atencion, tipoDocumento);
  const [servicioSel, setServicioSel] = useState('');
  const [productoManual, setProductoManual] = useState('');
  const [favSel, setFavSel] = useState('');
  const [nombreFav, setNombreFav] = useState('');
  const sinDx = f.diagnosticos.length === 0;
  const dxActivoDesc = f.diagnosticos.find((d) => d.cie10Codigo === f.dxActivo);

  const opcionesDx = () => (
    <>
      {f.diagnosticos.map((d) => (
        <option key={d.id} value={d.cie10Codigo}>{d.cie10Codigo} · {d.cie10.descripcion}</option>
      ))}
      <option value="">Sin diagnóstico</option>
    </>
  );

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-surface-container-lowest w-full max-w-[900px] max-h-[92vh] rounded-2xl flex flex-col overflow-hidden custom-shadow animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
        <div className="bg-[#0044ab] text-white px-6 py-5 flex justify-between items-start shrink-0 shadow-md">
          <div>
            <h3 className="font-headline-md text-headline-md font-bold flex items-center gap-2"><span className="material-symbols-outlined">{f.esReceta ? 'prescriptions' : 'clinical_notes'}</span>{TIPO_DOC_LABEL[tipoDocumento]}</h3>
            <p className="text-sm text-white/80 mt-1">{atencion.paciente.apellidoPaterno} {atencion.paciente.apellidoMaterno}, {atencion.paciente.nombres} · {atencion.servicio.nombre} · {atencion.sede.nombre}</p>
          </div>
          <button onClick={onClose} className="material-symbols-outlined text-white/80 hover:text-white text-xl">close</button>
        </div>

        {f.emitida ? (
          <div className="p-8 flex flex-col items-center text-center gap-4">
            <span className="material-symbols-outlined text-6xl text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <h4 className="font-headline-sm text-headline-sm font-bold text-on-surface">{TIPO_DOC_LABEL[tipoDocumento]} N° {String(f.emitida.numero).padStart(6, '0')} emitida</h4>
            <p className="text-sm text-on-surface-variant">Código de verificación <b className="font-mono-label">{f.emitida.codigoVerificacion}</b> · {f.emitida.items.length} ítem(s)</p>
            {f.esReceta && <p className="text-xs text-on-surface-variant -mt-2">El PDF trae el original para el paciente y una copia para la farmacia, con QR de verificación.</p>}
            {!!f.emitida.advertencias?.length && (
              <div className="w-full max-w-md rounded-xl border border-error/30 bg-error-container text-on-error-container text-xs px-4 py-3 text-left">
                <b>Advertencia de alergia:</b> {f.emitida.advertencias.map((a) => `${a.item} ↔ ${a.sustancia}`).join('; ')}
              </div>
            )}
            <div className="flex gap-3 mt-2">
              <button onClick={f.abrirPdf} className="px-5 py-2.5 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high flex items-center gap-2"><span className="material-symbols-outlined text-base">picture_as_pdf</span>Ver PDF</button>
              <button onClick={f.imprimir} className="px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 flex items-center gap-2"><span className="material-symbols-outlined text-base">print</span>Imprimir</button>
              <button onClick={onClose} className="px-5 py-2.5 text-primary font-bold text-sm hover:underline">Cerrar</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
              <AlergiasBanner alergias={f.alergias} />
              {!f.esReceta && (
                <p className="text-xs text-on-surface-variant bg-surface-container-low/60 border border-outline-variant/20 rounded-xl px-3 py-2">
                  Solo tratamiento <b>de venta libre</b>, productos y servicios. Los fármacos bajo receta van en una Receta Médica firmada por médico.
                  {' '}Se emite a nombre de <b>{atencion.profesional.nombres} {atencion.profesional.apellidos}</b>.
                </p>
              )}

              {/* Atajo · repetir una anterior del paciente o usar una favorita (se revisa antes de emitir) */}
              {(f.anteriores.length > 0 || f.favoritas.length > 0) && (
                <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low/40 p-4 grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="atajos-receta">
                  <div>
                    <label className={LBL}>Repetir una anterior del paciente</label>
                    <select value="" disabled={f.repetirMut.isPending || f.anteriores.length === 0} onChange={(e) => { if (e.target.value) f.repetirMut.mutate(e.target.value); }} className={INPUT} data-testid="repetir-receta">
                      <option value="">{f.anteriores.length ? (f.repetirMut.isPending ? 'Cargando…' : '— Elegir para repetir —') : 'Sin documentos anteriores'}</option>
                      {f.anteriores.map((r) => (
                        <option key={r.id} value={r.id}>
                          N° {String(r.numero).padStart(6, '0')} · {new Date(r.fechaEmision).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })} · {r.items.map((i) => i.nombre).join(', ')}{r._count.items > r.items.length ? '…' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LBL}>Usar una favorita</label>
                    <div className="flex gap-2">
                      <select value={favSel} disabled={f.favoritas.length === 0} onChange={(e) => { setFavSel(e.target.value); if (e.target.value) f.usarFavorita(e.target.value); }} className={INPUT} data-testid="usar-favorita">
                        <option value="">{f.favoritas.length ? '— Elegir favorita —' : 'Aún no hay favoritas'}</option>
                        {f.favoritas.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({x.items.length})</option>)}
                      </select>
                      {favSel && (
                        <button type="button" title="Quitar esta favorita de la lista" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-xl"
                          onClick={() => { if (window.confirm('¿Quitar esta favorita de la lista? Las recetas ya emitidas no cambian.')) { f.eliminarFavoritaMut.mutate(favSel); setFavSel(''); } }}>delete</button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Paso 1 · ¿Para qué diagnóstico? — el ancla de todo lo que se agregue */}
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center shrink-0">1</span>
                  <span className="font-semibold text-on-surface text-sm">¿Para qué diagnóstico prescribes?</span>
                </div>
                {sinDx ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Esta atención aún no tiene diagnósticos. Agrega uno en la pestaña <b>Evolución</b> para que el tratamiento quede agrupado por diagnóstico. Puedes continuar sin diagnóstico, pero es preferible registrarlo.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {f.diagnosticos.map((d) => (
                        <button key={d.id} type="button" onClick={() => f.setDxActivo(d.cie10Codigo)}
                          className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${f.dxActivo === d.cie10Codigo ? 'border-primary bg-primary text-on-primary shadow-sm' : 'border-outline-variant/40 text-on-surface hover:bg-surface-container-low'}`}>
                          <b>{d.cie10Codigo}</b> · {d.cie10.descripcion}{d.principal ? ' ★' : ''}
                        </button>
                      ))}
                      <button type="button" onClick={() => f.setDxActivo(null)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${f.dxActivo === null ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low'}`}>
                        Sin diagnóstico
                      </button>
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-2">Lo que agregues abajo se guarda bajo <b>{f.dxActivo ? `${f.dxActivo} · ${dxActivoDesc?.cie10.descripcion ?? ''}` : 'sin diagnóstico'}</b>. Para prescribir por otro diagnóstico, cámbialo aquí y sigue agregando.</p>
                  </>
                )}
              </div>

              {/* Paso 2 · Agregar medicamento / servicio / producto (bajo el diagnóstico activo) */}
              <div className="rounded-2xl border border-outline-variant/30 p-4">
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="w-5 h-5 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center shrink-0">2</span>
                  <span className="font-semibold text-on-surface text-sm">Agregar medicamentos, servicios y productos</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className={LBL}>Medicamento (genérico o marca)</label>
                    <BuscadorMedicamento onSeleccionar={f.agregarMedicamento} onManual={(n) => f.agregarManual(n)} soloVentaLibre={!f.esReceta} />
                  </div>
                  {!f.esReceta ? (
                    <div>
                      <label className={LBL}>Servicio de la clínica</label>
                      <select value={servicioSel} onChange={(e) => { f.agregarServicio(e.target.value); setServicioSel(''); }} className={INPUT}>
                        <option value="">— Elegir —</option>
                        {f.servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className={LBL}>Vigencia (días)</label>
                      <input type="number" min={1} max={365} value={f.vigenciaDias} onChange={(e) => f.setVigenciaDias(Number(e.target.value) || 30)} className={INPUT} />
                    </div>
                  )}
                  {!f.esReceta && (
                    <div className="md:col-span-3 flex gap-2">
                      <input value={productoManual} onChange={(e) => setProductoManual(e.target.value)} placeholder="Producto de cuidado (ej. desinfectante de calzado, quitaesmalte sin acetona)" className={INPUT}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); f.agregarManual(productoManual, 'PRODUCTO'); setProductoManual(''); } }} />
                      <button type="button" onClick={() => { f.agregarManual(productoManual, 'PRODUCTO'); setProductoManual(''); }} className="px-4 py-2 border border-outline-variant rounded-lg text-sm font-semibold hover:bg-surface-container-high shrink-0">+ Producto</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Paso 3 · Revisión — ítems agrupados por diagnóstico (como se imprimen) */}
              {f.items.length === 0 ? (
                <div className="text-center text-sm text-on-surface-variant py-8 border border-dashed border-outline-variant/40 rounded-xl">Aún no hay ítems. Elige el diagnóstico y agrega un medicamento{f.esReceta ? '' : ', un servicio o un producto'}.</div>
              ) : (
                <div className="space-y-4">
                  {f.grupos.map((g) => (
                    <div key={g.codigo || 'sin'} className="rounded-2xl border border-outline-variant/30 overflow-hidden">
                      <div className="bg-[#0A4B8C] text-white px-4 py-2 text-sm font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-base">diagnosis</span>
                        {g.codigo ? `${g.codigo} · ${g.descripcion.toUpperCase()}` : 'SIN DIAGNÓSTICO ASOCIADO'}
                        <span className="ml-auto text-white/70 text-[11px] font-semibold">{g.items.length} ítem(s)</span>
                      </div>
                      <div className="divide-y divide-outline-variant/15">
                        {g.items.map((it: ItemBorrador, idx: number) => (
                          <div key={it.key} className="p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-primary text-sm w-5">{idx + 1}</span>
                              <span className="material-symbols-outlined text-base text-on-surface-variant/70">{ICONO[it.tipo ?? 'MEDICAMENTO_OTC']}</span>
                              <span className="font-semibold text-on-surface text-sm flex-1 truncate">{it.etiqueta}</span>
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${ETIQ[it.tipo ?? 'MEDICAMENTO_OTC']}`}>{TIPO_ITEM_LABEL[it.tipo ?? 'MEDICAMENTO_OTC']}</span>
                              {f.diagnosticos.length > 1 && (
                                <select title="Mover a otro diagnóstico" value={it.diagnosticoCie10Codigo ?? ''} onChange={(e) => f.actualizarItem(it.key, { diagnosticoCie10Codigo: e.target.value || null })} className="text-[11px] bg-surface-container-low border border-outline-variant/40 rounded-md px-1.5 py-1 max-w-[130px]">
                                  {opcionesDx()}
                                </select>
                              )}
                              <button type="button" onClick={() => f.quitarItem(it.key)} className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 pl-7">
                              {it.tipo !== 'SERVICIO' && <div><label className={LBL}>Marca (se imprime)</label><input value={it.marcaImpresa ?? ''} onChange={(e) => f.actualizarItem(it.key, { marcaImpresa: e.target.value })} className={INPUT} /></div>}
                              <div><label className={LBL}>Cantidad</label><input value={it.cantidad ?? ''} onChange={(e) => f.actualizarItem(it.key, { cantidad: e.target.value })} placeholder={it.tipo === 'SERVICIO' ? '12 sesiones' : '1 frasco'} className={INPUT} /></div>
                              {it.tipo !== 'SERVICIO' && it.tipo !== 'PRODUCTO' && <div><label className={LBL}>Dosis</label><input value={it.dosis ?? ''} onChange={(e) => f.actualizarItem(it.key, { dosis: e.target.value })} placeholder="1 cápsula" className={INPUT} /></div>}
                              {it.tipo !== 'SERVICIO' && it.tipo !== 'PRODUCTO' && <div><label className={LBL}>Vía</label><input value={it.via ?? ''} onChange={(e) => f.actualizarItem(it.key, { via: e.target.value })} placeholder="oral" className={INPUT} /></div>}
                              <div><label className={LBL}>Frecuencia</label><input value={it.frecuencia ?? ''} onChange={(e) => f.actualizarItem(it.key, { frecuencia: e.target.value })} placeholder={it.tipo === 'SERVICIO' ? '1 vez por semana' : 'cada 12 h'} className={INPUT} /></div>
                              <div><label className={LBL}>Duración</label><input value={it.duracion ?? ''} onChange={(e) => f.actualizarItem(it.key, { duracion: e.target.value })} placeholder={it.tipo === 'SERVICIO' ? '12 semanas' : '14 días'} className={INPUT} /></div>
                              <div className="col-span-2 md:col-span-6"><label className={LBL}>Indicaciones {it.tipo === 'SERVICIO' ? 'del servicio' : ''}</label>
                                <input value={it.indicaciones ?? ''} onChange={(e) => f.actualizarItem(it.key, { indicaciones: e.target.value })} placeholder={it.tipo === 'SERVICIO' ? 'Ej. Aplicar 1 vez por semana; evaluar respuesta al mes.' : 'Ej. Tomar con el desayuno y la cena.'} className={INPUT} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {f.items.length > 0 && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[220px]">
                    <label className={LBL}>Guardar como favorita (para reutilizarla)</label>
                    <input value={nombreFav} onChange={(e) => setNombreFav(e.target.value)} maxLength={80} placeholder="Ej. Onicomicosis leve · tratamiento tópico" className={INPUT} data-testid="nombre-favorita" />
                  </div>
                  <button type="button" disabled={nombreFav.trim().length < 2 || f.guardarFavoritaMut.isPending}
                    onClick={() => { f.guardarFavoritaMut.mutate(nombreFav.trim()); setNombreFav(''); }}
                    className="px-4 py-2 border border-primary/40 text-primary rounded-lg text-sm font-semibold hover:bg-primary/5 disabled:opacity-40 flex items-center gap-1">
                    <span className="material-symbols-outlined text-base">star</span>Guardar favorita
                  </button>
                </div>
              )}

              <div>
                <label className={LBL}>Indicaciones generales (para todo el documento)</label>
                <textarea value={f.indicacionesGenerales} onChange={(e) => f.setIndicacionesGenerales(e.target.value)} rows={2} maxLength={1500} className={INPUT} placeholder={f.esReceta ? 'Ej. Suspender y consultar ante molestias digestivas intensas o ictericia.' : 'Ej. Mantener los pies secos; volver a control en 15 días.'} />
              </div>
            </div>
            <div className="p-5 border-t border-outline-variant/30 flex gap-3 bg-surface-container-low/40 shrink-0">
              <button type="button" onClick={onClose} className="flex-1 px-5 py-2.5 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer">Cancelar</button>
              <button type="button" onClick={() => f.emitirMut.mutate()} disabled={!f.puedeGuardar || f.emitirMut.isPending}
                className="flex-1 px-5 py-2.5 bg-primary text-on-primary rounded-xl font-bold text-sm shadow-md shadow-primary/20 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer">
                {f.emitirMut.isPending ? 'Emitiendo…' : f.esReceta ? 'Emitir receta médica' : 'Emitir indicaciones'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
