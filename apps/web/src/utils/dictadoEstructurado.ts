// Dictado ESTRUCTURADO de la consulta (idea del doctor): un solo micrófono para toda la
// atención y reglas que deciden a qué campo va cada frase.
//
//   "Subjetivo paciente refiere dolor en el primer dedo. Objetivo se observa onicocriptosis
//    borde lateral. Diagnóstico definitivo onicocriptosis. Procedimiento espiculectomía con
//    anestesia troncular. Plan curaciones cada dos días. Indicaciones no usar zapato cerrado.
//    Observación control en una semana."
//
// Dos capas, sin IA (puro texto; funciona igual sin internet una vez transcrito):
//  1. PALABRA CLAVE explícita («objetivo», «plan», …): cambia de sección cuando se dice AL INICIO
//     de una frase (tras una pausa natural), o en cualquier parte si va seguida de "dos puntos",
//     o precedida de "sección", "campo", "ir a", "pasar a", "cambiar a". Así "buena evolución" o
//     "el plan es..." en medio de una frase NO cambian de campo. La palabra se quita del texto,
//     salvo cuando forma una frase ("plan de tratamiento", "objetivo del examen").
//     Las claves DÉBILES («evolución», «tratamiento», «hallazgos») son palabras corrientes de la
//     consulta («evolución favorable…», «tratamiento con láser…», «hallazgos compatibles con…»),
//     así que al inicio de la frase NO cambian de sección: solo con "dos puntos", tras un prefijo
//     («pasar a tratamiento») o si son la única palabra dicha.
//  2. FRASE NATURAL (sin palabra clave): se infiere la sección por cómo EMPIEZA la frase
//     («paciente refiere…» → Subjetivo, «se observa…» → Objetivo, «compatible con…» →
//     Apreciación, «se indica…» → Plan, «no usar…» → Indicaciones, «se realizó…» →
//     Procedimiento). La pista se busca solo en las primeras palabras y NO se recorta del texto.
//     Si la frase sigue tras una coma o «y» con una pista de Plan/Indicaciones («buena evolución,
//     continuar con curaciones»), ese tramo se reparte aparte.
//  · Todo lo dicho sin pista ni palabra clave va a la sección vigente (la última usada).
//  · Es texto: el usuario siempre puede corregir el campo a mano.
import type { TipoDiagnostico, TipoProcedimiento, TipoLesion } from '../api/historiaClinica';
import { ZONAS_PIE, ajustarZonaDictada, elegirZona, type ZonaPie } from './zonasPie';

export type SeccionDictado = 'subjetivo' | 'objetivo' | 'apreciacion' | 'plan' | 'indicaciones' | 'observacion' | 'procedimiento' | 'diagnostico' | 'lesion';

export const SECCIONES: SeccionDictado[] = ['subjetivo', 'objetivo', 'apreciacion', 'plan', 'indicaciones', 'observacion', 'procedimiento', 'diagnostico', 'lesion'];

export const SECCION_LABEL: Record<SeccionDictado, string> = {
  subjetivo: 'Subjetivo', objetivo: 'Objetivo', apreciacion: 'Apreciación', plan: 'Plan', indicaciones: 'Indicaciones',
  observacion: 'Observaciones', procedimiento: 'Procedimiento', diagnostico: 'Diagnóstico', lesion: 'Lesión (podograma)',
};

/** Palabras clave explícitas para cambiar de sección (la primera es la "oficial", el resto sinónimos). */
export const SECCION_VOZ: Record<SeccionDictado, string[]> = {
  subjetivo: ['subjetivo', 'evolución', 'anamnesis', 'motivo de consulta'],
  objetivo: ['objetivo', 'examen físico', 'exploración física', 'hallazgos'],
  apreciacion: ['apreciación', 'análisis', 'evaluación', 'impresión clínica', 'impresión diagnóstica'],
  plan: ['plan', 'tratamiento'],
  indicaciones: ['indicaciones', 'indicación', 'recomendaciones'],
  observacion: ['observación', 'observaciones'],
  procedimiento: ['procedimiento', 'procedimientos'],
  diagnostico: ['diagnóstico', 'diagnósticos'],
  lesion: ['lesión', 'lesiones', 'marcar', 'marca en el podograma'],
};
/**
 * Claves DÉBILES: palabras corrientes dentro de una frase clínica («evolución favorable de la úlcera»,
 * «tratamiento con láser realizado hoy», «hallazgos compatibles con…»). Al inicio de una frase NO cambian
 * de sección ni se recortan: solo cuentan con "dos puntos", tras un prefijo o si son la única palabra.
 */
const CLAVES_DEBILES = new Set(['evolución', 'tratamiento', 'hallazgos']);

/**
 * Pistas NATURALES: si una frase empieza así (dentro de sus primeras palabras) y no trae palabra
 * clave, se infiere la sección. Se conservan en el texto. Criterio S/O/A/P: lo que el paciente
 * cuenta → Subjetivo; lo que el profesional ve/palpa → Objetivo; la interpretación → Apreciación;
 * lo que se hará → Plan; órdenes al paciente → Indicaciones; lo que se hizo hoy → Procedimiento.
 * Diagnóstico NO se infiere (dispara una búsqueda CIE-10): siempre con la palabra «diagnóstico».
 * Una pista que empieza con «^» solo cuenta si la frase EMPIEZA con ella («^buena evolución»): así
 * «paciente con buena evolución…» en medio no cambia de campo.
 * Si en la ventana hay pista de Plan y también de Procedimiento, gana Procedimiento: lo ya HECHO
 * («tratamiento con láser realizado hoy») es más concreto que lo planeado.
 */
export const PISTAS_NATURALES: Record<SeccionDictado, string[]> = {
  subjetivo: ['paciente refiere', 'refiere', 'manifiesta', 'acude por', 'viene por', 'consulta por', 'cuenta que', 'menciona', 'niega',
    'desde hace', 'le duele', 'siente', 'presenta dolor', 'presenta molestia', 'antecedente de', 'paciente de'],
  objetivo: ['se observa', 'se observan', 'se aprecia', 'se aprecian', 'se visualiza', 'se visualizan', 'se evidencia', 'se nota', 'se notan',
    'se palpa', 'se palpan', 'al examen', 'a la inspección', 'a la palpación', 'presenta', 'pulsos', 'llenado capilar', 'temperatura', 'signos de',
    'con signos', '^hallazgos'], // «hallazgos» sin dos puntos: sección Objetivo, pero la palabra se conserva
  apreciacion: ['compatible con', 'compatibles con', 'cuadro compatible', 'cuadro de', 'sugestivo de', 'sugestiva de', 'sugiere', // «se sugiere» es Plan
    'probable', 'en conclusión', 'se concluye', 'corresponde a', 'a descartar', 'descartar', 'se debe descartar', 'se trata de',
    '^evolución favorable', '^evolución desfavorable', '^evolución tórpida', '^buena evolución', '^mala evolución'], // «impresión diagnóstica/clínica» ya son palabra clave
  plan: ['se indica', 'se recomienda', 'indico', 'recomiendo', 'se sugiere', 'sugiero', 'sugerimos', 'continuar con', 'continuar', 'iniciar', 'iniciamos',
    'control en', 'cita en', 'próxima cita', 'próximo control', 'volver en', 'regresar en', 'seguimiento', 'derivar', 'derivación', 'interconsulta',
    'se receta', 'se prescribe', 'tratamiento con', 'tomar muestra', 'toma de muestra', 'solicitar', 'solicito', 'se solicita', 'pedir', 'se pide'],
  indicaciones: ['no debe', 'debe evitar', 'evitar', 'evite', 'no usar', 'no use', 'usar', 'use', 'mantener', 'mantenga', 'lavar', 'lave', // «debe» a secas no:
    'aplicar', 'aplique', 'aplicarse', 'tomar', 'tome', 'cambiar', 'cambie', 'reposo', 'no caminar', 'no mojar'], // «se debe descartar» es Apreciación
  observacion: ['tener en cuenta', 'cabe señalar', 'cabe mencionar', 'ojo con', 'pendiente'], // «nota» no: «se nota eritema» es Objetivo
  procedimiento: ['se realiza', 'se realizó', 'se realizaron', 'se procede', 'se procedió', 'se efectúa', 'se efectuó', 'se retira', 'se retiró',
    'se extrae', 'se extrajo', 'se debrida', 'se debridó', 'se cura', 'se curó', 'se aplica anestesia', 'se aplicó anestesia', 'bajo anestesia',
    'se coloca', 'se colocó', 'se corta', 'se cortó', 'se infiltra', 'se infiltró', 'sesión de láser', 'se hizo', 'se hace',
    'realizado', 'realizada', 'realizamos', 'efectuado', 'efectuada', 'efectuamos'],
  diagnostico: [],
  lesion: [],
};
/** Cuántas palabras iniciales de la frase se revisan buscando una pista natural. */
const VENTANA_PISTA = 5;
/** Tras una coma o «y», una pista de ESTAS secciones abre otro tramo («…, continuar con curaciones»). */
const SECCIONES_TRAS_CONECTOR: SeccionDictado[] = ['plan', 'indicaciones'];

export interface ParteDictado { seccion: SeccionDictado; texto: string; /** pista natural que decidió la sección (si fue inferida) */ pista?: string }

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizar = (s: string) => sinAcentos(s.toLowerCase()).replace(/\s+/g, ' ').trim();

// Patrón que acepta la palabra con o sin tilde (el reconocedor a veces las omite).
const patronAlias = (alias: string) => sinAcentos(alias).replace(/[aeiou]/g, (v) => ({ a: '[aá]', e: '[eé]', i: '[ií]', o: '[oó]', u: '[uú]' }[v] as string)).replace(/\s+/g, '\\s+');

const ALIAS_A_SECCION = new Map<string, SeccionDictado>();
for (const s of SECCIONES) for (const a of SECCION_VOZ[s]) ALIAS_A_SECCION.set(normalizar(a), s);

// Alias más largos primero para que "observaciones" no se corte como "observación" + "es".
const patronAlias_ = (lista: string[]) => lista.sort((a, b) => b.length - a.length).map(patronAlias).join('|');
const TODOS_ALIAS = SECCIONES.flatMap((s) => SECCION_VOZ[s]);
const ALIAS = patronAlias_([...TODOS_ALIAS]);
const ALIAS_FUERTE = patronAlias_(TODOS_ALIAS.filter((a) => !CLAVES_DEBILES.has(a)));
const ALIAS_DEBIL = patronAlias_(TODOS_ALIAS.filter((a) => CLAVES_DEBILES.has(a)));
const PREFIJO = '(?:secci[oó]n|campo|ir a|pasar a|cambiar a)';
const DOS_PUNTOS = '(?:\\s*(?::|dos puntos))';
// Grupo 1: clave fuerte al inicio de la frase o tras un prefijo (dos puntos opcionales). Grupo 2: clave débil tras un prefijo.
// Grupo 3: clave débil como única palabra de la frase. Grupo 4: cualquier clave, en cualquier parte, pero con dos puntos.
const RE_CLAVE = new RegExp(
  `(?:(?:^\\s*|\\b${PREFIJO}\\s+)(${ALIAS_FUERTE})\\b${DOS_PUNTOS}?` +
  `|\\b${PREFIJO}\\s+(${ALIAS_DEBIL})\\b${DOS_PUNTOS}?` +
  `|^\\s*(${ALIAS_DEBIL})\\b[\\s,.]*$` +
  `|\\b(${ALIAS})\\b${DOS_PUNTOS})[\\s,.]*`, 'gi');
// Si tras la palabra clave viene "de/del/de la…", es una frase ("plan de tratamiento"): se cambia de sección pero no se recorta.
const RE_FRASE = /^(?:de|del|de la|de los|de las)\b/i;

// Pistas naturales normalizadas, más largas primero ("presenta dolor" antes que "presenta"). `re` busca en la ventana inicial
// (o solo al inicio si la pista lleva «^»); `reInicio` exige que el texto EMPIECE con la pista (para el tramo tras coma/«y»).
const PISTAS: { pista: string; re: RegExp; reInicio: RegExp; seccion: SeccionDictado }[] = SECCIONES
  .flatMap((s) => PISTAS_NATURALES[s].map((p) => ({ pista: p.replace(/^\^/, ''), alInicio: p.startsWith('^'), seccion: s })))
  .sort((a, b) => b.pista.length - a.pista.length)
  .map(({ pista, alInicio, seccion }) => {
    const cuerpo = normalizar(pista).replace(/\s+/g, '\\s+');
    return { pista, seccion, re: new RegExp(`^(?:\\S+\\s+){0,${alInicio ? 0 : VENTANA_PISTA - 1}}${cuerpo}\\b`), reInicio: new RegExp(`^${cuerpo}\\b`) };
  });
// Conector tras el cual puede empezar otro tramo: coma / punto y coma (con «y» opcional) o «y»/«e» entre palabras.
const RE_CONECTOR = /[,;]\s*(?:[ye]\s+)?|\s+[ye]\s+/gi;

function seccionDeAlias(alias: string): SeccionDictado {
  return ALIAS_A_SECCION.get(normalizar(alias)) ?? 'subjetivo';
}

/** Infiere la sección por cómo empieza la frase (pista natural en sus primeras palabras) o null si no hay pista. */
export function inferirSeccion(frase: string): { seccion: SeccionDictado; pista: string } | null {
  const f = normalizar(frase);
  if (!f) return null;
  const hallada = PISTAS.find((p) => p.re.test(f));
  if (!hallada) return null;
  // Lo ya HECHO gana a lo planeado: «tratamiento con láser realizado hoy» es Procedimiento, no Plan.
  if (hallada.seccion === 'plan') {
    const hecho = PISTAS.find((p) => p.seccion === 'procedimiento' && p.re.test(f));
    if (hecho) return { seccion: hecho.seccion, pista: hecho.pista };
  }
  return { seccion: hallada.seccion, pista: hallada.pista };
}

/** Pista de Plan/Indicaciones justo al INICIO del texto (sin ventana), para partir un tramo tras una coma o «y». */
function pistaTrasConector(resto: string): { seccion: SeccionDictado; pista: string } | null {
  const f = normalizar(resto);
  for (const p of PISTAS) if (SECCIONES_TRAS_CONECTOR.includes(p.seccion) && p.reInicio.test(f)) return { seccion: p.seccion, pista: p.pista };
  return null;
}

/**
 * Reparte un tramo SIN palabra clave: infiere su sección por pista natural y, si tras una coma o «y» empieza una pista
 * de Plan/Indicaciones de OTRA sección («buena evolución de la herida, continuar con curaciones»), abre ahí otra parte.
 * Si la pista tras el conector es de la misma sección, el tramo sigue entero («no usar zapato cerrado y mantener el pie seco»).
 */
function repartirTramo(t: string, seccionVigente: SeccionDictado): ParteDictado[] {
  const partes: ParteDictado[] = [];
  let seccion = seccionVigente;
  let inicio = 0;
  // Sección que tendría la parte t[inicio, fin): la inferida por pista, o la vigente.
  const parte = (fin: number) => { const texto = t.slice(inicio, fin).replace(/[\s,;]+$/, '').trim(); const inf = inferirSeccion(texto); return { texto, inf, seccion: inf?.seccion ?? seccion }; };
  const cerrar = (p: ReturnType<typeof parte>) => { seccion = p.seccion; if (p.texto) partes.push(p.inf ? { seccion, texto: p.texto, pista: p.inf.pista } : { seccion, texto: p.texto }); };
  for (const m of t.matchAll(RE_CONECTOR)) {
    const idx = m.index ?? 0;
    if (idx <= inicio) continue;
    const fin = idx + m[0].length;
    const siguiente = pistaTrasConector(t.slice(fin));
    if (!siguiente) continue;
    const actual = parte(idx);
    if (actual.seccion === siguiente.seccion) continue; // misma sección: no se parte
    cerrar(actual);
    inicio = fin;
  }
  cerrar(parte(t.length));
  return partes;
}

/**
 * Reparte una frase final del reconocedor entre secciones y devuelve la sección que queda vigente.
 * Palabras clave explícitas mandan; si la frase (o su tramo inicial) no trae ninguna, se infiere por pista natural.
 */
export function enrutarDictado(texto: string, seccionActual: SeccionDictado, opciones: { inferir?: boolean } = {}): { partes: ParteDictado[]; seccion: SeccionDictado } {
  const inferir = opciones.inferir ?? true;
  const partes: ParteDictado[] = [];
  let seccion = seccionActual;
  let cursor = 0;
  let primera = true;
  const agregar = (t: string) => {
    if (!t) return;
    // Solo el tramo ANTES de la primera palabra clave se infiere (y se parte tras coma/«y»): lo demás ya fue asignado explícitamente.
    if (primera && inferir) for (const p of repartirTramo(t, seccion)) { partes.push(p); seccion = p.seccion; }
    else partes.push({ seccion, texto: t });
    primera = false;
  };
  for (const m of texto.matchAll(RE_CLAVE)) {
    const idx = m.index ?? 0;
    agregar(texto.slice(cursor, idx).trim());
    primera = false;
    seccion = seccionDeAlias(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
    const fin = idx + m[0].length;
    const conDosPuntos = /(?::|dos puntos)/i.test(m[0]);
    // "plan de tratamiento…" sin dos puntos: conservar la palabra clave como parte del texto.
    cursor = !conDosPuntos && RE_FRASE.test(texto.slice(fin)) ? idx : fin;
  }
  agregar(texto.slice(cursor).trim());
  return { partes, seccion };
}

export interface DiagnosticoDictado { termino: string; tipo?: TipoDiagnostico; principal?: boolean }

/** "definitivo onicomicosis principal" → término de búsqueda + tipo + principal. */
export function interpretarDiagnostico(texto: string): DiagnosticoDictado {
  let s = texto.trim();
  let tipo: TipoDiagnostico | undefined;
  let principal: boolean | undefined;
  const aplicar = (w: string) => {
    const k = sinAcentos(w.toLowerCase());
    if (k === 'presuntivo' || k === 'definitivo') tipo = k;
    else if (k === 'principal') principal = true;
    else if (k === 'secundario') principal = false;
  };
  for (;;) {
    const m = /^(presuntivo|definitivo|principal|secundario)\b[\s,:]*/i.exec(s);
    if (!m) break;
    aplicar(m[1]!); s = s.slice(m[0].length);
  }
  for (;;) {
    const m = /[\s,]+(presuntivo|definitivo|principal|secundario)[\s.]*$/i.exec(s);
    if (!m) break;
    aplicar(m[1]!); s = s.slice(0, m.index);
  }
  return { termino: s.trim(), tipo, principal };
}

// ─── Lesión dictada → marca del podograma ("heloma quinto dedo izquierdo grado 2") ───
export interface LesionDictada { tipoLesion: TipoLesion | null; pie: 'izquierdo' | 'derecho' | null; zona: ZonaPie | null; grado: number | null; texto: string }

const LESIONES: [RegExp, TipoLesion][] = [
  // Primero: "preúlcera" es RIESGO aunque contenga "úlcera". Después la úlcera explícita (úlcera, ulcerada,
  // ulceración…), que gana a "zona de presión": «úlcera en zona de presión del primer metatarsiano» es úlcera.
  [/pre[\s-]?ulcer/, 'riesgo'],
  [/\bulcer|llagas?\b|herida abierta/, 'ulcera'],
  [/zonas? de riesgo|zonas? de (?:alta )?presion|puntos? de (?:alta )?presion|hiperpresion|prominencia/, 'riesgo'],
  [/onicocriptosis|una encarnada|una enterrada|una incarnada|una clavada|uneros?\b/, 'onicocriptosis'],
  [/hiperqueratosis|callosidad|callos?\b|queratosis|durezas?\b/, 'hiperqueratosis'],
  [/helomas?\b|ojo de gallo|clavo plantar|clavos plantares/, 'heloma'],
  [/fisuras?\b|grietas?\b|agrietamiento/, 'fisura'],
  // "tiña" (sin tilde, "tina") solo como palabra entera: "cortina de piel" no es micosis.
  [/onicomicosis|micosis|hongos?\b|\btina\b|pie de atleta|dermatofit/, 'micosis'],
  [/ampollas?\b|flictenas?\b/, 'ampolla'],
  [/verrugas?\b|papilomas?\b|mezquinos?\b/, 'verruga'],
  [/cicatri|cirugi|operad[oa]|operacion|quirurgic|postoperatori|posoperatori/, 'cirugia'],
  // Al final, dolor e inflamación: "heloma doloroso" sigue siendo heloma. Entre ellos manda el SUSTANTIVO sobre el
  // adjetivo: "edema doloroso" es inflamación y "dolor con el tobillo inflamado" es dolor.
  [/\bdolor(?:es)?\b|\bduele/, 'dolor'],
  [/inflamaci|edema|hinchaz/, 'inflamacion'],
  [/doloros/, 'dolor'],
  [/inflamad|hinchad/, 'inflamacion'],
];
const NUMEROS: Record<string, number> = { uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
// Zonas con sus alias normalizados, más largos primero ("hallux borde medial" antes que "borde medial").
const ZONAS_ORDENADAS = ZONAS_PIE
  .flatMap((z) => z.alias.map((a) => ({ zona: z, alias: a, re: new RegExp(`\\b${normalizar(a).replace(/\s+/g, '\\s+')}\\b`), largo: a.length })))
  .sort((a, b) => b.largo - a.largo);

/** Interpreta una lesión dictada: tipo (catálogo), pie, zona (tabla ZONAS_PIE) y grado/estadio. */
export function interpretarLesion(texto: string): LesionDictada {
  const t = normalizar(texto);
  const tipoLesion = LESIONES.find(([re]) => re.test(t))?.[1] ?? null;
  const pie = /derech/.test(t) ? 'derecho' : /izquierd/.test(t) ? 'izquierdo' : null;
  const g = /(?:grado|estadio|estado|nivel)\s+(\d|uno|dos|tres|cuatro|cinco|i{1,3}|iv|v)\b/.exec(t);
  const grado = g ? (NUMEROS[g[1]!] ?? Number(g[1])) : null;
  // Sin las palabras del pie, "hallux derecho borde medial" vuelve a ser "hallux borde medial".
  const sinPie = t.replace(/\b(pie|del pie|derecho|derecha|izquierdo|izquierda|ambos pies)\b/g, ' ').replace(/\s+/g, ' ');
  // Alias más largo primero; los comodines ("plantar", "borde lateral" sin dedo) ceden ante una zona más concreta (ver elegirZona).
  const encontrada = elegirZona(ZONAS_ORDENADAS.filter((z) => z.re.test(sinPie)));
  // Uña: la onicocriptosis siempre es de la uña; también si se dice «uña» u «onico…». «Dorsal/dorso/encima»
  // = la cara de arriba del dedo. Ambos casos van a la silueta del DORSO.
  const una = tipoLesion === 'onicocriptosis' || /(^|[^a-zñ])uñas?([^a-zñ]|$)/.test(texto.toLowerCase()) || /onico/.test(t);
  const dorsal = /\bdors|\bencima\b|\barriba\b/.test(t);
  const zona = encontrada ? ajustarZonaDictada(encontrada, { una, dorsal }) : null;
  return { tipoLesion, pie, zona, grado, texto: texto.trim() };
}

/** Sugiere el tipo de procedimiento a partir de lo dictado ("… láser …" → laser). */
export function adivinarTipoProcedimiento(texto: string): TipoProcedimiento | null {
  const t = sinAcentos(texto.toLowerCase());
  const reglas: [RegExp, TipoProcedimiento][] = [
    // La espiculectomía (lo más común en el uñero) es una onicotomía; si además hay matricectomía, gana esta (va primero).
    [/matricectom/, 'matricectomia'], [/\blaser\b/, 'laser'], [/onicotom|espiculectom/, 'onicotomia'], [/quiropod/, 'quiropodia'],
    [/infiltrac/, 'infiltracion'], [/de[sb]brid/, 'debridacion'], [/curaci/, 'curacion'],
  ];
  for (const [re, tipo] of reglas) if (re.test(t)) return tipo;
  return null;
}
