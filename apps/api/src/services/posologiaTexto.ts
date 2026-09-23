/**
 * Posología LEGIBLE para el paciente (23-sep-2026). Los médicos escriben solo números en dosis / frecuencia /
 * duración («1», «12», «7») y la receta imprimía «1 · oral · 1 · 1.», que nadie entiende. Aquí cada campo se
 * completa con su unidad según la forma farmacéutica y se rotula:
 *   dosis «1» + cápsula → «Dosis: 1 cápsula» · vía «oral» → «Vía: oral» · frecuencia «12» → «Frecuencia: cada 12 horas» (números 1–4 = veces al día; 6, 8, 12… = cada N horas)
 *   frecuencia «1» → «Frecuencia: 1 vez al día» · duración «7» → «Duración: 7 días» · cantidad «1» → «1 tubo»
 * Si el médico ya escribió texto («1 cápsula», «cada 8 h», «2 semanas») se respeta tal cual (solo se rotula).
 * El front tiene una copia idéntica (apps/web/src/utils/posologiaTexto.ts) para la vista previa del formulario.
 */
export interface PosologiaCampos {
  tipo?: string | null;                 // MEDICAMENTO_RX | MEDICAMENTO_OTC | PRODUCTO | SERVICIO
  formaFarmaceutica?: string | null;    // tableta, cápsula, crema, solución…
  dosis?: string | null; via?: string | null; frecuencia?: string | null; duracion?: string | null; cantidad?: string | null; indicaciones?: string | null;
}

const esNumero = (s: string) => /^\d+([.,]\d+)?(\s*\/\s*\d+)?$/.test(s);
const plural = (n: string, sing: string, plu: string) => (/^(1|1[.,]0+|1\/1)$/.test(n.replace(/\s/g, '')) ? sing : plu);

/** Unidad de la DOSIS según la forma («cápsula», «aplicación», «toma»…). */
function unidadDosis(forma: string, tipo: string): [string, string] {
  const f = forma.toLowerCase();
  if (tipo === 'SERVICIO') return ['sesión', 'sesiones'];
  if (tipo === 'PRODUCTO') return ['unidad', 'unidades'];
  if (/tableta|comprimido/.test(f)) return ['tableta', 'tabletas'];
  if (/c[aá]psula/.test(f)) return ['cápsula', 'cápsulas'];
  if (/sobre/.test(f)) return ['sobre', 'sobres'];
  if (/supositorio/.test(f)) return ['supositorio', 'supositorios'];
  if (/ampolla|inyectable/.test(f)) return ['ampolla', 'ampollas'];
  if (/jarabe|suspensi|gotas orales|soluci[oó]n oral/.test(f)) return ['toma', 'tomas'];
  if (/gotas/.test(f)) return ['gota', 'gotas'];
  if (/crema|gel|ung[uü]ento|loci[oó]n|soluci[oó]n|laca|espuma|spray|polvo|aerosol|esmalte|t[oó]pic/.test(f)) return ['aplicación', 'aplicaciones'];
  return ['unidad', 'unidades'];
}
/** Unidad de la CANTIDAD a entregar («tubo», «frasco», «tabletas»…). */
function unidadCantidad(forma: string, tipo: string): [string, string] {
  const f = forma.toLowerCase();
  if (tipo === 'SERVICIO') return ['sesión', 'sesiones'];
  if (tipo === 'PRODUCTO') return ['unidad', 'unidades'];
  if (/crema|gel|ung[uü]ento|pasta/.test(f)) return ['tubo', 'tubos'];
  if (/soluci[oó]n|loci[oó]n|jarabe|suspensi|gotas|laca|espuma|spray|aerosol|esmalte|polvo/.test(f)) return ['frasco', 'frascos'];
  if (/ampolla|inyectable/.test(f)) return ['ampolla', 'ampollas'];
  return unidadDosis(forma, tipo);
}

export function textoDosis(v: string | null | undefined, forma = '', tipo = ''): string {
  const s = (v ?? '').trim(); if (!s) return '';
  if (!esNumero(s)) return s;
  const [sing, plu] = unidadDosis(forma, tipo);
  return `${s} ${plural(s, sing, plu)}`;
}
export function textoCantidad(v: string | null | undefined, forma = '', tipo = ''): string {
  const s = (v ?? '').trim(); if (!s) return '';
  if (!esNumero(s)) return s;
  const [sing, plu] = unidadCantidad(forma, tipo);
  return `${s} ${plural(s, sing, plu)}`;
}
export function textoVia(v: string | null | undefined): string {
  const s = (v ?? '').trim(); if (!s) return '';
  return /^v[ií]a\b/i.test(s) ? s : s;
}
export function textoFrecuencia(v: string | null | undefined): string {
  const s = (v ?? '').trim(); if (!s) return '';
  let m: RegExpExecArray | null;
  // Número solo: 1–4 se lee como «veces al día»; 6, 8, 12, 24… como «cada N horas» (es lo que escriben los médicos).
  if (esNumero(s)) { const n = Number(s.replace(',', '.')); return n === 1 ? '1 vez al día' : n <= 4 ? `${s} veces al día` : `cada ${s} horas`; }
  if ((m = /^cada\s*(\d+)\s*(h|hrs?|horas?)?\.?$/i.exec(s))) return `cada ${m[1]} horas`;
  if ((m = /^c\s*\/\s*(\d+)\s*(h|hrs?|horas?)?\.?$/i.exec(s))) return `cada ${m[1]} horas`;
  if ((m = /^(\d+)\s*(h|hrs?|horas?)\.?$/i.exec(s))) return `cada ${m[1]} horas`;
  if ((m = /^(\d+)\s*(x|veces?|vez)\s*(d[ií]a|al d[ií]a|\/d[ií]a|d)?\.?$/i.exec(s))) return m[1] === '1' ? '1 vez al día' : `${m[1]} veces al día`;
  return s;
}
export function textoDuracion(v: string | null | undefined): string {
  const s = (v ?? '').trim(); if (!s) return '';
  let m: RegExpExecArray | null;
  if (esNumero(s)) return /^1$/.test(s) ? '1 día' : `${s} días`;
  if ((m = /^(\d+)\s*(d|d[ií]as?)\.?$/i.exec(s))) return m[1] === '1' ? '1 día' : `${m[1]} días`;
  if ((m = /^(\d+)\s*(s|sem|semanas?)\.?$/i.exec(s))) return m[1] === '1' ? '1 semana' : `${m[1]} semanas`;
  if ((m = /^(\d+)\s*(m|mes|meses)\.?$/i.exec(s))) return m[1] === '1' ? '1 mes' : `${m[1]} meses`;
  return s;
}

/**
 * Línea de posología rotulada, p. ej. «Dosis: 1 cápsula · Vía: oral · Frecuencia: cada 12 horas · Duración: 7 días».
 * Devuelve '' si no hay nada. Las indicaciones NO van aquí (se imprimen aparte).
 */
export function lineaPosologia(it: PosologiaCampos): string {
  const forma = it.formaFarmaceutica ?? ''; const tipo = it.tipo ?? '';
  const partes = [
    ['Dosis', textoDosis(it.dosis, forma, tipo)],
    ['Vía', tipo === 'SERVICIO' || tipo === 'PRODUCTO' ? '' : textoVia(it.via)],
    ['Frecuencia', textoFrecuencia(it.frecuencia)],
    ['Duración', textoDuracion(it.duracion)],
  ].filter(([, v]) => v);
  return partes.map(([k, v]) => `${k}: ${v}`).join('  ·  ');
}
