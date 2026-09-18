/**
 * Lectura de los resultados del reconocedor de voz del navegador (Web Speech API).
 *
 * CÓMO SE LEE (igual que el cuadro de dictado de Google, y por la misma razón).
 * El navegador NO avisa «esto es nuevo»: en cada aviso manda la LISTA COMPLETA de lo dicho en esa
 * sesión, y la vuelve a mandar una y otra vez mientras corrige. En Android además da por terminado
 * cada pedacito («te», «te comunicomicosis», «te comunicomicosis de»…). Quien va AGREGANDO lo que
 * recibe termina escribiendo la misma frase muchas veces; por eso el cuadro de dictado del teclado
 * o de YouTube no agrega: REDIBUJA el texto completo en cada aviso. Aquí se hace lo mismo.
 *
 * `leerEspejo` no guarda estado ni recuerda nada: devuelve el texto de la sesión tal como está en
 * ese momento. Si el navegador reenvía lo mismo, el resultado es idéntico y no pasa nada; si
 * corrige una frase, el resultado sale corregido. Repetir es imposible por construcción.
 * Es una función pura: se prueba sin navegador (scratchpad/test-dictado.ts).
 */
import { limpiarRepeticiones } from './dictadoEstructurado';

export interface ResultadoVoz { isFinal: boolean; 0?: { transcript?: string }; length?: number }
export interface EventoVoz { resultIndex?: number; results: ArrayLike<ResultadoVoz> }

export interface LecturaVoz {
  /** TODO lo dicho en esta sesión del reconocedor, una línea por frase. Reemplaza, no se suma. */
  texto: string;
  /** Lo que se está oyendo ahora y el navegador todavía no da por terminado. */
  parcial: string;
}

/** Espejo de lo que el navegador tiene en la lista en este momento. */
export function leerEspejo(e: EventoVoz): LecturaVoz {
  const finales: string[] = [];
  const parciales: string[] = [];
  const n = e.results?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const r = e.results[i];
    if (!r) continue;
    const texto = (r[0]?.transcript ?? '').replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    if (r.isFinal) finales.push(texto);
    else parciales.push(texto);
  }
  // Un navegador que da por terminado cada pedacito deja la lista así: «te», «te comunicomicosis»,
  // «te comunicomicosis de»… Se queda la versión más completa de cada frase.
  return { texto: limpiarRepeticiones(finales.join('\n')), parcial: parciales.join(' ').trim() };
}
