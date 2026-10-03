// Vista de la historia clínica.
// 03-oct-2026: la vista de una sola pestaña (Atención / Podograma / Fotos / Constancias) es la PREDETERMINADA para todos.
// Quien prefiera la de pestañas de siempre la elige con el botón «Vista clásica» (o ?vista=clasica) y queda recordado en
// ESE navegador; «Vista nueva» (o ?vista=unica) la devuelve. Clave nueva a propósito: la anterior (limablue-hc-vista)
// podía tener «clasica» guardado de las pruebas de setiembre y no debe devolver a nadie a la clásica sin que lo pida.
const CLAVE_VISTA_HC = 'limablue-hc-vista-v2';

export function leerVistaUnica(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('vista');
    if (q === 'unica' || q === 'clasica') localStorage.setItem(CLAVE_VISTA_HC, q);
    return localStorage.getItem(CLAVE_VISTA_HC) !== 'clasica';
  } catch {
    return true;
  }
}

/** Mejoras «HC v2» (precarga de la consulta anterior, marcas del Visor, sin barra de dictado…): activas para todos. */
export function leerHcV2(): boolean {
  return true;
}
