import { COLOR_ESCALA, ESCALA_TIPO, nivelEscala, textoEscala, type TipoMarcaCorporal } from './cuerpo3dModelo';

/** Valor de la sesión anterior del mismo punto (para decir si mejoró o empeoró). */
export interface EscalaAnterior { valor: number; fecha: string }

const fmtFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** «anterior 7 (12/11/2026) → mejoró 3»: en todas estas escalas, menos es mejor. */
export function CambioEscala({ valor, anterior }: { valor: number | null; anterior: EscalaAnterior }) {
  const dif = valor == null ? null : valor - anterior.valor;
  return (
    <span className="text-[11px] text-on-surface-variant" data-testid="escala-anterior">
      Anterior {anterior.valor}/10 ({fmtFecha(anterior.fecha)})
      {dif != null && (
        <b className={`ml-1 ${dif < 0 ? 'text-emerald-700' : dif > 0 ? 'text-rose-700' : 'text-on-surface-variant'}`}>
          → {dif < 0 ? `mejoró ${-dif}` : dif > 0 ? `empeoró ${dif}` : 'igual'}
        </b>
      )}
    </span>
  );
}

/** Etiqueta de solo lectura: «EVA 7/10 · intenso» con el color del valor. */
export function ChipEscala({ tipo, valor }: { tipo: TipoMarcaCorporal; valor: number | null }) {
  if (valor == null) return <span className="text-xs text-on-surface-variant/70 italic">sin escala</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: COLOR_ESCALA[valor] }}>
      {textoEscala(tipo, valor)}
    </span>
  );
}

/**
 * Escala de UN hallazgo del mapa corporal (24-nov-2026, Fisioterapia): 0 a 10 de un toque, como un medidor de verde a rojo.
 * Para el dolor es la EVA. Tocar el valor ya elegido lo quita.
 */
export function EscalaPunto({ tipo, valor, editable, onCambiar, anterior }: {
  tipo: TipoMarcaCorporal; valor: number | null; editable: boolean; onCambiar: (v: number | null) => void; anterior?: EscalaAnterior | null;
}) {
  const e = ESCALA_TIPO[tipo];
  if (!editable) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ChipEscala tipo={tipo} valor={valor} />
        {anterior && <CambioEscala valor={valor} anterior={anterior} />}
      </div>
    );
  }
  return (
    <div className="space-y-1" data-testid="escala-punto">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {e.nombre}
          {valor != null
            ? <b className="ml-1.5 text-xs normal-case tracking-normal" style={{ color: COLOR_ESCALA[valor] }}>{valor}/10 · {nivelEscala(tipo, valor)}</b>
            : <span className="ml-1.5 normal-case tracking-normal font-normal italic">sin marcar</span>}
        </span>
        {anterior && <CambioEscala valor={valor} anterior={anterior} />}
      </div>
      <div className="grid grid-cols-11 gap-0.5" role="radiogroup" aria-label={`${e.nombre} de 0 a 10`}>
        {COLOR_ESCALA.map((color, i) => {
          const elegido = valor === i;
          const lleno = valor != null && i <= valor; // medidor: se llena hasta el valor
          return (
            <button key={i} type="button" role="radio" aria-checked={elegido} data-escala={i}
              title={i === 0 ? e.cero : i === 10 ? e.diez : `${i}/10 · ${nivelEscala(tipo, i)}`}
              onClick={() => onCambiar(elegido ? null : i)}
              className={`h-9 lg:h-8 rounded-md text-xs font-bold transition-all ${elegido ? 'text-white ring-2 ring-offset-1 ring-slate-900/30 scale-105' : lleno ? 'text-white/90' : 'text-on-surface-variant hover:brightness-95'}`}
              style={{ background: lleno ? color : `${color}26`, opacity: lleno && !elegido ? 0.75 : 1 }}>
              {i}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant/80"><span>{e.cero}</span><span>{e.diez}</span></div>
    </div>
  );
}
