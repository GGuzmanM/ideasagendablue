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

const sinAcentos_ = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ─── Repeticiones del reconocedor («te te comunicomicosis te comunicomicosis de…») ───────────
// Hay micrófonos y navegadores que reenvían la MISMA frase cada vez un poco más larga; si eso
// llega al texto, la nota queda con la frase repetida palabra por palabra. La primera defensa es
// leer bien los resultados (utils/vozResultados.ts); esta es la SEGUNDA, sobre el texto ya
// escrito, así que también arregla lo que quedó guardado antes de esta corrección y protege
// contra cualquier navegador que se comporte distinto.
const RE_SIGNOS = /[.,;:!?¡¿()"'«»]/g;
const palabrasDe = (t: string) => t.trim().split(/\s+/).filter(Boolean);
/** Forma comparable de una palabra: sin tildes, mayúsculas ni signos. */
const clavePalabra = (w: string) => sinAcentos_(w.toLowerCase()).replace(RE_SIGNOS, '');
/** Cuántas palabras hacia atrás se busca una repetición. */
const VENTANA_SOLAPE = 40;

/** Cuántas palabras del final de `previo` se vuelven a decir al principio de `nuevo` (0 = ninguna). */
export function palabrasSolapadas(previo: string[], nuevo: string[]): number {
  const max = Math.min(previo.length, nuevo.length, VENTANA_SOLAPE);
  for (let l = max; l >= 1; l--) {
    // Una sola palabra repetida solo cuenta si es larga: «no no usar» o «de de» son normales al hablar.
    if (l === 1 && clavePalabra(nuevo[0] ?? '').length < 5) return 0;
    let igual = true;
    for (let k = 0; k < l; k++) {
      if (clavePalabra(previo[previo.length - l + k] ?? '') !== clavePalabra(nuevo[k] ?? '')) { igual = false; break; }
    }
    if (igual) return l;
  }
  return 0;
}

/** Quita del principio de `nuevo` lo que ya está al final de `previo`. */
export function quitarSolape(previo: string, nuevo: string): string {
  const palabras = palabrasDe(nuevo);
  const l = palabrasSolapadas(palabrasDe(previo), palabras);
  return l ? palabras.slice(l).join(' ') : nuevo.trim();
}

/**
 * ¿`nuevo` es la MISMA frase que `previo` pero más completa? Sirve para esperar a que la frase
 * termine antes de escribirla: si se escribiera «te», luego «te comunicomicosis»…, las primeras
 * palabras caerían en el campo equivocado, porque todavía no se sabe de qué se está hablando.
 */
export function continuaLaFrase(previo: string, nuevo: string): boolean {
  return !!previo.trim() && empiezaCon(nuevo, previo) && palabrasDe(nuevo).length > palabrasDe(previo).length;
}

/** ¿`largo` empieza exactamente con todas las palabras de `corto`? */
function empiezaCon(largo: string, corto: string): boolean {
  const a = palabrasDe(largo).map(clavePalabra);
  const b = palabrasDe(corto).map(clavePalabra);
  if (!b.length || b.length > a.length) return false;
  return b.every((x, i) => x === a[i]);
}

/**
 * Colapsa las repeticiones crecientes de un texto ya escrito, dentro de cada línea y entre
 * líneas seguidas («dolor», «dolor al caminar» → «dolor al caminar»). Se aplica al repartir la
 * transcripción, así que la revisión campo por campo sale limpia aunque lo guardado no lo esté.
 */
export function limpiarRepeticiones(texto: string): string {
  const lineas: string[] = [];
  for (const cruda of texto.replace(/\r/g, '').split('\n')) {
    const w = palabrasDe(cruda);
    const salida: string[] = [];
    let i = 0;
    while (i < w.length) {
      const l = palabrasSolapadas(salida, w.slice(i, i + VENTANA_SOLAPE));
      if (l) { i += l; continue; }
      salida.push(w[i]!);
      i++;
    }
    const linea = salida.join(' ');
    const previa = lineas[lineas.length - 1];
    if (previa && linea && empiezaCon(linea, previa)) { lineas[lineas.length - 1] = linea; continue; } // la nueva trae la anterior ya completa
    if (previa && linea && empiezaCon(previa, linea)) continue;                                        // la nueva es un pedazo de la anterior
    lineas.push(linea);
  }
  return lineas.join('\n');
}

/** Comandos de voz mínimos: "nueva línea" / "punto y aparte" → salto de línea. */
function aplicarComandos(t: string): string {
  return t.replace(/\s*\b(nueva l[ií]nea|punto y aparte)\b\s*/gi, '\n');
}

/** Anexa lo dictado al texto existente: espacio o salto según corresponda, mayúscula inicial de frase. */
export function anexarDictado(previo: string, dictado: string): string {
  let t = aplicarComandos(dictado.trim());
  if (!t) return previo;
  const base = previo.replace(/[ \t]+$/, '');
  // El reconocedor repite el final de lo ya escrito al empezar la frase nueva: se quita.
  if (!t.includes('\n')) t = quitarSolape(base, t);
  if (!t) return previo;
  const finDeFrase = !base || /[.!?\n]$/.test(base);
  if (finDeFrase) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!base) return t;
  return base + (base.endsWith('\n') || t.startsWith('\n') ? '' : ' ') + t;
}

export type SeccionDictado = 'subjetivo' | 'objetivo' | 'apreciacion' | 'plan' | 'indicaciones' | 'observacion' | 'procedimiento' | 'diagnostico' | 'lesion';

export const SECCIONES: SeccionDictado[] = ['subjetivo', 'objetivo', 'apreciacion', 'plan', 'indicaciones', 'observacion', 'procedimiento', 'diagnostico', 'lesion'];

export const SECCION_LABEL: Record<SeccionDictado, string> = {
  subjetivo: 'Subjetivo', objetivo: 'Objetivo', apreciacion: 'Apreciación', plan: 'Plan', indicaciones: 'Indicaciones',
  observacion: 'Observaciones', procedimiento: 'Procedimiento', diagnostico: 'Diagnóstico', lesion: 'Lesión (podograma)',
};

/** Palabras clave explícitas para cambiar de sección (la primera es la "oficial", el resto sinónimos). */
export const SECCION_VOZ: Record<SeccionDictado, string[]> = {
  subjetivo: ['subjetivo', 'evolución', 'anamnesis', 'motivo de consulta', 'motivo de atención', 'motivo', 'historia', 'relato', 'síntomas', 'sintomatología',
    'lo que refiere', 'lo que cuenta', 'lo que dice el paciente', 'queja principal'],
  objetivo: ['objetivo', 'examen físico', 'exploración física', 'hallazgos', 'examen', 'exploración', 'inspección', 'evaluación física', 'examen del pie',
    'examen podológico', 'signos', 'hallazgo', 'lo que observo', 'lo que se observa'],
  apreciacion: ['apreciación', 'análisis', 'evaluación', 'impresión clínica', 'impresión diagnóstica', 'impresión', 'valoración', 'interpretación', 'conclusión',
    'juicio clínico', 'criterio', 'análisis clínico', 'diagnóstico presuntivo', 'presunción diagnóstica'],
  plan: ['plan', 'tratamiento', 'plan de tratamiento', 'plan terapéutico', 'plan de manejo', 'manejo', 'conducta', 'tratamiento a seguir', 'terapéutica',
    'propuesta', 'propuesta de tratamiento', 'siguiente paso', 'próximos pasos', 'qué se hará', 'terapia'],
  indicaciones: ['indicaciones', 'indicación', 'recomendaciones', 'recomendación', 'cuidados', 'cuidados en casa', 'indicaciones al paciente',
    'recomendaciones al paciente', 'instrucciones', 'medidas', 'indicación al paciente', 'cuidados en el hogar'],
  observacion: ['observación', 'observaciones', 'nota', 'notas', 'comentario', 'comentarios', 'anotación', 'a tener en cuenta', 'pendientes', 'aclaración'],
  procedimiento: ['procedimiento', 'procedimientos', 'procedimiento realizado', 'lo realizado', 'lo que se hizo', 'lo que se realizó', 'intervención', 'técnica',
    'técnica realizada', 'sesión de hoy', 'trabajo realizado', 'se realizó lo siguiente', 'tratamiento realizado', 'tratamiento de hoy'],
  diagnostico: ['diagnóstico', 'diagnósticos', 'dx', 'diagnóstico clínico', 'diagnóstico podológico', 'diagnóstico de hoy'],
  lesion: ['lesión', 'lesiones', 'marcar', 'marca en el podograma', 'marcar en el podograma'],
};
/**
 * Claves DÉBILES: palabras corrientes dentro de una frase clínica («evolución favorable de la úlcera»,
 * «tratamiento con láser realizado hoy», «hallazgos compatibles con…»). Al inicio de una frase NO cambian
 * de sección ni se recortan: solo cuentan con "dos puntos", tras un prefijo o si son la única palabra.
 */
const CLAVES_DEBILES = new Set(['evolución', 'tratamiento', 'hallazgos', 'motivo', 'historia', 'relato', 'síntomas', 'sintomatología', 'examen',
  'exploración', 'inspección', 'signos', 'hallazgo', 'impresión', 'valoración', 'interpretación', 'conclusión', 'criterio', 'manejo', 'conducta', 'terapéutica',
  'propuesta', 'terapia', 'cuidados', 'medidas', 'instrucciones', 'nota', 'notas', 'comentario', 'comentarios', 'anotación', 'pendientes', 'aclaración',
  'intervención', 'técnica', 'sesión de hoy', 'evaluación']);
/**
 * Con una clave DÉBIL, un artículo delante y un verbo detrás ya no hay duda de que se está
 * nombrando la sección («mi impresión es…», «el manejo será…», «los cuidados son…», «el examen
 * muestra…»). Se exceptúa «evolución»: «la evolución es favorable» es una apreciación (regla 2).
 */
const DEBILES_CON_ARTICULO = [...CLAVES_DEBILES].filter((a) => a !== 'evolución');

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
  // Lo que el paciente CUENTA.
  subjetivo: ['paciente refiere', 'refiere', 'manifiesta', 'acude por', 'viene por', 'consulta por', 'cuenta que', 'menciona', 'niega',
    'desde hace', 'le duele', 'siente', 'presenta dolor', 'presenta molestia', 'antecedente de', 'paciente de',
    'el paciente viene', 'el paciente acude', 'el paciente indica', 'el paciente comenta', 'el paciente dice', 'el paciente refiere', 'el paciente manifiesta',
    'la paciente viene', 'la paciente acude', 'la paciente indica', 'la paciente comenta', 'la paciente dice', 'la paciente refiere', 'la paciente manifiesta',
    'indica que le', 'comenta que', 'dice que', 'se queja de', 'queja de', 'refiere que', 'paciente con dolor', 'paciente con molestia', 'paciente con molestias',
    'paciente masculino', 'paciente femenino', 'paciente varón', 'paciente mujer', 'años de edad', 'con antecedente', 'con antecedentes', 'antecedentes',
    'no refiere', 'sin antecedentes', 'es diabético', 'es diabética', 'es hipertenso', 'es hipertensa', 'hace días', 'hace semanas', 'hace meses', 'hace un mes',
    'hace una semana', 'hace dos', 'hace tres', 'hace varios', 'desde el', 'desde la', 'le molesta', 'le arde', 'le pica', 'le duelen', 'ha notado', 'nota que',
    'se ha notado', 'viene sintiendo', 'viene presentando', 'trae', 'motivo de consulta', 'vino por', 'llega por', 'llegó por'],
  // Lo que el profesional VE, PALPA o MIDE.
  objetivo: ['se observa', 'se observan', 'se aprecia', 'se aprecian', 'se visualiza', 'se visualizan', 'se evidencia', 'se evidencian', 'se nota', 'se notan',
    'se palpa', 'se palpan', 'al examen', 'a la inspección', 'a la palpación', 'a la exploración', 'a la evaluación', 'al examen físico', 'en el examen',
    'en la exploración', 'en la inspección', 'presenta', 'pulsos', 'llenado capilar', 'temperatura', 'signos de', 'con signos', '^hallazgos',
    'se encuentra', 'se encuentran', 'encuentro', 'observo', 'aprecio', 'observamos', 'apreciamos', 'con presencia de', 'presencia de', 'hay presencia',
    'se constata', 'se detecta', 'se detectan', 'se identifica', 'se identifican', 'evidencia de', 'muestra', 'a nivel de', 'a nivel del', 'en la lámina',
    'en ambas láminas', 'en la uña', 'en las uñas', 'en la piel', 'la uña', 'las uñas', 'la piel', 'la lámina', 'las láminas', 'dolor a la palpación',
    'dolor a la presión', 'sensibilidad', 'coloración', 'engrosamiento', 'engrosada', 'engrosadas', 'edema', 'eritema', 'inflamación', 'secreción',
    'exudado', 'fisura', 'fisuras', 'descamación', 'maceración', 'sin signos', 'no se observa', 'no se observan', 'no se aprecia', 'no se palpa'],
  // La INTERPRETACIÓN del profesional.
  apreciacion: ['compatible con', 'compatibles con', 'cuadro compatible', 'cuadro de', 'sugestivo de', 'sugestiva de', 'sugiere', // «se sugiere» es Plan
    'probable', 'posible', 'en conclusión', 'se concluye', 'concluyo', 'corresponde a', 'a descartar', 'descartar', 'se debe descartar', 'se trata de',
    '^evolución favorable', '^evolución desfavorable', '^evolución tórpida', '^buena evolución', '^mala evolución', // «impresión diagnóstica/clínica» ya son palabra clave
    'evolución es favorable', 'evolución es desfavorable', 'evolución es buena', 'evolución es mala', 'evoluciona bien', 'evoluciona mal', 'evoluciona favorablemente',
    'considero', 'se considera', 'consideramos', 'a mi criterio', 'a mi parecer', 'me parece',
    'parece ser', 'parece una', 'parece un', 'impresiona', 'todo indica', 'según lo observado', 'de acuerdo a lo observado', 'de acuerdo con lo observado',
    'cuadro clínico', 'signos compatibles', 'hallazgos compatibles', 'se interpreta', 'interpreto', 'estaría', 'estaríamos ante', 'estamos ante', 'nos encontramos ante',
    'se confirma', 'confirmo', 'confirmamos', 'se descarta', 'descartamos', 'en resumen', 'resumiendo', 'con esto', 'por lo tanto', 'por lo que', 'es decir'],
  // Lo que se HARÁ (futuro) o se decide.
  plan: ['se indica', 'se recomienda', 'indico', 'recomiendo', 'se sugiere', 'sugiero', 'sugerimos', 'continuar con', 'continuar', 'iniciar', 'iniciamos',
    'se le sugiere', 'se le recomienda', 'se le indica', 'se le prescribe', 'se le receta', 'se le deriva', 'se le cita', // «se le …»: el doctor habla del paciente
    'programar', 'reevaluar', 'reevaluación', 'valorar', 'completar', 'mantener el tratamiento',
    'control en', 'cita en', 'próxima cita', 'próximo control', 'volver en', 'regresar en', 'seguimiento', 'derivar', 'derivación', 'interconsulta',
    'se receta', 'se prescribe', 'tratamiento con', 'tomar muestra', 'toma de muestra', 'solicitar', 'solicito', 'se solicita', 'pedir', 'se pide',
    'iniciaremos', 'empezar', 'empezaremos', 'empezamos', 'comenzar', 'comenzaremos', 'comenzamos', 'realizaremos', 'se realizará', 'se realizarán', 'se programa',
    'se programará', 'próxima sesión', 'siguiente sesión', 'en la próxima', 'en la siguiente', 'sesiones de', 'se cita', 'citar', 'se cita en', 'regresar', 'volver',
    'reevaluamos', 'se reevalúa', 'se deriva', 'se envía', 'enviar', 'recomendar', 'tratamiento a seguir', 'se aplicará', 'aplicaremos', 'usaremos', 'se usará',
    'colocaremos', 'se colocará', 'se decide', 'decidimos', 'se opta', 'optamos', 'se plantea', 'planteamos', 'se propone', 'propongo', 'proponemos',
    'prescribir', 'recetar', 'medicar', 'medicación con', 'iniciar terapia', 'terapia con', 'láser en', 'se hará', 'haremos', 'vamos a', 'se va a',
    'se continuará', 'continuaremos', 'seguir con', 'seguiremos', 'mantendremos', 'se mantendrá', 'suspender', 'se suspende', 'suspendemos', 'cambiar a',
    'cambiaremos', 'se cambia', 'rotar a', 'se indicará', 'indicaremos', 'se recomendará', 'se evaluará', 'evaluaremos', 'se valorará', 'valoraremos',
    'se controlará', 'controlaremos', 'control con', 'controles', 'de ser necesario', 'si no mejora', 'en caso de'],
  // ÓRDENES al paciente (imperativo / infinitivo / «debe»).
  indicaciones: ['no debe', 'debe evitar', 'evitar', 'evite', 'no usar', 'no use', 'usar', 'use', 'mantener', 'mantenga', 'lavar', 'lave', // «debe» a secas no:
    'aplicar', 'aplique', 'aplicarse', 'tomar', 'tome', 'cambiar', 'cambie', 'reposo', 'no caminar', 'no mojar', // «se debe descartar» es Apreciación
    'debe mantener', 'debe usar', 'debe lavar', 'debe aplicar', 'debe tomar', 'debe acudir', 'debe volver', 'debe regresar', 'debe cambiar', 'debe secar',
    'debe hidratar', 'debe cortar', 'debe colocar', 'debe realizar', 'debe hacer', 'debe descansar', 'debe continuar', 'debe seguir', 'debe suspender',
    'deberá mantener', 'deberá usar', 'deberá aplicar', 'deberá acudir', 'deberá volver', 'tiene que usar', 'tiene que mantener', 'tiene que evitar', 'que use', 'que no use', 'que evite', 'que mantenga', 'que aplique', 'que tome', 'que lave', 'que cambie',
    'que vuelva', 'que regrese', 'que no camine', 'que no moje', 'que se seque', 'que hidrate', 'secar', 'seque', 'secarse', 'hidratar', 'hidratarse', 'no cortar',
    'no cortarse', 'cortar las uñas', 'corte de uñas', 'no rascar', 'no rascarse', 'no tocar', 'no manipular', 'no descalzo', 'no andar descalzo',
    'no caminar descalzo', 'calzado amplio', 'calzado cómodo', 'calzado abierto', 'medias de algodón', 'cambiar las medias', 'higiene', 'buena higiene',
    'lavado diario', 'colocar', 'coloque', 'colocarse', 'poner', 'ponga', 'ponerse', 'acudir', 'acuda', 'volver si', 'regresar si', 'consultar si', 'en casa'],
  // Lo que se CONVERSÓ o hay que tener presente.
  observacion: ['tener en cuenta', 'cabe señalar', 'cabe mencionar', 'ojo con', 'pendiente',
    // Lo que se le CONVERSÓ al paciente (pronóstico, tiempos, riesgos) no es una orden: es una observación.
    'se le informa', 'se informa', 'es informado', 'es informada', 'fue informado', 'fue informada', 'paciente informado', 'paciente informada',
    'se le explica', 'se explica', 'se le comunica', 'se le advierte', 'se orienta', 'se educa', 'acepta', 'firma el consentimiento', 'queda pendiente',
    'tener presente', 'a tener en cuenta', 'considerar que', 'a considerar', 'importante', 'ojo', 'recordar', 'recordar que', 'se conversa', 'conversamos',
    'se conversó', 'se le conversa', 'advertir', 'se advierte', 'firma', 'consentimiento', 'acepta el tratamiento', 'no acepta', 'rechaza', 'el paciente acepta',
    'paciente acepta', 'paciente rechaza', 'el paciente rechaza', 'la paciente acepta', 'la paciente rechaza', 'se le entrega', 'se entrega', 'se le da',
    'queda en', 'quedamos en', 'se acuerda', 'acordamos', 'el paciente pregunta', 'pregunta por', 'consulta sobre', 'desea', 'no desea', 'prefiere',
    'viene acompañado', 'viene acompañada', 'acompañado de', 'acompañada de', 'vino con', 'se le recuerda', 'se recuerda', '^como nota'],
  // Lo que se HIZO hoy (pasado).
  procedimiento: ['se realiza', 'se realizó', 'se realizaron', 'se procede', 'se procedió', 'se efectúa', 'se efectuó', 'se retira', 'se retiró',
    'se extrae', 'se extrajo', 'se debrida', 'se debridó', 'se cura', 'se curó', 'se aplica anestesia', 'se aplicó anestesia', 'bajo anestesia',
    'se coloca', 'se colocó', 'se corta', 'se cortó', 'se infiltra', 'se infiltró', 'sesión de láser', 'se hizo', 'se hace',
    'realizado', 'realizada', 'realizamos', 'efectuado', 'efectuada', 'efectuamos',
    'realicé', 'procedí', 'procedimos', 'se procedió a', 'se le realizó', 'se le realiza', 'se le hizo', 'se le hace', 'se le realizaron', 'se ejecutó', 'se ejecuta',
    'se trabajó', 'trabajamos', 'se limpió', 'limpiamos', 'se desbridó', 'desbridamos', 'se fresó', 'fresamos', 'fresado de', 'se recortó', 'recortamos',
    'retiramos', 'retiro de', 'extracción de', 'se drenó', 'drenaje de', 'se aplicó', 'aplicamos', 'se aplicó láser', 'láser aplicado', 'colocamos',
    'colocación de', 'infiltración de', 'curación realizada', 'curación de', 'curamos', 'debridamiento', 'desbridamiento', 'enucleación', 'se enucleó',
    'se cauterizó', 'cauterización', 'con anestesia', 'anestesia local', 'anestesia troncular', 'hoy se realizó', 'hoy se realiza', 'hoy se', 'el día de hoy se',
    'en esta sesión se', 'en la sesión de hoy', 'en esta sesión', 'se le aplicó', 'se le aplica', 'se le colocó', 'se le coloca', 'se le retiró', 'se le retira',
    'se hizo curación', 'se realizó curación', 'se realizó fresado', 'se realizó quiropodia', 'se realizó espiculectomía', 'se realizó onicotomía',
    'se realizó matricectomía', 'se realizó láser', 'se realizó sesión', 'se dio sesión', 'se dio la sesión', 'se cumplió', 'cumplimos', 'se terminó', 'terminamos',
    'se completó', 'completamos', 'se lijó', 'lijamos', 'se pulió', 'pulimos', 'se levantó', 'levantamos', 'se liberó', 'liberamos', 'se resecó', 'resecamos'],
  diagnostico: [],
  lesion: [],
};
/** Cuántas palabras iniciales de la frase se revisan buscando una pista natural. */
const VENTANA_PISTA = 5;
/**
 * Raíces de los diagnósticos del pie. Si la frase EMPIEZA nombrando uno («onicomicosis de tercer
 * grado con predominio en la falange distal…»), el doctor está dando su apreciación, no contando
 * lo que el paciente dice: sin esto, una frase así se quedaba en Subjetivo. Son raíces (trozos de
 * palabra) porque el micrófono corta y deforma los nombres largos: «te comunicomicosis» todavía
 * trae «micosis». Solo se miran las primeras palabras y SIEMPRE pierde contra una pista que esté
 * antes en la frase («presenta una lesión queratósica…» es Objetivo, por «presenta»).
 */
const RAICES_DX = ['micosis', 'criptosis', 'onicolis', 'onicogrif', 'onicodistrof', 'onicauxis', 'onicomadesis', 'onicorrexis',
  'queratos', 'helom', 'hallux', 'valgus', 'varus', 'fascitis', 'espolon', 'verrug', 'papilom', 'tinea', 'paroniqui', 'panadizo',
  'celulitis', 'ulcer', 'neurom', 'metatarsalgi', 'talalgi', 'bromhidrosis', 'hiperhidrosis', 'xerosis', 'granulom', 'dermatitis',
  'eccema', 'psoriasis', 'fisura', 'gangren', 'isquemi', 'neuropat'];
/** Cuántas palabras iniciales se revisan buscando el nombre de un diagnóstico. */
const VENTANA_DX = 3;
/** Frase mínima para que el nombre de un diagnóstico decida la sección. */
const MIN_PALABRAS_DX = 4;

/** Si la frase empieza nombrando un diagnóstico, dónde está esa palabra y cuál es. */
function raizDiagnostico(f: string): { pista: string; pos: number } | null {
  const todas = f.split(/\s+/).filter(Boolean);
  // Un diagnóstico suelto («onicocriptosis») no cambia de campo: puede ser parte de lo que se
  // está describiendo. Manda cuando viene dentro de una frase redactada.
  if (todas.length < MIN_PALABRAS_DX) return null;
  let pos = 0;
  const palabras = todas.slice(0, VENTANA_DX);
  for (const w of palabras) {
    const raiz = RAICES_DX.find((r) => w.includes(r));
    if (raiz) return { pista: w, pos };
    pos += w.length + 1;
  }
  return null;
}
/** Tras una coma o «y», una pista de ESTAS secciones abre otro tramo («…, continuar con curaciones»). */
const SECCIONES_TRAS_CONECTOR: SeccionDictado[] = ['plan', 'indicaciones'];

export interface ParteDictado { seccion: SeccionDictado; texto: string; /** pista natural que decidió la sección (si fue inferida) */ pista?: string }

const sinAcentos = sinAcentos_;
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
const ALIAS_DEBIL_ART = patronAlias_(TODOS_ALIAS.filter((a) => DEBILES_CON_ARTICULO.includes(a)));
const PREFIJO = '(?:secci[oó]n|campo|ir a|pasar a|cambiar a|vamos a|pasamos a|vamos con|seguimos con|continuamos con|pasando a)';
// «el diagnóstico es…», «mi apreciación…», «en cuanto al plan…», «como observación…»: lo que va delante de la clave.
const ARTICULO = '(?:el|la|los|las|mi|nuestro|nuestra|como|en el|en la|en cuanto al|en cuanto a la|en cuanto a los|en cuanto a las|respecto al|respecto a la|con respecto al|con respecto a la|para el|para la|sobre el|sobre la|del)';
// «…es», «…será», «…consiste en», «…de hoy»: lo que va detrás y se recorta con ella.
// Termina en lookahead y no en `\b`: para la expresión regular la tilde no es letra, y «será\b» nunca casaba.
const VERBO_TRAS = '(?:es|ser[ií]a|ser[aá]|fue|son|ser[aá]n|ser[ií]an|consiste en|consistir[aá] en|de hoy|del d[ií]a|actual|muestra|revela|indica|evidencia)(?=[\\s,.:;]|$)';
// Marcadores que por sí solos anuncian la sección, hasta a media línea y sin verbo («…hielo como observación el paciente…»).
const MARCADOR = '(?:en cuanto al|en cuanto a la|en cuanto a los|en cuanto a las|respecto al|respecto a la|con respecto al|con respecto a la|como|sobre el|sobre la|pasando al|pasando a la)';
// Muletillas con las que se arranca una frase y que no cuentan («bueno, el plan es…»).
const MULETILLA = '(?:ahora|ahora s[ií]|bueno|entonces|luego|y|ya|listo|ok|okey)';
const DOS_PUNTOS = '(?:\\s*(?::|dos puntos))';
// Grupo 1: clave fuerte al inicio de la frase (con muletilla, artículo y verbo opcionales) o tras un prefijo.
// Grupo 2: clave débil tras un prefijo. Grupo 3: clave débil como única palabra de la frase.
// Grupo 4: clave débil al inicio con artículo y verbo («mi impresión es», «el manejo será»).
// Grupo 7: cualquier clave, en cualquier parte, pero con dos puntos.
const INICIO = `(?:^\\s*(?:${MULETILLA}[\\s,]+)?|[,.;]\\s*|\\b${PREFIJO}\\s+)`;
const RE_CLAVE = new RegExp(
  // `[,.;]\s*`: Chrome puntúa el dictado corrido («…dolor al caminar, objetivo se observa…»),
  // así que una clave fuerte tras coma o punto abre sección igual que al inicio de la frase.
  `(?:${INICIO}(?:${ARTICULO}\\s+)?(${ALIAS_FUERTE})\\b(?:\\s+${VERBO_TRAS})?(?:\\s+que\\b)?${DOS_PUNTOS}?` +
  `|\\b${PREFIJO}\\s+(?:${ARTICULO}\\s+)?(${ALIAS_DEBIL})\\b(?:\\s+${VERBO_TRAS})?${DOS_PUNTOS}?` +
  `|^\\s*(${ALIAS_DEBIL})\\b[\\s,.]*$` +
  `|${INICIO}(?:${ARTICULO}\\s+)(${ALIAS_DEBIL_ART})\\b\\s+${VERBO_TRAS}(?:\\s+que\\b)?${DOS_PUNTOS}?` +
  // Grupo 5: clave fuerte con artículo Y verbo en cualquier parte («…estadio dos el diagnóstico es onicocriptosis»,
  // «…buena evolución y el plan es continuar»): dictando de corrido no hay puntos y la frase nueva empieza ahí.
  `|\\b(?:${ARTICULO})\\s+(${ALIAS_FUERTE})\\b\\s+${VERBO_TRAS}(?:\\s+que\\b)?${DOS_PUNTOS}?` +
  // Grupo 6: marcador + clave fuerte en cualquier parte, sin necesidad de verbo («…en cuanto al plan plantillas…»).
  `|\\b${MARCADOR}\\s+(${ALIAS_FUERTE})\\b(?:\\s+${VERBO_TRAS})?(?:\\s+que\\b)?${DOS_PUNTOS}?` +
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
    // El grupo 1 es lo que va ANTES de la pista: su largo dice en qué parte de la frase apareció.
    return { pista, seccion, re: new RegExp(`^((?:\\S+\\s+){0,${alInicio ? 0 : VENTANA_PISTA - 1}})${cuerpo}\\b`), reInicio: new RegExp(`^${cuerpo}\\b`) };
  });
// Conector tras el cual puede empezar otro tramo: coma / punto y coma (con «y» opcional) o «y»/«e» entre palabras.
const RE_CONECTOR = /[,;]\s*(?:[ye]\s+)?|\s+[ye]\s+/gi;

function seccionDeAlias(alias: string): SeccionDictado {
  return ALIAS_A_SECCION.get(normalizar(alias)) ?? 'subjetivo';
}

// ─── La palabra clave mal escuchada (tolerancia de un error) ─────────────────
// El reconocedor confunde palabras largas («obhetivo», «apresiación», «procedimento»). Si la
// PRIMERA palabra de la frase se parece a una clave fuerte, se corrige antes de enrutar. Solo
// palabras de 6+ letras (1 error) o 10+ (2), y nunca palabras del propio vocabulario clínico
// («sesión de láser» no debe volverse «lesión»).
const CLAVES_CORREGIBLES = ['subjetivo', 'objetivo', 'apreciación', 'análisis', 'evaluación', 'indicaciones', 'indicación',
  'recomendaciones', 'observación', 'observaciones', 'procedimiento', 'procedimientos', 'diagnóstico', 'diagnósticos', 'lesión', 'lesiones'];
/** Palabras reales que se parecen a una clave y NO deben corregirse. */
const NO_CORREGIR = new Set(['sesion', 'sesiones', 'presion', 'presiones', 'revision', 'decision', 'lecion', 'marca', 'marcas',
  'planta', 'plantas', 'plano', 'plana', 'analista', 'evacuacion', 'observador', 'indicado', 'indicada', 'diagnosticado']);

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j]! + 1, fila[j - 1]! + 1, previa[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = fila;
    if (Math.min(...fila) > tope) return tope + 1; // ya no puede bajar del tope
  }
  return previa[b.length]!;
}

/**
 * Si la frase empieza con una palabra parecida a una clave fuerte, devuelve la frase con esa
 * palabra ya corregida (y cuál era). Si no, devuelve la frase igual.
 */
export function corregirClaveInicial(frase: string): { frase: string; corregida?: { oida: string; clave: string } } {
  const m = /^\s*([\p{L}]+)/u.exec(frase);
  if (!m) return { frase };
  const oida = m[1]!;
  const clave = normalizar(oida);
  if (clave.length < 6 || NO_CORREGIR.has(clave)) return { frase };
  if (ALIAS_A_SECCION.has(clave)) return { frase }; // ya es una clave: nada que corregir
  const tope = clave.length >= 10 ? 2 : 1;
  let mejor: { alias: string; d: number } | null = null;
  for (const alias of CLAVES_CORREGIBLES) {
    const d = distancia(clave, normalizar(alias), tope);
    if (d <= tope && (!mejor || d < mejor.d)) mejor = { alias, d };
  }
  if (!mejor) return { frase };
  return { frase: frase.replace(oida, mejor.alias), corregida: { oida, clave: mejor.alias } };
}

/** Infiere la sección por cómo empieza la frase (pista natural en sus primeras palabras) o null si no hay pista. */
export function inferirSeccion(frase: string): { seccion: SeccionDictado; pista: string; alcance: number } | null {
  const f = normalizar(frase);
  if (!f) return null;
  const nPalabras = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  // `alcance` = hasta qué palabra (contando desde el inicio) llega la pista: sirve para no partir la
  // frase DENTRO de su propia pista («paciente refiere» no se parte en «refiere»).
  const conAlcance = (p: (typeof PISTAS)[number]) => { const m = p.re.exec(f); return { seccion: p.seccion, pista: p.pista, pos: (m?.[1] ?? '').length, alcance: nPalabras(m?.[1] ?? '') + nPalabras(p.pista) }; };
  // Entre pistas manda la más específica, como siempre («hallazgos compatibles con…» es una
  // apreciación por «compatibles con», no un objetivo por «hallazgos»).
  const p0 = PISTAS.find((p) => p.re.test(f));
  let hallada = p0 ? conAlcance(p0) : null;
  // El nombre de un diagnóstico es la pista más débil: solo manda si aparece ANTES que la otra
  // («presenta una lesión queratósica…» sigue siendo Objetivo, por «presenta»).
  const dx = raizDiagnostico(f);
  if (dx && (!hallada || dx.pos < hallada.pos)) hallada = { seccion: 'apreciacion', pista: dx.pista, pos: dx.pos, alcance: nPalabras(f.slice(0, dx.pos)) + 1 };
  if (!hallada) return null;
  // Lo ya HECHO gana a lo planeado: «tratamiento con láser realizado hoy» es Procedimiento, no Plan.
  if (hallada.seccion === 'plan') {
    const hecho = PISTAS.find((p) => p.seccion === 'procedimiento' && p.re.test(f));
    if (hecho) { const h = conAlcance(hecho); return { seccion: h.seccion, pista: h.pista, alcance: h.alcance }; }
  }
  return { seccion: hallada.seccion, pista: hallada.pista, alcance: hallada.alcance };
}

/**
 * Pistas ABRIDORAS: las que EMPIEZAN una oración («se observa…», «al examen…», «estamos ante…»,
 * «hoy se realizó…», «se le explica…», «debe mantener…»). Sirven para partir una LÍNEA que trae
 * varias oraciones seguidas: dictando de corrido el reconocedor no pone puntos, así que
 * «…desde hace dos semanas al examen se observa uña encarnada estamos ante una onicocriptosis…»
 * llega como una sola línea. Sin esto solo la primera pista decidía y todo se iba con ella (fue
 * exactamente lo que le pasó al doctor). Una pista nominal («edema», «la uña», «probable») NO
 * abre oración: puede ir en medio de una y no debe partirla.
 */
const RE_ABRIDORA = /^(?:se |al |a la |en el examen|en la exploraci|en la inspecci|el paciente |la paciente |paciente |estamos ante|nos encontramos|estariamos|hoy se|el dia de hoy|en esta sesi|en la sesi|debe |debera |tiene que|no (?:usar|use|debe|caminar|mojar|andar|cortar|rascar|tocar|manipular|refiere|se )|evitar|evite|mantener|mantenga|aplicar|aplique|control en|proxim|siguiente sesi|cita en|iniciar|iniciamos|iniciaremos|empezar|empezaremos|comenzar|comenzaremos|continuar|continuaremos|cuadro compatible|compatible|en conclusi|en resumen|considero|consideramos|impresiona|es informad|fue informad|queda pendiente|quedamos en|tener en cuenta|tener presente|cabe se|cabe mencionar|ojo con|motivo de consulta|refiere|manifiesta|acude por|viene por|consulta por|niega|realic|realizamos|proced|indico|recomiendo|sugiero|sugerimos|solicito|propongo|proponemos|decidimos|optamos|planteamos|haremos|vamos a|derivar|reevaluar|programar|valorar|suspender|seguir con|seguiremos|mantendremos|conversamos|acordamos|advertir|recordar que|considerar que|a tener en cuenta|a considerar|hallazgos compatibles|signos compatibles|todo indica|segun lo observado|de acuerdo|observo|aprecio|observamos|apreciamos|encuentro|vino por|llego por|llega por|como nota)/;
const ABRIDORAS = PISTAS.filter((p) => RE_ABRIDORA.test(normalizar(p.pista)));
/** Tras estas palabras lo que sigue es parte de la misma oración («…que se observa…», «…con eritema…»): no se parte ahí. */
const NO_PARTIR_TRAS = new Set(['que', 'porque', 'si', 'cuando', 'donde', 'aunque', 'pero', 'como', 'mientras', 'sin', 'con', 'de', 'a', 'para', 'por', 'en', 'del', 'al', 'lo', 'no', 'ni', 'o', 'u']);

/** Pista abridora justo al INICIO del texto (sin ventana). */
function pistaAbridora(resto: string): { seccion: SeccionDictado; pista: string } | null {
  const f = normalizar(resto);
  for (const p of ABRIDORAS) if (p.reInicio.test(f)) return { seccion: p.seccion, pista: p.pista };
  return null;
}
/** Pista de Plan/Indicaciones justo al INICIO del texto, para partir un tramo tras una coma o «y» (aunque no sea abridora). */
function pistaTrasConector(resto: string): { seccion: SeccionDictado; pista: string } | null {
  const f = normalizar(resto);
  for (const p of PISTAS) if (SECCIONES_TRAS_CONECTOR.includes(p.seccion) && p.reInicio.test(f)) return { seccion: p.seccion, pista: p.pista };
  return null;
}

/**
 * Reparte un tramo sin palabra clave (o lo que sigue a una): la CABEZA se infiere por pista natural
 * (salvo que venga de una palabra clave explícita, `inferirCabeza = false`), y donde EMPIEZA una
 * pista abridora de OTRA sección se abre otra parte («…desde hace dos semanas | al examen se observa
 * uña encarnada | estamos ante una onicocriptosis»). Tras una coma o «y» también parte una pista de
 * Plan/Indicaciones («buena evolución de la herida, continuar con curaciones»). Si la pista es de la
 * misma sección, el tramo sigue entero («no usar zapato cerrado y mantener el pie seco»).
 */
function repartirTramo(t: string, seccionVigente: SeccionDictado, inferirCabeza = true): ParteDictado[] {
  const partes: ParteDictado[] = [];
  let seccion = seccionVigente;
  let inicio = 0;
  let cabeza = true;
  // Sección que tendría la parte t[inicio, fin): la inferida por pista, o la vigente. Se quita la coma o el «y» que quedó colgando.
  const parte = (fin: number) => {
    const texto = t.slice(inicio, fin).replace(/[\s,;]+$/, '').replace(/\s+[ye]$/i, '').trim();
    const inf = cabeza && !inferirCabeza ? null : inferirSeccion(texto);
    return { texto, inf, seccion: inf?.seccion ?? seccion };
  };
  const cerrar = (p: ReturnType<typeof parte>) => {
    seccion = p.seccion;
    if (p.texto) partes.push(p.inf ? { seccion, texto: p.texto, pista: p.inf.pista } : { seccion, texto: p.texto });
    cabeza = false;
  };
  let previa = '';
  let k = 0;           // número de palabra dentro de la parte en curso
  let alcance = 0;     // hasta qué palabra llega la pista de la parte en curso (no se parte antes)
  // El alcance se calcula SIEMPRE (también tras una palabra clave): «objetivo paciente refiere dolor» no se parte en «refiere».
  const empezarParte = () => { k = 0; alcance = inferirSeccion(t.slice(inicio))?.alcance ?? 0; };
  empezarParte();
  for (const m of t.matchAll(/\S+/g)) {
    const idx = m.index ?? 0;
    const palabra = normalizar(m[0]).replace(/[.,;:!?¡¿()"'«»]/g, '');
    if (idx <= inicio) { previa = palabra; k = 1; continue; } // primera palabra de la parte en curso
    k++;
    if (k <= alcance) { previa = palabra; continue; }           // todavía dentro de la pista propia
    const antes = t.slice(inicio, idx);
    const trasConector = /[,;]\s*$/.test(antes) || previa === 'y' || previa === 'e';
    const siguiente = trasConector ? (pistaTrasConector(t.slice(idx)) ?? pistaAbridora(t.slice(idx)))
      : NO_PARTIR_TRAS.has(previa) ? null : pistaAbridora(t.slice(idx));
    previa = palabra;
    if (!siguiente) continue;
    const actual = parte(idx);
    if (actual.seccion === siguiente.seccion || !actual.texto) continue; // misma sección: no se parte
    cerrar(actual);
    inicio = idx;
    empezarParte();
    k = 1;
  }
  cerrar(parte(t.length));
  return partes;
}

/**
 * Reparte una frase final del reconocedor entre secciones y devuelve la sección que queda vigente.
 * Palabras clave explícitas mandan; si la frase (o su tramo inicial) no trae ninguna, se infiere por pista natural.
 */
export function enrutarDictado(original: string, seccionActual: SeccionDictado, opciones: { inferir?: boolean } = {}): { partes: ParteDictado[]; seccion: SeccionDictado } {
  const inferir = opciones.inferir ?? true;
  // La clave inicial mal escuchada se corrige primero («obhetivo …» → «objetivo …»).
  const texto = corregirClaveInicial(original).frase;
  const partes: ParteDictado[] = [];
  let seccion = seccionActual;
  let cursor = 0;
  let primera = true;
  const agregar = (t: string) => {
    if (!t) return;
    // La cabeza del tramo se infiere solo si NO viene de una palabra clave (esa ya la asignó el profesional);
    // pero cualquier tramo puede traer varias oraciones seguidas, y donde empieza otra se parte.
    if (inferir) for (const p of repartirTramo(t, seccion, primera)) { partes.push(p); seccion = p.seccion; }
    else partes.push({ seccion, texto: t });
    primera = false;
  };
  for (const m of texto.matchAll(RE_CLAVE)) {
    const idx = m.index ?? 0;
    agregar(texto.slice(cursor, idx).trim());
    primera = false;
    seccion = seccionDeAlias(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? '');
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

// ─── Reparto de TODA la transcripción (1.7) ──────────────────────────────────
// El dictado en vivo va llenando los campos frase por frase, pero lo que manda es la
// TRANSCRIPCIÓN completa que quedó guardada: al terminar, se vuelve a repartir entera y el
// profesional revisa el resultado campo por campo antes de aplicarlo. Cada línea de la
// transcripción es una frase final del reconocedor (así la guarda el hook), y la sección vigente
// se arrastra de una línea a la siguiente, igual que al dictar.
export interface PropuestaDictado {
  /** Texto propuesto para cada campo de la nota (ya unido y con mayúsculas de frase). */
  campos: Record<CampoPropuesta, string>;
  /** Diagnósticos dictados, en orden («diagnóstico definitivo onicomicosis principal»). */
  diagnosticos: DiagnosticoDictado[];
  /** Lesiones dictadas para el podograma («lesión heloma quinto dedo izquierdo»). */
  lesiones: LesionDictada[];
  /** Cuántas frases fueron a cada sección (para mostrar el resumen). */
  frases: Partial<Record<SeccionDictado, number>>;
  /** Cada frase con la sección a la que fue y por qué (para el panel «Lo que se escuchó»). */
  partes: ParteDictado[];
  /** Sección que queda vigente al final (lo que se dicte después sigue ahí). */
  seccion: SeccionDictado;
}
export type CampoPropuesta = 'subjetivo' | 'objetivo' | 'apreciacion' | 'plan' | 'observacion' | 'procedimiento';
export const CAMPOS_PROPUESTA: CampoPropuesta[] = ['subjetivo', 'objetivo', 'apreciacion', 'plan', 'observacion', 'procedimiento'];
export const CAMPO_PROPUESTA_LABEL: Record<CampoPropuesta, string> = {
  subjetivo: 'Subjetivo · lo que cuenta el paciente',
  objetivo: 'Objetivo · lo que observas',
  apreciacion: 'Apreciación · tu análisis',
  plan: 'Plan · qué se hará (incluye las indicaciones)',
  observacion: 'Observaciones',
  procedimiento: 'Procedimiento · detalle',
};

/** Una línea por frase: así guarda el hook la transcripción y así se vuelve a repartir. */
export function lineasDeTranscripcion(texto: string): string[] {
  return texto.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Une dos frases dictadas como oraciones: cierra la anterior con punto (el reconocedor no dicta
 * signos) para que la nota se lea bien y `anexarDictado` ponga la mayúscula inicial. Se usa al
 * repartir la transcripción y también al dictar en vivo, para que el texto salga igual por los
 * dos caminos. El micrófono de UN campo sigue anexando tal cual (ahí el profesional dicta seguido).
 */
export function unirFrase(previo: string, texto: string): string {
  const base = previo.replace(/\s+$/, '');
  return anexarDictado(base && !/[.!?:\n]$/.test(base) ? `${base}.` : base, texto);
}

/**
 * Reparte TODA la transcripción entre los campos. Es una función PURA y sin memoria: se la vuelve
 * a llamar con el texto completo cada vez que el micrófono entrega algo y el resultado se ESCRIBE
 * ENCIMA de los campos (no se suma). Por eso, aunque el navegador reenvíe lo mismo diez veces, la
 * nota queda igual: no hay forma de que una frase entre dos veces.
 */
export function repartirTranscripcion(texto: string, opciones: { inferir?: boolean; inicial?: SeccionDictado } = {}): PropuestaDictado {
  const campos: Record<CampoPropuesta, string> = { subjetivo: '', objetivo: '', apreciacion: '', plan: '', observacion: '', procedimiento: '' };
  const diagnosticos: DiagnosticoDictado[] = [];
  const lesiones: LesionDictada[] = [];
  const frases: Partial<Record<SeccionDictado, number>> = {};
  const todasLasPartes: ParteDictado[] = [];
  let seccion: SeccionDictado = opciones.inicial ?? 'subjetivo';
  let indicacionesAbiertas = false; // la primera indicación abre línea propia con su rótulo

  for (const linea of lineasDeTranscripcion(limpiarRepeticiones(texto))) {
    const { partes, seccion: nueva } = enrutarDictado(linea, seccion, opciones);
    for (const parte of partes) {
      frases[parte.seccion] = (frases[parte.seccion] ?? 0) + 1;
      todasLasPartes.push(parte);
      if (parte.seccion === 'diagnostico') { diagnosticos.push(interpretarDiagnostico(parte.texto)); continue; }
      if (parte.seccion === 'lesion') { lesiones.push(interpretarLesion(parte.texto)); continue; }
      if (parte.seccion === 'indicaciones') {
        // Las indicaciones viven en el Plan, en línea aparte y con rótulo (igual que al dictar).
        if (indicacionesAbiertas) campos.plan = unirFrase(campos.plan, parte.texto);
        else {
          const previo = campos.plan.trim() ? `${campos.plan.replace(/\s+$/, '')}${/[.!?]$/.test(campos.plan.trim()) ? '' : '.'}\n` : campos.plan;
          campos.plan = anexarDictado(previo, `Indicaciones: ${parte.texto}`);
        }
        indicacionesAbiertas = true;
        continue;
      }
      if (parte.seccion === 'plan' && indicacionesAbiertas) {
        // Se vuelve al plan después de las indicaciones: línea nueva para no mezclarlo con ellas.
        indicacionesAbiertas = false;
        campos.plan = anexarDictado(`${campos.plan.replace(/\s+$/, '')}${/[.!?]$/.test(campos.plan.trim()) ? '' : '.'}\n`, parte.texto);
        continue;
      }
      campos[parte.seccion] = unirFrase(campos[parte.seccion], parte.texto);
    }
    seccion = nueva;
  }
  return { campos, diagnosticos, lesiones, frases, partes: todasLasPartes, seccion };
}

/**
 * Reparte varios tramos seguidos, cada uno con la sección en la que arranca. Sirve para los chips
 * de sección: cuando el profesional toca «Objetivo» a media consulta, lo dictado ANTES se queda
 * como estaba y lo de después arranca en Objetivo, sin dejar de ser una función del texto (lo que
 * permite volver a repartir todo en cada aviso del micrófono, sin sumar nada).
 */
export function repartirSegmentos(
  segmentos: { texto: string; inicial?: SeccionDictado }[],
  opciones: { inferir?: boolean } = {},
): PropuestaDictado {
  const total: PropuestaDictado = {
    campos: { subjetivo: '', objetivo: '', apreciacion: '', plan: '', observacion: '', procedimiento: '' },
    diagnosticos: [], lesiones: [], frases: {}, partes: [], seccion: segmentos[0]?.inicial ?? 'subjetivo',
  };
  for (const seg of segmentos) {
    if (!seg.texto.trim()) continue;
    const r = repartirTranscripcion(seg.texto, { ...opciones, inicial: seg.inicial });
    for (const c of CAMPOS_PROPUESTA) if (r.campos[c].trim()) total.campos[c] = unirFrase(total.campos[c], r.campos[c]);
    total.diagnosticos.push(...r.diagnosticos);
    total.lesiones.push(...r.lesiones);
    total.partes.push(...r.partes);
    for (const s of SECCIONES) if (r.frases[s]) total.frases[s] = (total.frases[s] ?? 0) + r.frases[s]!;
    total.seccion = r.seccion;
  }
  return total;
}

/**
 * Quita de `propuesto` el arranque que ya quedó escrito en el campo. Se usa cuando el profesional
 * corrige a mano un campo mientras dicta: su texto se respeta y lo que siga se escribe debajo.
 */
export function quitarYaEscrito(propuesto: string, yaEscrito: string): string {
  if (!yaEscrito.trim()) return propuesto;
  if (propuesto.startsWith(yaEscrito)) return propuesto.slice(yaEscrito.length).trim();
  return quitarSolape(yaEscrito, propuesto);
}

/** ¿Dos líneas dicen lo mismo (sin mirar tildes, mayúsculas ni signos)? */
function igualLinea(a: string, b: string): boolean {
  return empiezaCon(a, b) && empiezaCon(b, a);
}

/**
 * Junta lo que ya se llevaba dictado con lo que el navegador entrega AHORA.
 *
 * Los reconocedores no se portan todos igual y hay que aguantar a los tres:
 *   · el normal manda TODA la lista de la sesión en cada aviso (y la vuelve a mandar al corregir);
 *   · al cortarse por silencio reinicia y suele repetir la última frase;
 *   · alguno manda solo lo último que oyó.
 * Por eso no se puede ni «pegar siempre» (repetiría) ni «reemplazar siempre» (borraría). Se mira
 * si lo que llega continúa lo que había: si sí, manda lo que llega; si solo trae el final de lo
 * anterior, se pega sin repetirlo; y si no tiene nada que ver, se agrega. El resultado no cambia
 * aunque el navegador mande lo mismo diez veces.
 */
export function fusionarDictado(previo: string, nuevo: string): string {
  const a = lineasDeTranscripcion(previo);
  const b = lineasDeTranscripcion(nuevo);
  if (!b.length) return previo;
  if (!a.length) return b.join('\n');
  // 1 · Lo que llega es todo lo anterior y además más cosas (la última frase puede venir completada).
  const continuaTodo = b.length >= a.length
    && a.every((l, i) => (i === a.length - 1 ? empiezaCon(b[i]!, l) : igualLinea(b[i]!, l)));
  if (continuaTodo) return b.join('\n');
  // 2 · Lo que llega empieza con el final de lo anterior: se pega sin repetir esas frases.
  for (let k = Math.min(a.length, b.length); k >= 1; k--) {
    let coincide = true;
    for (let j = 0; j < k; j++) {
      const la = a[a.length - k + j]!;
      const lb = b[j]!;
      if (!(j === k - 1 ? empiezaCon(lb, la) : igualLinea(la, lb))) { coincide = false; break; }
    }
    if (coincide) return [...a.slice(0, a.length - k), ...b].join('\n');
  }
  // 3 · No tiene relación con lo anterior: es texto nuevo.
  return [...a, ...b].join('\n');
}
