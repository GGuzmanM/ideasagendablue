// Barra "Dictar consulta" (vista pura): un micrófono para toda la atención, sección vigente,
// chips para cambiar de sección a mano (por si una palabra no se entendió) y texto parcial.
// La lógica vive en hooks/useDictadoConsulta.ts; las reglas en utils/dictadoEstructurado.ts.
import toast from 'react-hot-toast';
import type { DictadoConsulta } from '../../hooks/useDictadoConsulta';
import type { TabHc } from '../../services/historiaClinicaService';
import { SECCIONES, SECCION_LABEL, SECCION_VOZ, type SeccionDictado } from '../../utils/dictadoEstructurado';

const ICONO: Record<SeccionDictado, string> = {
  subjetivo: 'record_voice_over', objetivo: 'stethoscope', apreciacion: 'psychology', plan: 'event_note',
  indicaciones: 'checklist', observacion: 'sticky_note_2', procedimiento: 'medical_services', diagnostico: 'diagnosis', lesion: 'footprint',
};

export function BarraDictadoConsulta({ consulta, tab, irA, onRevisar, sinAplicar, guardando }: {
  consulta: DictadoConsulta; tab: TabHc; irA: (t: TabHc) => void;
  /** Abre la revisión de TODO lo dictado (previsualización campo por campo). */
  onRevisar: () => void;
  /** Hay dictado guardado que aún no se repartió a los campos. */
  sinAplicar?: boolean;
  guardando?: boolean;
}) {
  if (!consulta.soportado) return null;
  const { activo, seccion } = consulta;
  const total = Object.values(consulta.entregas).reduce((a, b) => a + (b ?? 0), 0);
  const frasesGuardadas = consulta.transcripcion.split('\n').filter((l) => l.trim()).length;
  const destinoTab: TabHc = seccion === 'procedimiento' ? 'procedimientos' : 'evolucion';
  return (
    <div className="basis-full w-full border-t border-outline-variant/20 pt-3 mt-1">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={consulta.alternar} aria-pressed={activo}
          title={!consulta.contextoSeguro ? 'El micrófono solo funciona por HTTPS o en localhost' : undefined}
          className={`min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors ${activo ? 'bg-rose-600 text-white animate-pulse' : 'bg-primary text-on-primary hover:opacity-90'}`}>
          <span className="material-symbols-outlined text-base">{activo ? 'stop_circle' : 'mic'}</span>{activo ? 'Detener dictado' : 'Dictar consulta'}
        </button>
        {activo
          ? <span className="text-xs text-on-surface-variant">Escribiendo en <b className="text-on-surface">{SECCION_LABEL[seccion]}</b>{total ? ` · ${total} frase${total === 1 ? '' : 's'}` : ''}</span>
          : <span className="text-xs text-on-surface-variant">Un solo micrófono para toda la consulta: di la sección y sigue hablando.</span>}
        {/* Todo lo dictado queda guardado: desde aquí se revisa y se llena campo por campo. */}
        {frasesGuardadas > 0 && (
          <button type="button" onClick={onRevisar} data-testid="revisar-dictado-abrir"
            className={`min-h-[44px] lg:min-h-0 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 border ${sinAplicar ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-primary/40 bg-primary/5 text-primary hover:bg-primary/10'}`}>
            <span className="material-symbols-outlined text-base">fact_check</span>
            Revisar lo dictado ({frasesGuardadas})
          </button>
        )}
        <span className="text-[11px] text-on-surface-variant">{guardando ? 'Guardando lo dictado…' : frasesGuardadas > 0 ? 'Lo dictado está guardado' : ''}</span>
      </div>
      {activo ? (
        <>
          <div className="flex gap-1.5 flex-wrap mt-2">
            {SECCIONES.map((s) => (
              <button key={s} type="button" onClick={() => consulta.cambiarSeccion(s)} title={`Di «${SECCION_VOZ[s][0]}» o toca aquí`}
                className={`min-h-[36px] lg:min-h-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 border transition-colors ${seccion === s ? 'bg-rose-600/10 border-rose-500 text-rose-700' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'}`}>
                <span className="material-symbols-outlined text-sm">{ICONO[s]}</span>{SECCION_LABEL[s]}
                {consulta.entregas[s] ? <span className="ml-0.5 px-1 rounded bg-surface-container text-[10px]">{consulta.entregas[s]}</span> : null}
              </button>
            ))}
          </div>
          <p className="text-[11px] italic text-on-surface-variant mt-1.5 min-h-[16px] truncate">{consulta.parcial ? `…${consulta.parcial}` : 'Escuchando…'}</p>
          {/* Lo que va entendiendo: cada frase con el campo donde cayó. Así se ve al instante si una
              palabra clave no se escuchó (y se puede corregir con los chips de arriba). */}
          {consulta.ultimas.length > 0 && (
            <div className="mt-1 rounded-lg bg-surface-container-low/60 border border-outline-variant/20 px-2.5 py-1.5" data-testid="escuchado">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant flex-1">Lo que se escuchó ({consulta.ultimas.length})</p>
                {/* Si algo se oye raro, esto copia lo que entregó el navegador para revisarlo. */}
                <button type="button" onClick={async () => {
                  try { await navigator.clipboard.writeText(consulta.diagnostico()); toast.success('Diagnóstico copiado: pégalo en el chat de soporte'); }
                  catch { toast.error('No se pudo copiar'); }
                }} className="text-[10px] font-semibold text-primary hover:underline" data-testid="copiar-diagnostico">Copiar diagnóstico</button>
              </div>
              <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                {consulta.ultimas.slice(-4).reverse().map((u, i) => (
                  <li key={consulta.ultimas.length - i} className="text-[11px] text-on-surface-variant truncate">
                    <b className="text-primary">{SECCION_LABEL[u.seccion]}</b>
                    {u.pista ? <span className="text-on-surface-variant/70"> (por «{u.pista}»)</span> : null}: «{u.texto}»
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab !== destinoTab && (
            <button type="button" onClick={() => irA(destinoTab)} className="text-primary text-[11px] font-semibold hover:underline">
              {destinoTab === 'procedimientos' ? 'Lo dictado va al detalle del procedimiento · ver pestaña Procedimientos' : 'Lo dictado va a la nota de evolución · ver pestaña Evolución'}
            </button>
          )}
        </>
      ) : (
        <p className="text-[11px] text-on-surface-variant mt-1.5">
          Palabras clave: {SECCIONES.map((s) => `«${SECCION_VOZ[s][0]}»`).join(' · ')}. Dilas al empezar una frase o seguidas de «dos puntos».
          También entiende cómo empieza la frase: «paciente refiere…» → Subjetivo · «se observa…» → Objetivo · «compatible con…» → Apreciación · «se indica…» → Plan · «no usar…» → Indicaciones · «se realizó…» → Procedimiento. Para el CIE-10 di siempre «diagnóstico».
          Para marcar el podograma: «lesión» + tipo + zona + pie (ej. «lesión heloma quinto dedo izquierdo»).
        </p>
      )}
    </div>
  );
}
