/**
 * POSOLOGÍA DESDE EL TEXTO LIBRE (23-sep-2026). Los tratamientos habituales del ERP traen la posología escrita en la
 * «aplicación» («01 tab vía oral c/8h por 3 días», «Aplicar 1- 2 veces al día en zona de lesión por 30 días»). Aquí se
 * separa en los campos de la receta para que salga llena y el médico solo valide:
 *   dosis «1 tableta» · vía «oral» · frecuencia «cada 8 horas» · duración «3 días» · indicaciones = lo que queda
 *   («Aplicar en zona de lesión», «Después del almuerzo»).
 * Es conservador: lo que no reconoce se queda en las indicaciones tal cual (nada se pierde). Los esquemas por etapas
 * («1° sem. diario, 2° sem. interdiario…») no se parten.
 */
export interface PosologiaExtraida {
  dosis: string | null; via: string | null; frecuencia: string | null; duracion: string | null; indicaciones: string | null;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?|una?|dos|tres)`;
const aNumero = (s: string): number => ({ un: 1, una: 1, dos: 2, tres: 3 } as Record<string, number>)[s.toLowerCase()] ?? Number(s.replace(',', '.'));
const txtNum = (s: string) => String(aNumero(s));
const vez = (n: number) => (n === 1 ? '1 vez' : `${n} veces`);
const unidadTiempo = (n: number, u: string) => {
  const x = u.toLowerCase();
  if (/^d/.test(x)) return n === 1 ? 'día' : 'días';
  if (/^s/.test(x)) return n === 1 ? 'semana' : 'semanas';
  return n === 1 ? 'mes' : 'meses';
};

// Unidad de la dosis tal como la escriben → forma canónica [singular, plural]; `forma` = la pone el vademécum si hay vínculo.
const UNIDADES: [RegExp, string, string, boolean][] = [
  [/^tab/i, 'tableta', 'tabletas', true], [/^c[aá]p/i, 'cápsula', 'cápsulas', true], [/^comprimido/i, 'tableta', 'tabletas', true],
  [/^ampolla/i, 'ampolla', 'ampollas', true], [/^puff/i, 'puff', 'puff', false], [/^gota/i, 'gota', 'gotas', false],
  [/^parches?\s+de\s+agua/i, 'parche de agua', 'parches de agua', false], [/^parche/i, 'parche', 'parches', false], [/^sobre/i, 'sobre', 'sobres', true],
];
const UNIDAD_RE = String.raw`(tab(?:leta)?s?\.?|c[aá]psulas?|cap\.?|comprimidos?|ampollas?|puffs?|gotas?|parches?(?:\s+de\s+agua)?|sobres?)`;

// Frecuencias reconocidas (en el orden en que se buscan). `quitar` = se borra del texto al extraerla.
const FRECUENCIAS: { re: RegExp; f: (m: RegExpExecArray) => string; quitar?: boolean }[] = [
  { re: /(\d{1,2})\s*am\s*y\s*(\d{1,2})\s*pm/gi, f: (m) => `2 veces al día (${m[1]} a. m. y ${m[2]} p. m.)` },
  { re: /(?<!cambiar\s)(?<!cambio\s)(?:c\s*\/\s*|cada\s+)0*(\d+)\s*(?:h|hrs?|horas?)\b\.?/gi, f: (m) => `cada ${m[1]} horas` },
  { re: /cada\s+0*(\d+)\s*d[iíì]as?\b/gi, f: (m) => (m[1] === '1' ? '1 vez al día' : `cada ${m[1]} días`) },
  { re: /cada\s+0*(\d+)\s*semanas?\b/gi, f: (m) => (m[1] === '1' ? '1 vez por semana' : `cada ${m[1]} semanas`) },
  { re: new RegExp(String.raw`${NUM}\s*(?:-|a|ó|o)\s*${NUM}\s*veces\s*(?:al|por|x)\s*d[iíì]a\b`, 'gi'), f: (m) => `${txtNum(m[1]!)} a ${txtNum(m[2]!)} veces al día` },
  { re: new RegExp(String.raw`${NUM}\s*(?:vez|veces)\s*(?:al|por|x|cada)\s*d[iíì]a\b`, 'gi'), f: (m) => `${vez(aNumero(m[1]!))} al día` },
  { re: new RegExp(String.raw`${NUM}\s*(?:vez|veces)\s*(?:por|a\s+la|x|cada)\s*sem(?:ana)?s?\b\.?`, 'gi'), f: (m) => `${vez(aNumero(m[1]!))} por semana` },
  { re: new RegExp(String.raw`${NUM}\s*(?:vez|veces)\s*(?:al|por|cada)\s*mes\b`, 'gi'), f: (m) => `${vez(aNumero(m[1]!))} al mes` },
  { re: /\bdiariami?ente\b/gi, f: () => '1 vez al día' },
  { re: /(?<!cambio\s)(?<!cambiar\s)\btodos\s+los\s+d[iíì]as\b/gi, f: () => '1 vez al día' },
  { re: /(?:\bde\s+forma\s+)?\binteri?diari[oa]s?\b/gi, f: () => 'interdiario (día por medio)' },
  { re: /\bde\s+forma\s+diaria\b/gi, f: () => '1 vez al día' },
  { re: /(?<!luego\s)\bcondicion?n?al\s+(?:al|a)\s+(?:el\s+)?dolor\b|(?<!luego\s)\bcondicinal\s+al\s+dolor\b/gi, f: () => 'solo si hay dolor' },
  // Se deducen pero NO se borran del texto (son parte de la instrucción)
  { re: /\baseo\s+diario\b/gi, f: () => '1 vez al día', quitar: false },
  { re: /\bmensual\b/gi, f: () => '1 vez al mes', quitar: false },
];
const DURACION = /(?:por|durante)\s+0*(\d+)(?:\s*(?:-|a)\s*0*(\d+))?\s*(d[iíì]as?|semanas?|mes(?:es)?)\b\.?/i;
const SIN_PARTIR = /\b[123]\s*°\s*sem/i; // esquemas por etapas: se dejan enteros

const SOLO_VERBO = /^(tomar|toma|aplicar|colocar|realizar|se recomienda|aplicaci[oó]n|usar|lavar)?$/i;

function limpiar(s: string): string | null {
  let t = s
    .replace(/\[[^\]]*\]/g, ' ')                  // «[dejar espacio para completar dosis]»
    .replace(/\s+/g, ' ')
    .replace(/\(\s*[,.;]?\s*\)/g, ' ')            // paréntesis que quedaron vacíos
    .replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/([,;:])\s*(?=[,.;:])/g, '')         // «, ,» «, .»
    .replace(/\.{2,}/g, '.')
    .replace(/\.\s*\(/g, ' (')                   // «quitaesmalte. (en las noches)» → «quitaesmalte (en las noches)»
    .replace(/\s+/g, ' ').trim()
    .replace(/^(?:[,.;:]|\by\b|\be\b|\bo\b)\s*/i, '')
    .replace(/\s*(?:[,;:]|\by\b|\bo\b)\s*(\.?)$/i, '$1')
    .replace(/^(aplicar|colocar|tomar),\s+(?=en\b|sobre\b|entre\b)/i, '$1 ')
    .replace(/^tomar?\s*,\s*/i, '')               // «Tomar, después de comer» → «Después de comer»
    .trim();
  // «(después del almuerzo)» solo → «Después del almuerzo»
  const soloParen = /^\(([^()]+)\)\.?$/.exec(t); if (soloParen) t = soloParen[1]!.trim();
  if (SOLO_VERBO.test(t.replace(/[.,;:]/g, '').trim())) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * @param texto      la «aplicación» del tratamiento
 * @param conForma   true si el tratamiento está vinculado al vademécum: la dosis queda solo con el número («1») y la unidad
 *                   (cápsula / tableta) la pone la forma del vademécum al imprimir.
 */
export function extraerPosologia(texto: string | null | undefined, conForma = false): PosologiaExtraida {
  const original = (texto ?? '').replace(/\s+/g, ' ').trim();
  const vacio: PosologiaExtraida = { dosis: null, via: null, frecuencia: null, duracion: null, indicaciones: original || null };
  if (!original || SIN_PARTIR.test(original)) return vacio;

  let s = ` ${original} `;
  const quitar = (desde: number, hasta: number) => { s = s.slice(0, desde) + ' '.repeat(hasta - desde) + s.slice(hasta); };

  // Frecuencia (puede haber varias: «1 vez al día … 3 veces por semana»)
  const frecs: { pos: number; v: string }[] = [];
  for (const { re, f, quitar: q } of FRECUENCIAS) {
    re.lastIndex = 0;
    const encontrados: RegExpExecArray[] = []; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) encontrados.push(m);
    for (const x of encontrados) { frecs.push({ pos: x.index, v: f(x) }); if (q !== false) quitar(x.index, x.index + x[0].length); }
  }
  // Duración: la primera («por 7 días y descansar 21 días. Repetir por 3 meses» → 7 días; el resto queda de indicación)
  let duracion: string | null = null;
  const d = DURACION.exec(s);
  if (d) {
    const a = Number(d[1]); const b = d[2] ? Number(d[2]) : null;
    duracion = b ? `${a} a ${b} ${unidadTiempo(b, d[3]!)}` : `${a} ${unidadTiempo(a, d[3]!)}`;
    quitar(d.index, d.index + d[0].length);
  }
  // Dosis: «01 tab», «02 cápsulas», «una tableta», «2 puff», «1 gota», «1 parche de agua»; o «Tomar 1 cada 12 horas»
  let dosis: string | null = null;
  const dm = new RegExp(String.raw`(?<![\w/#.,])${NUM}\s*${UNIDAD_RE}(?=[\s,.;)]|$)`, 'i').exec(s);
  if (dm) {
    const n = aNumero(dm[1]!); const u = UNIDADES.find(([re]) => re.test(dm[2]!));
    if (u && Number.isFinite(n)) {
      const [, sing, plu, deLaForma] = u;
      dosis = conForma && deLaForma ? String(n) : `${n} ${n === 1 ? sing : plu}`;
      quitar(dm.index, dm.index + dm[0].length);
    }
  } else {
    const solo = /\b(?:tomar|toma)\s+(\d+|una?)\b(?=\s+(?:cada|c\s*\/|v[ií]a|VO\b|condicional))/i.exec(s);
    if (solo) { dosis = txtNum(solo[1]!); quitar(solo.index + solo[0].length - solo[1]!.length, solo.index + solo[0].length); }
  }
  // Vía
  let via: string | null = null;
  const vo = /\bv[ií][ao]\s+oral\b/i.exec(s) ?? /\bVO\b/.exec(s);
  if (vo) { via = 'oral'; quitar(vo.index, vo.index + vo[0].length); }
  else { const im = /\bintramuscular\b/i.exec(s); if (im) { via = 'intramuscular'; quitar(im.index, im.index + im[0].length); } }

  // «30 minutos antes del desayuno» sin otra frecuencia = 1 vez al día
  if (!frecs.length && /antes del desayuno/i.test(original)) frecs.push({ pos: 0, v: '1 vez al día' });
  const unicas = [...new Set(frecs.sort((a, b) => a.pos - b.pos).map((x) => x.v))];
  // «solo si hay dolor» va al final: «cada 8 horas, solo si hay dolor»
  unicas.sort((a, b) => Number(a === 'solo si hay dolor') - Number(b === 'solo si hay dolor'));
  const frecuencia = unicas.length ? unicas.join(', ') : null;

  if (!dosis && !via && !frecuencia && !duracion) return vacio;
  return { dosis, via, frecuencia, duracion, indicaciones: limpiar(s) };
}

/** ¿Cuántas unidades cubre la posología? (1 tab c/8h por 5 días = 15). null si no se puede calcular. */
export function unidadesNecesarias(p: Pick<PosologiaExtraida, 'dosis' | 'frecuencia' | 'duracion'>): number | null {
  // Solo unidades que se cuentan (tabletas, cápsulas, ampollas, sobres): «2 puff» o «1 gota» no se comparan con «Spray #01».
  const n = Number(/^(\d+(?:\.\d+)?)(?:\s+(?:tabletas?|cápsulas?|ampollas?|sobres?))?$/.exec(p.dosis ?? '')?.[1]);
  const h = Number(/^cada (\d+) horas/.exec(p.frecuencia ?? '')?.[1]);
  const dias = Number(/^(\d+) d[ií]as?$/.exec(p.duracion ?? '')?.[1]);
  if (!n || !h || !dias || 24 % h) return null;
  return n * (24 / h) * dias;
}
