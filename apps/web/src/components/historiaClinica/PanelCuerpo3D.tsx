import type { ReactNode } from 'react';
import type { AtencionCompleta } from '../../api/historiaClinica';
import { MapaCorporal3D } from './MapaCorporal3D';
import { EscalaPunto } from './EscalaPunto';
import { useEscalaAnterior, useMapaCorporal } from './useMapaCorporal';
import { COLOR_TIPO, LABEL_TIPO, LABEL_ZONA, ZONAS_ORDENADAS, capaDe, type MarcaCorporal } from './cuerpo3dModelo';

const TARJETA = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-4 sm:p-5';

function EstadoGuardado({ estado, texto }: { estado: string; texto: string }) {
  return (
    <span className={`text-xs font-semibold ${estado === 'error' ? 'text-rose-600' : estado === 'guardado' ? 'text-emerald-700' : 'text-amber-700'}`} data-testid="estado-mapa-corporal">
      {texto}
    </span>
  );
}

/**
 * Pestaña «Cuerpo 3D» de la historia (24-nov-2026, Fisioterapia): se marca o se pinta cada hallazgo y ahí mismo se le pone su
 * escala. El guardado es automático (ver `useMapaCorporal`).
 */
export function PanelCuerpo3D({ a, puedeRegistrar }: { a: AtencionCompleta; puedeRegistrar: boolean }) {
  const { marcas, cambiar, estado, textoEstado, editable } = useMapaCorporal(a, puedeRegistrar);
  const anteriorDe = useEscalaAnterior(a);
  return (
    <section className={`${TARJETA} space-y-3`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center">
          <span className="material-symbols-outlined mr-2 text-primary">accessibility_new</span>Mapa corporal
        </h3>
        {editable && <EstadoGuardado estado={estado} texto={textoEstado} />}
      </div>
      {!editable && <p className="text-xs text-on-surface-variant">{a.estado !== 'abierta' ? 'La atención está cerrada: solo lectura.' : 'Solo lectura.'}</p>}
      <MapaCorporal3D marcas={marcas} editable={editable} onCambiar={cambiar} anteriorDe={anteriorDe} />
    </section>
  );
}

/**
 * «Escalas por punto» (24-nov-2026, solo Fisioterapia): al final de la atención, cada hallazgo del mapa corporal con SU escala
 * (EVA en el dolor, intensidad en lo demás) y cómo estaba en la sesión anterior. Se puede poner o corregir aquí mismo: es la
 * misma lista de la pestaña «Cuerpo 3D». Los doctores siguen con su panel de escalas de siempre (`children` = ese panel,
 * plegado, por si hace falta una escala del pie).
 */
export function PanelEscalasFisio({ a, puedeRegistrar, onAbrirMapa, otrasAbiertas = false, children }: {
  a: AtencionCompleta; puedeRegistrar: boolean; onAbrirMapa: () => void; otrasAbiertas?: boolean; children?: ReactNode;
}) {
  const { marcas, cambiar, estado, textoEstado, editable } = useMapaCorporal(a, puedeRegistrar);
  const anteriorDe = useEscalaAnterior(a);
  const orden = new Map(ZONAS_ORDENADAS.map((z, i) => [z.zona, i]));
  const lista = [...marcas].sort((x, y) => (orden.get(x.zona) ?? 999) - (orden.get(y.zona) ?? 999) || capaDe(x).localeCompare(capaDe(y)));
  const misma = (x: MarcaCorporal, y: MarcaCorporal) => x.zona === y.zona && x.tipo === y.tipo && capaDe(x) === capaDe(y);
  const sinEscala = marcas.filter((m) => m.intensidad == null).length;
  const botonMapa = (
    <button type="button" onClick={onAbrirMapa} data-testid="abrir-cuerpo-3d"
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-outline-variant/40 text-xs font-semibold text-primary hover:bg-primary/5">
      <span className="material-symbols-outlined text-base leading-none">accessibility_new</span>{marcas.length ? 'Ver en el Cuerpo 3D' : 'Marcar en el Cuerpo 3D'}
    </button>
  );
  return (
    <div className="space-y-5" data-testid="escalas-fisio">
      <section className={TARJETA}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface flex items-center">
              <span className="material-symbols-outlined mr-2 text-primary">monitor_heart</span>Escala de cada punto
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Una escala por cada hallazgo marcado en el cuerpo: EVA de 0 a 10 para el dolor e intensidad para lo demás.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {editable && marcas.length > 0 && <EstadoGuardado estado={estado} texto={textoEstado} />}
            {botonMapa}
          </div>
        </div>
        {lista.length === 0 && (
          <p className="text-sm text-on-surface-variant">Todavía no hay hallazgos marcados en el cuerpo. Al marcar dónde duele (o qué tiene), aquí sale su escala.</p>
        )}
        {editable && sinEscala > 0 && (
          <p className="mb-3 text-xs font-semibold text-amber-700 flex items-center gap-1" data-testid="aviso-sin-escala">
            <span className="material-symbols-outlined text-sm">info</span>
            {sinEscala === 1 ? 'Falta la escala de 1 hallazgo.' : `Falta la escala de ${sinEscala} hallazgos.`}
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((m) => (
            <div key={`${capaDe(m)}|${m.zona}|${m.tipo}`} className="rounded-xl border border-outline-variant/20 p-3 space-y-2" data-testid={`escala-${capaDe(m)}-${m.zona}-${m.tipo}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: COLOR_TIPO[m.tipo] }}>{LABEL_TIPO[m.tipo]}</span>
                <span className="text-sm font-semibold text-on-surface">{LABEL_ZONA[m.zona] ?? m.zona}</span>
                {capaDe(m) === 'musculos' && <span className="text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-1.5 py-0.5">Músculos</span>}
              </div>
              {m.estructuras?.length ? <p className="text-[11px] text-on-surface-variant leading-snug">{m.estructuras.join(' · ')}</p> : null}
              <EscalaPunto tipo={m.tipo} valor={m.intensidad ?? null} editable={editable} anterior={anteriorDe(m)}
                onCambiar={(v) => cambiar(marcas.map((x) => (misma(x, m) ? { ...x, intensidad: v } : x)))} />
              {m.nota && <p className="text-xs text-on-surface-variant">{m.nota}</p>}
            </div>
          ))}
        </div>
      </section>
      {children && (
        <details className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest" open={otrasAbiertas} data-testid="otras-escalas">
          <summary className="cursor-pointer select-none px-4 sm:px-5 py-3 text-sm font-semibold text-on-surface-variant hover:text-on-surface">
            Otras escalas (pie: Wagner, IWGDF, monofilamento…)
          </summary>
          <div className="px-3 sm:px-4 pb-4">{children}</div>
        </details>
      )}
    </div>
  );
}
