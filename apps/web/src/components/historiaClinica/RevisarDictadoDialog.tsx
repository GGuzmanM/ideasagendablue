// Revisar lo dictado y llenar los campos (1.7): TODO lo que se dictó quedó guardado como
// transcripción; aquí se ve cómo quedaría repartido campo por campo y el profesional elige qué
// aplicar. Nada se escribe sin su visto bueno. Si un campo ya tenía texto, decide entre reemplazarlo
// o añadir lo dictado al final. Vista pura: el reparto vive en utils/dictadoEstructurado.ts.
import { useMemo, useState } from 'react';
import { CAMPOS_PROPUESTA, CAMPO_PROPUESTA_LABEL, type CampoPropuesta, type DiagnosticoDictado, type LesionDictada, type PropuestaDictado } from '../../utils/dictadoEstructurado';
import { TIPO_LESION_LABEL, PIE_LABEL } from '../../api/historiaClinica';

type Modo = 'reemplazar' | 'anadir';
const BTN_SEC = 'min-h-[44px] px-4 py-2 border border-outline-variant rounded-xl font-bold text-sm text-on-surface hover:bg-surface-container-high';

export function RevisarDictadoDialog({ propuesta, actuales, transcripcion, onTranscripcion, onAplicar, onLimpiar, onDiagnostico, onLesion, onClose, guardando }: {
  propuesta: PropuestaDictado;
  actuales: Record<CampoPropuesta, string>;
  transcripcion: string;
  onTranscripcion: (texto: string) => void;
  onAplicar: (eleccion: Partial<Record<CampoPropuesta, Modo>>) => void;
  onLimpiar: () => void;
  onDiagnostico: (d: DiagnosticoDictado) => void;
  onLesion: (l: LesionDictada) => void;
  onClose: () => void;
  guardando?: boolean;
}) {
  const conTexto = useMemo(() => CAMPOS_PROPUESTA.filter((c) => propuesta.campos[c].trim()), [propuesta]);
  // Por defecto se aplican todos: reemplazar si el campo está vacío, añadir al final si ya tenía algo.
  const [eleccion, setEleccion] = useState<Partial<Record<CampoPropuesta, Modo>>>(() =>
    Object.fromEntries(conTexto.map((c) => [c, actuales[c].trim() ? 'anadir' : 'reemplazar'])) as Partial<Record<CampoPropuesta, Modo>>);
  const [verTexto, setVerTexto] = useState(false);
  const elegidos = conTexto.filter((c) => eleccion[c]).length;

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-[2px] z-[120] flex items-start justify-center p-3 sm:p-6 overflow-y-auto" role="dialog" aria-modal="true" data-testid="revisar-dictado">
      <div className="bg-surface-container-lowest w-full max-w-[860px] rounded-2xl overflow-hidden custom-shadow my-4">
        <div className="px-5 py-4 bg-primary text-on-primary flex items-start gap-3">
          <span className="material-symbols-outlined">mic</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-headline-sm text-headline-sm font-bold">Revisar lo dictado</h3>
            <p className="text-sm text-on-primary/80 mt-0.5">Todo lo que dictaste quedó guardado. Elige qué se escribe en cada campo; puedes corregir el texto antes.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="material-symbols-outlined text-on-primary/80 hover:text-on-primary min-w-[44px] min-h-[44px] flex items-center justify-center">close</button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {conTexto.length === 0 && (
            <p className="text-sm text-on-surface-variant">No se reconoció contenido para ningún campo. Revisa el texto dictado abajo: puedes corregirlo (por ejemplo agregar «objetivo» al inicio de una frase) y volver a revisar.</p>
          )}

          {conTexto.map((campo) => {
            const tenia = actuales[campo].trim();
            const modo = eleccion[campo];
            return (
              <div key={campo} className={`rounded-xl border p-4 ${modo ? 'border-primary/40 bg-primary/5' : 'border-outline-variant/30'}`} data-testid={`propuesta-${campo}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={!!modo} onChange={(e) => setEleccion((s) => ({ ...s, [campo]: e.target.checked ? (tenia ? 'anadir' : 'reemplazar') : undefined }))}
                    className="mt-1 w-5 h-5 accent-[color:var(--md-sys-color-primary,#0044ab)]" data-testid={`aplicar-${campo}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-on-surface">{CAMPO_PROPUESTA_LABEL[campo]}</span>
                    <span className="block text-sm text-on-surface whitespace-pre-line mt-1">{propuesta.campos[campo]}</span>
                  </span>
                </label>
                {tenia && (
                  <div className="mt-3 pl-8 space-y-2">
                    <p className="text-[11px] text-on-surface-variant">Este campo ya tiene texto: «{tenia.length > 90 ? `${tenia.slice(0, 90)}…` : tenia}»</p>
                    <div className="flex gap-2 flex-wrap">
                      {([['anadir', 'Añadir al final'], ['reemplazar', 'Reemplazar lo que hay']] as [Modo, string][]).map(([m, label]) => (
                        <button key={m} type="button" disabled={!modo} onClick={() => setEleccion((s) => ({ ...s, [campo]: m }))}
                          className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border ${modo === m ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/40 text-on-surface-variant'} ${!modo ? 'opacity-40' : ''}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {propuesta.diagnosticos.length > 0 && (
            <div className="rounded-xl border border-outline-variant/30 p-4">
              <p className="text-sm font-bold text-on-surface mb-1">Diagnósticos dictados</p>
              <p className="text-[11px] text-on-surface-variant mb-2">Se buscan en el CIE-10 y se agregan desde la pestaña Evolución (uno por uno, para confirmar el código).</p>
              <div className="flex gap-2 flex-wrap">
                {propuesta.diagnosticos.map((d, i) => (
                  <button key={`${d.termino}-${i}`} type="button" onClick={() => { onDiagnostico(d); onClose(); }} data-testid="dx-dictado"
                    className="min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">search</span>{d.termino || '(sin término)'}{d.tipo ? ` · ${d.tipo}` : ''}{d.principal ? ' · principal' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {propuesta.lesiones.length > 0 && (
            <div className="rounded-xl border border-outline-variant/30 p-4">
              <p className="text-sm font-bold text-on-surface mb-1">Lesiones dictadas</p>
              <p className="text-[11px] text-on-surface-variant mb-2">Se marcan en el podograma con un toque.</p>
              <div className="flex gap-2 flex-wrap">
                {propuesta.lesiones.map((l, i) => (
                  <button key={i} type="button" onClick={() => onLesion(l)} data-testid="lesion-dictada"
                    className="min-h-[36px] px-3 py-1 rounded-lg text-xs font-semibold border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">footprint</span>
                    {l.tipoLesion ? TIPO_LESION_LABEL[l.tipoLesion] : 'Lesión'}{l.zona ? ` · ${l.zona.etiqueta}` : ''}{l.pie ? ` · ${PIE_LABEL[l.pie]}` : ' · falta el pie'}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl bg-surface-container-low/60 border border-outline-variant/20 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-on-surface flex-1">Texto dictado (tal como se escuchó)</p>
              <button type="button" onClick={() => setVerTexto((v) => !v)} className="min-h-[36px] text-xs font-semibold text-primary hover:underline" data-testid="ver-transcripcion">
                {verTexto ? 'Ocultar' : 'Ver y corregir'}
              </button>
            </div>
            <p className="text-[11px] text-on-surface-variant">{transcripcion.split('\n').filter((l) => l.trim()).length} frase(s) guardadas. Se conservan aunque cierres esta ventana.</p>
            {verTexto && (
              <>
                <textarea value={transcripcion} onChange={(e) => onTranscripcion(e.target.value)} rows={8} data-testid="transcripcion"
                  className="mt-2 w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono-label" />
                <p className="text-[11px] text-on-surface-variant mt-1">Una frase por línea. Si corriges aquí, el reparto de arriba se recalcula solo.</p>
              </>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-outline-variant/30 bg-surface-container-low/40 flex flex-wrap gap-3 items-center">
          <button type="button" onClick={() => { if (window.confirm('¿Borrar todo lo dictado de esta atención? No se puede recuperar.')) onLimpiar(); }}
            className="min-h-[44px] px-3 py-2 text-rose-600 text-sm font-semibold hover:underline" data-testid="borrar-dictado">Borrar lo dictado</button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className={BTN_SEC}>Cancelar</button>
          <button type="button" disabled={!elegidos || guardando} onClick={() => onAplicar(eleccion)} data-testid="aplicar-dictado"
            className="min-h-[44px] px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm disabled:opacity-50">
            {guardando ? 'Guardando…' : `Llenar ${elegidos} campo${elegidos === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
