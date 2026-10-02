// Marcas POR NAVEGADOR de la historia clínica (quedan recordadas en ese equipo):
//  · ?vista=unica | ?vista=clasica → la vista de una sola pestaña (Atención / Podograma / Fotos) o la clásica.
//  · ?hc=v2 | ?hc=v1 (02-oct-2026) → las MEJORAS EN VALIDACIÓN («Niega», notas para doctores, consulta anterior
//    precargada, consentimiento por foto, marcas del Visor…). Solo se ven en el navegador donde se activó, para que el
//    usuario las valide antes de mostrárselas al resto. Necesitan la vista de una sola pestaña.
const CLAVE_VISTA_HC = 'limablue-hc-vista';
const CLAVE_HC_V2 = 'limablue-hc-v2';

function leerMarca(param: string, clave: string, valores: [string, string], activa: string): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get(param);
    if (q && valores.includes(q)) localStorage.setItem(clave, q);
    return localStorage.getItem(clave) === activa;
  } catch {
    return false;
  }
}

export function leerVistaUnica(): boolean {
  return leerMarca('vista', CLAVE_VISTA_HC, ['unica', 'clasica'], 'unica');
}

/** Mejoras de la HC en validación: solo con ?hc=v2 en este navegador (y en la vista de una sola pestaña). */
export function leerHcV2(): boolean {
  return leerMarca('hc', CLAVE_HC_V2, ['v2', 'v1'], 'v2') && leerVistaUnica();
}
