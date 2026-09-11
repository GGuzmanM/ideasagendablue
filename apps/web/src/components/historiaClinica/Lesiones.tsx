// Significado de las marcas del podograma (vista pura): selector de "qué es" (callo, uñero, dolor…)
// con su color fijo y la leyenda de lo marcado, que además funciona como CAPAS: tocar un tipo lo oculta
// o lo muestra. Mismo catálogo para puntos, dibujos de la silueta e imágenes de la Baro.
import { COLOR_LESION, TIPO_LESION_AYUDA, TIPO_LESION_LABEL, type AnotacionPodograma, type TipoLesion } from '../../api/historiaClinica';

/** Orden por uso frecuente en la clínica del pie. */
export const TIPOS_LESION_ORDEN: TipoLesion[] = ['hiperqueratosis', 'heloma', 'onicocriptosis', 'micosis', 'dolor', 'inflamacion', 'ulcera', 'fisura', 'ampolla', 'verruga', 'otro'];

/** Clave de capa: el tipo, o "sin" para los trazos antiguos sin significado. */
export const claveCapa = (tipo: TipoLesion | null | undefined) => tipo ?? 'sin';

/** Chips de "qué estás marcando": cada tipo con su color; debajo, el nombre común del elegido. */
export function SelectorLesion({ valor, onCambio, titulo }: { valor: TipoLesion; onCambio: (t: TipoLesion) => void; titulo?: string }) {
  return (
    <div className="w-full">
      {titulo && <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1 text-center">{titulo}</p>}
      <div className="flex flex-wrap justify-center gap-1.5" role="radiogroup" aria-label={titulo ?? 'Tipo de lesión'}>
        {TIPOS_LESION_ORDEN.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={valor === t} onClick={() => onCambio(t)} title={TIPO_LESION_AYUDA[t]}
            className={`min-h-[36px] lg:min-h-0 px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-colors ${valor === t ? 'border-on-surface bg-surface-container-lowest shadow text-on-surface' : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-high'}`}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLOR_LESION[t] }} />
            {TIPO_LESION_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-on-surface-variant text-center mt-1"><b className="text-on-surface">{TIPO_LESION_LABEL[valor]}</b>: {TIPO_LESION_AYUDA[valor]}</p>
    </div>
  );
}

export interface FuenteLeyenda { tipo: TipoLesion | null; color: string; nota?: string | null; clase: 'trazo' | 'punto'; lugar?: string }
export interface ItemLeyenda { clave: string; tipo: TipoLesion | null; color: string; trazos: number; puntos: number; notas: string[] }

/** Trazos de una capa como entradas de la leyenda (los textos libres no cuentan). */
export function trazosComoLeyenda(lista: AnotacionPodograma[], lugar?: string): FuenteLeyenda[] {
  return lista.flatMap((a) => (a.tipo === 'trazo' ? [{ tipo: a.tipoLesion ?? null, color: a.color, nota: a.nota ?? null, clase: 'trazo' as const, lugar }] : []));
}

/** Agrupa por tipo (los trazos antiguos sin tipo se agrupan como "Sin indicar"). */
export function calcularLeyenda(fuentes: FuenteLeyenda[]): ItemLeyenda[] {
  const m = new Map<string, ItemLeyenda>();
  for (const f of fuentes) {
    const clave = claveCapa(f.tipo);
    const it = m.get(clave) ?? { clave, tipo: f.tipo, color: f.tipo ? COLOR_LESION[f.tipo] : f.color, trazos: 0, puntos: 0, notas: [] };
    if (f.clase === 'trazo') it.trazos++; else it.puntos++;
    if (f.nota) it.notas.push(f.lugar ? `${f.lugar}: ${f.nota}` : f.nota);
    m.set(clave, it);
  }
  return [...m.values()];
}

/** "Hiperqueratosis, Dolor": tipos presentes en una capa (para resúmenes cortos). */
export function resumenTipos(lista: AnotacionPodograma[]): string {
  return [...new Set(lista.flatMap((a) => (a.tipo === 'trazo' && a.tipoLesion ? [TIPO_LESION_LABEL[a.tipoLesion]] : [])))].join(', ');
}

/**
 * Leyenda de lo marcado. Con `onAlternar` cada tipo es un botón de CAPA: tocarlo oculta o muestra ese
 * tipo en el mapa (útil para ver, por ejemplo, solo los puntos de dolor).
 */
export function LeyendaLesiones({ items, ocultos = [], onAlternar, onMostrarTodo }: {
  items: ItemLeyenda[]; ocultos?: string[]; onAlternar?: (clave: string) => void; onMostrarTodo?: () => void;
}) {
  if (!items.length) return null;
  const cuenta = (n: number, s: string) => (n ? `${n} ${s}${n === 1 ? '' : 's'}` : '');
  const hayOcultos = items.some((it) => ocultos.includes(it.clave));
  return (
    <div className="mt-4 rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-3" data-testid="leyenda-lesiones">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Leyenda de lo marcado</p>
        {onAlternar && <span className="text-[10px] text-on-surface-variant">· toca un tipo para ocultarlo o mostrarlo</span>}
        <span className="flex-1" />
        {hayOcultos && onMostrarTodo && <button type="button" onClick={onMostrarTodo} className="text-[11px] font-semibold text-primary hover:underline">Mostrar todo</button>}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((it) => {
          const oculto = ocultos.includes(it.clave);
          const contenido = (
            <>
              <span className={`material-symbols-outlined text-sm mt-px ${oculto ? 'text-on-surface-variant/60' : 'text-on-surface-variant'} ${onAlternar ? '' : 'hidden'}`}>{oculto ? 'visibility_off' : 'visibility'}</span>
              <span className="w-3 h-3 rounded-full mt-0.5 shrink-0 border border-white shadow" style={{ background: it.color }} />
              <span className={oculto ? 'line-through' : ''}>
                <b>{it.tipo ? TIPO_LESION_LABEL[it.tipo] : 'Sin indicar'}</b>
                {it.tipo && it.tipo !== 'otro' && <span className="text-on-surface-variant"> ({TIPO_LESION_AYUDA[it.tipo]})</span>}
                <span className="text-on-surface-variant"> · {[cuenta(it.puntos, 'punto'), cuenta(it.trazos, 'trazo')].filter(Boolean).join(', ')}</span>
                {!oculto && it.notas.length > 0 && <span className="block text-[11px] text-on-surface-variant">{it.notas.join(' · ')}</span>}
              </span>
            </>
          );
          return (
            <li key={it.clave} className="max-w-full">
              {onAlternar
                ? <button type="button" onClick={() => onAlternar(it.clave)} aria-pressed={!oculto} data-capa={it.clave} className={`text-xs text-on-surface flex items-start gap-1.5 text-left rounded-lg px-1.5 py-1 hover:bg-surface-container-high ${oculto ? 'opacity-50' : ''}`}>{contenido}</button>
                : <span className="text-xs text-on-surface flex items-start gap-1.5">{contenido}</span>}
            </li>
          );
        })}
      </ul>
      {items.some((it) => !it.tipo) && <p className="text-[11px] text-amber-700 mt-2">Hay trazos sin indicar qué son: elige «Etiquetar» y tócalos.</p>}
    </div>
  );
}
