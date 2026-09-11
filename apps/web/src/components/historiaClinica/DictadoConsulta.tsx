// Barra "Dictar consulta" (vista pura): un micrófono para toda la atención, sección vigente,
// chips para cambiar de sección a mano (por si una palabra no se entendió) y texto parcial.
// La lógica vive en hooks/useDictadoConsulta.ts; las reglas en utils/dictadoEstructurado.ts.
import type { DictadoConsulta } from '../../hooks/useDictadoConsulta';
import type { TabHc } from '../../services/historiaClinicaService';
import { SECCIONES, SECCION_LABEL, SECCION_VOZ, type SeccionDictado } from '../../utils/dictadoEstructurado';

const ICONO: Record<SeccionDictado, string> = {
  subjetivo: 'record_voice_over', objetivo: 'stethoscope', apreciacion: 'psychology', plan: 'event_note',
  indicaciones: 'checklist', observacion: 'sticky_note_2', procedimiento: 'medical_services', diagnostico: 'diagnosis', lesion: 'footprint',
};

export function BarraDictadoConsulta({ consulta, tab, irA }: { consulta: DictadoConsulta; tab: TabHc; irA: (t: TabHc) => void }) {
  if (!consulta.soportado) return null;
  const { activo, seccion } = consulta;
  const total = Object.values(consulta.entregas).reduce((a, b) => a + (b ?? 0), 0);
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
          {consulta.ultima && (
            <p className="text-[11px] text-on-surface-variant truncate">
              Última frase → <b className="text-on-surface">{SECCION_LABEL[consulta.ultima.seccion]}</b>
              {consulta.ultima.pista ? <> por «{consulta.ultima.pista}»</> : null}: «{consulta.ultima.texto}»
            </p>
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
