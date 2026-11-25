import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { historiaClinicaApi, type AtencionCompleta } from '../../api/historiaClinica';
import { abrirPdfEnPestana } from '../../api/recetas';
import { useGuardadoSolo } from './useGuardadoSolo';
import { TRATAMIENTOS_FISIO, MAX_COMENTARIO_FISIO, MAX_PATOLOGIAS_HOJA, planDeProcedimientos, planAEnvio, patologiasEnHoja, type PlanFisio, type PatologiaHoja } from './tratamientoFisio';

/** Una patología del historial del paciente: de qué atención viene (la más reciente donde se registró). */
export interface PatologiaPrevia extends PatologiaHoja { fecha: string; servicio: string }

const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const INPUT = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 lg:py-2 text-base lg:text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all';
const LBL = 'block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1';

/**
 * «Tratamiento» de la atención de Fisioterapia (25-nov-2026): la tabla de la hoja «Evaluación fisioterapéutica». La licenciada
 * marca lo que se hará, escribe UN comentario general y el N.º de sesiones; se guarda solo y se imprime la hoja (media hoja).
 * Cada tratamiento marcado es un procedimiento de la atención (ver `tratamientoFisio.ts`).
 *
 * Arriba, las PATOLOGÍAS que saldrán en la hoja: los diagnósticos de esta atención (se puede quitar alguno de la hoja) y las
 * que el paciente ya tiene de otras atenciones, de cualquier servicio (`patologiasPrevias`; se agregan con un toque).
 */
export function PanelTratamientoFisio({ a, puedeRegistrar, patologiasPrevias = [] }: { a: AtencionCompleta; puedeRegistrar: boolean; patologiasPrevias?: PatologiaPrevia[] }) {
  const { valor: plan, cambiar, estado, textoEstado, editable } = useGuardadoSolo<PlanFisio>(a, puedeRegistrar, {
    leer: (at) => planDeProcedimientos(at.procedimientos),
    fuente: a.procedimientos,
    guardar: (id, p) => historiaClinicaApi.guardarTratamientoFisio(id, planAEnvio(p)),
    queNoSeGuardo: 'No se guardó el tratamiento',
  });
  const [abriendo, setAbriendo] = useState(false);
  const marcados = TRATAMIENTOS_FISIO.filter((t) => plan.marcados.includes(t.clave));
  const nMarcados = marcados.length;

  // Lo marcado en la atención de fisio anterior: en la evaluación se decide el plan y en cada sesión se repite.
  const { data: anterior } = useQuery({
    queryKey: ['tratamiento-fisio-anterior', a.id],
    queryFn: () => historiaClinicaApi.tratamientoFisioAnterior(a.id),
    enabled: editable,
    staleTime: 5 * 60_000,
  });

  const alternar = (clave: string) => cambiar({ ...plan, marcados: plan.marcados.includes(clave) ? plan.marcados.filter((c) => c !== clave) : [...plan.marcados, clave] });
  const usarAnterior = () => {
    if (!anterior) return;
    // Las patologías que se habían AGREGADO a la hoja también se repiten; lo quitado era de los diagnósticos de aquella atención.
    cambiar({ marcados: anterior.tratamientos.map((t) => t.clave), comentario: anterior.comentario ?? '', sesiones: anterior.sesiones, dxExtra: anterior.patologias?.incluir ?? [], dxFuera: [] });
  };

  // ── Patologías de la hoja ──
  const dxAtencion: PatologiaHoja[] = a.diagnosticos.map((d) => ({ codigo: d.cie10.codigo, descripcion: d.cie10.descripcion }))
    .filter((d, i, l) => l.findIndex((x) => x.codigo === d.codigo) === i);
  const deOtras: (PatologiaHoja & { origen: string | null })[] = [
    ...patologiasPrevias.map((d) => ({ codigo: d.codigo, descripcion: d.descripcion, origen: `${fmtFecha(d.fecha)} · ${d.servicio}` })),
    // Lo ya agregado que no está en la lista de arriba (p. ej. copiado de la sesión anterior) no se pierde de vista.
    ...plan.dxExtra.filter((d) => !patologiasPrevias.some((x) => x.codigo === d.codigo)).map((d) => ({ ...d, origen: null })),
  ].filter((d) => !dxAtencion.some((x) => x.codigo === d.codigo));
  const enHoja = patologiasEnHoja(dxAtencion, plan);
  const alternarDeAtencion = (codigo: string) => cambiar({ ...plan, dxFuera: plan.dxFuera.includes(codigo) ? plan.dxFuera.filter((c) => c !== codigo) : [...plan.dxFuera, codigo] });
  const alternarDeOtras = (d: PatologiaHoja) => {
    const esta = plan.dxExtra.some((x) => x.codigo === d.codigo);
    if (!esta && plan.dxExtra.length >= MAX_PATOLOGIAS_HOJA) { toast.error(`Como máximo ${MAX_PATOLOGIAS_HOJA} patologías agregadas`); return; }
    cambiar({ ...plan, dxExtra: esta ? plan.dxExtra.filter((x) => x.codigo !== d.codigo) : [...plan.dxExtra, { codigo: d.codigo, descripcion: d.descripcion }] });
  };
  const eligioPatologias = plan.dxExtra.length > 0 || plan.dxFuera.length > 0;
  /**
   * Una patología como ETIQUETA que se enciende y se apaga (no como casilla: las casillas son de los tratamientos, y así no
   * se confunden). Encendida = verde azulado, con ✓: sale en la hoja. Apagada = borde punteado, con +: no sale.
   */
  const etiqueta = (d: PatologiaHoja, enLaHoja: boolean, alCambiar: () => void, origen: string | null) => (
    <button key={d.codigo} type="button" onClick={alCambiar} aria-pressed={enLaHoja} data-patologia={d.codigo} data-en-hoja={enLaHoja ? 'si' : 'no'}
      title={enLaHoja ? 'Sale en la hoja. Toca para quitarla.' : 'No sale en la hoja. Toca para agregarla.'}
      className={`inline-flex items-center gap-1.5 max-w-full min-h-[32px] pl-1.5 pr-2.5 py-1 rounded-full border text-left transition-colors ${enLaHoja
        ? 'bg-teal-700 border-teal-700 text-white'
        : 'bg-white border-dashed border-teal-700/50 text-teal-900 hover:bg-teal-50'}`}>
      <span className={`material-symbols-outlined text-sm leading-none shrink-0 rounded-full ${enLaHoja ? 'bg-white/20' : 'text-teal-700'}`}>{enLaHoja ? 'check' : 'add'}</span>
      <span className="min-w-0 text-xs leading-tight">
        <span className={`font-mono text-[10px] font-bold mr-1 ${enLaHoja ? 'text-teal-100' : 'text-teal-700'}`}>{d.codigo}</span>
        <span className="font-semibold">{d.descripcion}</span>
        {origen && <span className={`ml-1.5 text-[10px] font-normal ${enLaHoja ? 'text-teal-100' : 'text-teal-800/70'}`}>· {origen}</span>}
      </span>
    </button>
  );
  const ROTULO_GRUPO = 'text-[9px] font-bold uppercase tracking-wide text-teal-800/70 mb-1';
  /** Tarjeta aparte, de otro color que la de tratamientos, con una vista previa del renglón tal como saldrá impreso. */
  const tarjetaPatologias = (
    <section className="rounded-xl border border-teal-700/25 border-l-4 border-l-teal-700 bg-teal-50/60 px-3 py-2.5" data-testid="patologias-hoja">
      {/* Compacta a propósito (pedido del dueño): es un complemento de la tarjeta de Tratamiento, no otra sección grande */}
      <div className="flex flex-wrap items-baseline gap-x-2 mb-2">
        <h3 className="text-sm font-bold text-teal-900 flex items-center">
          <span className="material-symbols-outlined mr-1.5 text-base text-teal-700 self-center">diagnosis</span>Patologías para la hoja impresa
        </h3>
        <p className="text-[11px] text-teal-900/70">
          {editable ? 'Toca para poner o quitar. No cambia los diagnósticos de la historia.' : 'Las que salen en la hoja de esta atención.'}
        </p>
      </div>
      {editable ? (
        <>
          {dxAtencion.length === 0 && deOtras.length === 0 && (
            <p className="text-xs text-teal-900/80">Esta atención todavía no tiene diagnóstico y el paciente no tiene otros registrados. Agrégalo en «3 · Diagnóstico» y aparecerá aquí.</p>
          )}
          {dxAtencion.length > 0 && (
            <div data-testid="patologias-de-atencion">
              <p className={ROTULO_GRUPO}>De esta atención</p>
              <div className="flex flex-wrap gap-1.5">{dxAtencion.map((d) => etiqueta(d, !plan.dxFuera.includes(d.codigo), () => alternarDeAtencion(d.codigo), null))}</div>
            </div>
          )}
          {deOtras.length > 0 && (
            <div className={dxAtencion.length ? 'mt-2' : ''} data-testid="patologias-de-otras">
              <p className={ROTULO_GRUPO}>De otras atenciones del paciente</p>
              <div className="flex flex-wrap gap-1.5">{deOtras.map((d) => etiqueta(d, plan.dxExtra.some((x) => x.codigo === d.codigo), () => alternarDeOtras(d), d.origen))}</div>
            </div>
          )}
        </>
      ) : (
        enHoja.length > 0 && <div className="flex flex-wrap gap-1.5">{enHoja.map((d) => (
          <span key={d.codigo} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-700 text-white text-xs font-semibold">
            <span className="font-mono text-[11px] text-teal-100">{d.codigo}</span>{d.descripcion}
          </span>
        ))}</div>
      )}
      {/* Así saldrá el renglón en el papel */}
      <div className="mt-2 rounded-lg border border-teal-700/20 bg-white px-2.5 py-1.5 flex items-start gap-1.5" data-testid="vista-previa-patologias">
        <span className="material-symbols-outlined text-sm text-teal-700 mt-px">print</span>
        <p className="text-[11px] leading-snug text-on-surface min-w-0">
          <span className="text-on-surface-variant">En la hoja saldrá — Diagnóstico (CIE-10): </span>
          {enHoja.length
            ? <b>{enHoja.map((d) => `${d.codigo} ${d.descripcion}`).join('; ')}</b>
            : <i className="text-on-surface-variant">en blanco, para escribirlo a mano</i>}
        </p>
      </div>
      {editable && eligioPatologias && nMarcados === 0 && (
        <p className="mt-2 text-[11px] font-semibold text-amber-700 flex items-center gap-1" data-testid="aviso-patologias-sin-guardar">
          <span className="material-symbols-outlined text-sm">info</span>Lo elegido aquí se guarda cuando marques al menos un tratamiento.
        </p>
      )}
    </section>
  );
  const imprimir = async () => {
    setAbriendo(true);
    try { await abrirPdfEnPestana(() => historiaClinicaApi.blobEvaluacionFisioPdf(a.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo generar la hoja'); }
    finally { setAbriendo(false); }
  };
  const sinGuardar = editable && estado !== 'guardado';

  return (
    <>
    {tarjetaPatologias}
    <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 sm:p-5" data-testid="tratamiento-fisio">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center">
            <span className="material-symbols-outlined mr-2 text-primary">physical_therapy</span>Tratamiento
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {editable ? 'Marca lo que se hará y escribe abajo un comentario de lo que harás. Se guarda solo.' : 'Lo marcado en esta atención.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {editable && (
            <span className={`text-xs font-semibold ${estado === 'error' ? 'text-rose-600' : estado === 'guardado' ? 'text-emerald-700' : 'text-amber-700'}`} data-testid="estado-tratamiento-fisio">{textoEstado}</span>
          )}
          <button type="button" onClick={imprimir} disabled={abriendo || sinGuardar} data-testid="imprimir-evaluacion-fisio"
            title={sinGuardar ? 'Espera a que termine de guardar' : 'Abre la hoja «Evaluación fisioterapéutica» (media hoja) para imprimirla'}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-xs font-semibold text-primary hover:bg-primary/5 disabled:opacity-50">
            <span className="material-symbols-outlined text-base leading-none">print</span>{abriendo ? 'Abriendo…' : 'Imprimir hoja'}
          </button>
        </div>
      </div>

      {editable && anterior && anterior.tratamientos.length > 0 && (
        <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="tratamiento-anterior">
          <p className="text-xs text-on-surface flex-1 min-w-[220px]">
            <b>{anterior.servicio} del {fmtFecha(anterior.fecha)}:</b> {anterior.tratamientos.map((t) => t.nombre.replace(/\s*\(.*\)$/, '')).join(', ')}
            {anterior.sesiones ? ` · ${anterior.sesiones} sesiones` : ''}
          </p>
          <button type="button" onClick={usarAnterior} data-testid="usar-tratamiento-anterior"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-bold">
            <span className="material-symbols-outlined text-sm leading-none">content_copy</span>Usar el mismo
          </button>
        </div>
      )}

      {editable ? (
        <>
          {/* Dos columnas en el orden de la hoja de papel: se llena la izquierda y luego la derecha */}
          <div className="grid gap-2 md:grid-cols-2 md:grid-rows-[repeat(8,auto)] md:grid-flow-col">
            {TRATAMIENTOS_FISIO.map((t) => {
              const marcado = plan.marcados.includes(t.clave);
              return (
                <label key={t.clave} data-tratamiento={t.clave} data-marcado={marcado ? 'si' : 'no'}
                  className={`flex items-center gap-2.5 px-3 min-h-[44px] rounded-xl border cursor-pointer transition-colors ${marcado ? 'border-primary/50 bg-primary/5' : 'border-outline-variant/30 hover:bg-surface-container-low'}`}>
                  <input type="checkbox" checked={marcado} onChange={() => alternar(t.clave)} className="accent-primary w-5 h-5 shrink-0" />
                  <span className={`text-sm text-on-surface ${marcado ? 'font-semibold' : ''}`}>{t.nombre}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px] md:items-start">
            <div>
              <label className={LBL} htmlFor="comentario-fisio">Comentario del tratamiento</label>
              <textarea id="comentario-fisio" rows={3} maxLength={MAX_COMENTARIO_FISIO} disabled={nMarcados === 0} data-testid="comentario-fisio"
                value={plan.comentario} onChange={(e) => cambiar({ ...plan, comentario: e.target.value })}
                placeholder="Qué se hará, en pocas palabras. Ej.: ultrasonido y magneto en rodilla derecha, más ejercicios de fortalecimiento en casa."
                className={`${INPUT} resize-y disabled:opacity-50`} />
              <p className="mt-1 text-[11px] text-on-surface-variant flex justify-between gap-2">
                <span>{nMarcados === 0 ? 'Marca al menos un tratamiento para escribir el comentario y las sesiones.' : `${nMarcados} ${nMarcados === 1 ? 'tratamiento marcado' : 'tratamientos marcados'}. El comentario sale en la hoja impresa.`}</span>
                <span className="shrink-0">{plan.comentario.length}/{MAX_COMENTARIO_FISIO}</span>
              </p>
            </div>
            <div>
              <label className={LBL} htmlFor="sesiones-fisio">N.º de sesiones recomendadas</label>
              <input id="sesiones-fisio" type="number" inputMode="numeric" min={1} max={99} disabled={nMarcados === 0} data-testid="sesiones-fisio"
                value={plan.sesiones ?? ''} placeholder="—"
                onChange={(e) => { const n = Math.round(Number(e.target.value)); cambiar({ ...plan, sesiones: e.target.value === '' || !Number.isFinite(n) ? null : Math.min(99, Math.max(1, n)) }); }}
                className={`${INPUT} disabled:opacity-50`} />
            </div>
          </div>
        </>
      ) : (
        <>
          {nMarcados === 0 && <p className="text-sm text-on-surface-variant">Ningún tratamiento marcado.</p>}
          <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {marcados.map((t) => (
              <li key={t.clave} className="flex items-start gap-2 text-sm font-semibold text-on-surface" data-tratamiento={t.clave} data-marcado="si">
                <span className="material-symbols-outlined text-base text-primary mt-0.5">check_box</span>{t.nombre}
              </li>
            ))}
          </ul>
          {plan.comentario && <p className="mt-3 text-sm text-on-surface whitespace-pre-wrap" data-testid="comentario-fisio"><span className={LBL}>Comentario del tratamiento</span>{plan.comentario}</p>}
          {plan.sesiones != null && <p className="mt-2 text-sm text-on-surface"><span className="text-on-surface-variant">Sesiones recomendadas:</span> <b>{plan.sesiones}</b></p>}
        </>
      )}
    </section>
    </>
  );
}
