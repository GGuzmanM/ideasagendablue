// Autotexto (1.2): al escribir un atajo (".oc") seguido de espacio, salto de línea o signo de
// puntuación, se reemplaza por su texto. Función pura para poder probarla sin React.

const DELIMITADOR = /[\s.,;:!?)]$/;

/**
 * Si justo antes del cursor hay "atajo + delimitador", devuelve el valor con el atajo expandido y la
 * nueva posición del cursor; si no, null. Los atajos se comparan en minúsculas.
 */
export function expandirAutotexto(valor: string, cursor: number, atajos: Record<string, string>): { valor: string; cursor: number } | null {
  if (!valor || cursor <= 1 || !Object.keys(atajos).length) return null;
  const antes = valor.slice(0, cursor);
  if (!DELIMITADOR.test(antes)) return null;
  const delimitador = antes.slice(-1);
  const cuerpo = antes.slice(0, -1);
  const m = /(\S+)$/.exec(cuerpo);
  if (!m) return null;
  const atajo = m[1]!.toLowerCase();
  const texto = atajos[atajo];
  if (!texto) return null;
  const inicio = cuerpo.length - m[1]!.length;
  // Si el delimitador es un signo de puntuación y el texto ya termina en punto, no se duplica.
  const sep = /[.!?]/.test(delimitador) && /[.!?]$/.test(texto) ? '' : delimitador;
  const nuevo = valor.slice(0, inicio) + texto + sep + valor.slice(cursor);
  return { valor: nuevo, cursor: inicio + texto.length + sep.length };
}
