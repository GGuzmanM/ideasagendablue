/**
 * Consentimiento informado OFICIAL (formato 2, 18-sep-2026) — funciones PURAS, sin base de datos.
 *
 * La clínica envió el formato de matricectomía (y va a enviar los demás): un documento por secciones
 * (I datos del paciente … X revocatoria). La plantilla guarda SOLO lo propio del procedimiento
 * (qué es, en qué consiste, beneficios, riesgos A/B/C, riesgos particulares, medicamentos,
 * alternativas y cuidados) más a qué SERVICIOS aplica. Lo común a todos (datos del paciente, la
 * declaración de conformidad, las firmas, la revocatoria y el marco normativo) lo pone el sistema.
 * En los textos, **así** va en negrita, como en el original.
 */

export interface ContenidoConsentimiento {
  version: 2;
  titulo: string;
  /** Cómo se nombra en la declaración: «…en qué consiste el procedimiento de {nombreCorto}…». */
  nombreCorto: string;
  /** «Nombre del procedimiento: …» */
  procedimiento: string;
  explicaciones: { titulo: string; texto: string }[];
  aclaracion: { titulo: string; parrafos: string[] } | null;
  beneficios: string[];
  notaBeneficios: string;
  riesgos: { frecuentes: string[]; pocoFrecuentes: string[]; raros: string[] };
  riesgosParticulares: string[];
  medicamentos: string[];
  alternativas: string[];
  cuidados: string[];
  campos: { dedos: boolean; alcance: string[] };
  /** Servicios de la agenda que necesitan ESTE consentimiento (filtra y avisa). */
  servicioIds: string[];
  /** Cuántos días vale una firma para volver a hacer el tratamiento sin firmar otra vez. */
  vigenciaDias: number;
}

export interface DatosConsentimiento {
  dedos: string | null;
  alcance: string | null;
  riesgos: string[];
  otraCondicion: string | null;
  domicilio: string | null;
  telefono: string | null;
  representante: { nombre: string; documento: string; parentesco: string } | null;
  testigo: { nombre: string; documento: string | null } | null;
}

export class ErrorConsentimiento extends Error {
  constructor(public code: string, mensaje: string) { super(mensaje); }
}

const MAX_TEXTO = 4000, MAX_ITEMS = 40;
const texto = (v: unknown, max = MAX_TEXTO) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const lista = (v: unknown, max = MAX_TEXTO) =>
  (Array.isArray(v) ? v : []).map((x) => texto(x, max)).filter(Boolean).slice(0, MAX_ITEMS);

export const esFormatoOficial = (c: unknown): boolean =>
  !!c && typeof c === 'object' && (c as { version?: unknown }).version === 2;

/**
 * Limpia y valida una plantilla por secciones. Lanza ErrorConsentimiento si le falta lo esencial:
 * un consentimiento sin procedimiento, sin riesgos o sin alternativas no informa lo que exige la ley.
 */
export function normalizarContenido(raw: unknown): ContenidoConsentimiento {
  const r = (raw ?? {}) as Record<string, unknown>;
  const riesgos = (r.riesgos ?? {}) as Record<string, unknown>;
  const campos = (r.campos ?? {}) as Record<string, unknown>;
  const acl = r.aclaracion as { titulo?: unknown; parrafos?: unknown } | null | undefined;
  const c: ContenidoConsentimiento = {
    version: 2,
    titulo: texto(r.titulo, 300),
    nombreCorto: texto(r.nombreCorto, 200),
    procedimiento: texto(r.procedimiento),
    explicaciones: (Array.isArray(r.explicaciones) ? r.explicaciones : [])
      .map((e) => ({ titulo: texto((e as { titulo?: unknown })?.titulo, 200), texto: texto((e as { texto?: unknown })?.texto) }))
      .filter((e) => e.texto).slice(0, 10),
    aclaracion: acl && lista(acl.parrafos).length ? { titulo: texto(acl.titulo, 200) || 'Aclaración importante', parrafos: lista(acl.parrafos) } : null,
    beneficios: lista(r.beneficios),
    notaBeneficios: texto(r.notaBeneficios),
    riesgos: { frecuentes: lista(riesgos.frecuentes), pocoFrecuentes: lista(riesgos.pocoFrecuentes), raros: lista(riesgos.raros) },
    riesgosParticulares: lista(r.riesgosParticulares, 200),
    medicamentos: lista(r.medicamentos),
    alternativas: lista(r.alternativas),
    cuidados: lista(r.cuidados),
    campos: { dedos: campos.dedos === true, alcance: lista(campos.alcance, 80).slice(0, 6) },
    servicioIds: [...new Set(lista(r.servicioIds, 40).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))],
    vigenciaDias: Math.min(3650, Math.max(1, Math.round(Number(r.vigenciaDias) || 180))),
  };
  const falta: string[] = [];
  if (!c.titulo) falta.push('el título');
  if (!c.nombreCorto) falta.push('cómo se nombra el procedimiento');
  if (!c.procedimiento) falta.push('el nombre del procedimiento');
  if (!c.riesgos.frecuentes.length && !c.riesgos.pocoFrecuentes.length && !c.riesgos.raros.length) falta.push('los riesgos');
  if (!c.alternativas.length) falta.push('las alternativas');
  if (falta.length) throw new ErrorConsentimiento('PLANTILLA_INCOMPLETA', `Al consentimiento le falta ${falta.join(', ')}`);
  return c;
}

/** Lo llenado al firmar, validado contra la plantilla (solo riesgos y alcance que la plantilla ofrece). */
export function validarDatos(raw: unknown, c: ContenidoConsentimiento, relacion: 'paciente' | 'apoderado'): DatosConsentimiento {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rep = (r.representante ?? null) as Record<string, unknown> | null;
  const tes = (r.testigo ?? null) as Record<string, unknown> | null;
  const alcance = texto(r.alcance, 80) || null;
  if (alcance && !c.campos.alcance.includes(alcance)) throw new ErrorConsentimiento('ALCANCE_INVALIDO', 'Ese alcance no corresponde a este procedimiento');
  const riesgos = [...new Set(lista(r.riesgos, 200))];
  const ajenos = riesgos.filter((x) => !c.riesgosParticulares.includes(x));
  if (ajenos.length) throw new ErrorConsentimiento('RIESGO_INVALIDO', `Riesgo no listado en la plantilla: ${ajenos[0]}`);
  let representante: DatosConsentimiento['representante'] = null;
  if (relacion === 'apoderado') {
    const nombre = texto(rep?.nombre, 200), documento = texto(rep?.documento, 20), parentesco = texto(rep?.parentesco, 80);
    if (nombre.length < 3 || !documento || !parentesco) {
      throw new ErrorConsentimiento('FALTA_REPRESENTANTE', 'Del representante legal hacen falta su nombre, su documento y su parentesco o vínculo');
    }
    representante = { nombre, documento, parentesco };
  }
  const testigoNombre = texto(tes?.nombre, 200);
  return {
    dedos: c.campos.dedos ? texto(r.dedos, 200) || null : null,
    alcance,
    riesgos,
    otraCondicion: texto(r.otraCondicion, 300) || null,
    domicilio: texto(r.domicilio, 300) || null,
    telefono: texto(r.telefono, 30) || null,
    representante,
    testigo: testigoNombre.length >= 3 ? { nombre: testigoNombre, documento: texto(tes?.documento, 20) || null } : null,
  };
}

/**
 * Riesgos particulares que la HISTORIA ya conoce, para premarcarlos (el profesional los revisa).
 * Se reconocen por el texto de la casilla, así sirve para cualquier plantilla que traiga casillas
 * parecidas («Diabetes», «Tratamiento anticoagulante…», «Mala circulación…», «Tabaquismo»…).
 */
export function riesgosSugeridos(
  casillas: string[],
  h: { banderas: string[]; alergiasActivas: number; antecedentes: string },
): string[] {
  const b = new Set(h.banderas);
  const ant = h.antecedentes.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const reglas: { re: RegExp; si: () => boolean }[] = [
    { re: /diabet/, si: () => b.has('diabetes') },
    { re: /anticoag|antiagreg/, si: () => b.has('anticoagulado') },
    { re: /circulaci|arteri/, si: () => b.has('eap') },
    { re: /coagulaci(o|ó)n/, si: () => /hemofil|coagulopat|trombocitopen|von willebrand/.test(ant) },
    { re: /sensibilidad|neuropat/, si: () => b.has('neuropatia') || b.has('psp') },
    { re: /alergi/, si: () => h.alergiasActivas > 0 },
    { re: /[uú]lcera/, si: () => b.has('ulcera') },
    { re: /embarazo|lactancia/, si: () => /embaraz|gestant|lactan/.test(ant) },
    { re: /defensas|inmuno/, si: () => b.has('inmuno') },
    { re: /tabaq|fuma/, si: () => b.has('tabaco') },
    { re: /queloide|hipertr(o|ó)fica/, si: () => /queloide|cicatriz hipertrof/.test(ant) },
  ];
  return casillas.filter((cas) => {
    const t = cas.toLowerCase();
    // «Trastorno de la coagulación» no debe caer en la regla de anticoagulantes (y al revés).
    const regla = reglas.find((r) => r.re.test(t));
    return !!regla && regla.si();
  });
}

/** Quita las marcas de negrita. */
export const sinMarcas = (s: string) => s.replace(/\*\*/g, '');

/** Partes de un texto con negritas: [{ t, b }]. */
export function trozosNegrita(s: string): { t: string; b: boolean }[] {
  const out: { t: string; b: boolean }[] = [];
  s.split(/(\*\*[^*]+\*\*)/g).forEach((p) => {
    if (!p) return;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) out.push({ t: p.slice(2, -2), b: true });
    else out.push({ t: p.replace(/\*\*/g, ''), b: false });
  });
  return out;
}

/** Declaración de conformidad (sección IX): igual para todos, con el procedimiento dentro. */
export function declaracion(nombreCorto: string): string[] {
  return [
    `Declaro que el profesional tratante me ha explicado, en lenguaje sencillo y comprensible, en qué consiste el procedimiento de **${nombreCorto}**, los beneficios que se esperan, los riesgos y complicaciones específicos descritos en este documento, los riesgos particulares de mi caso, los medicamentos y materiales que se utilizarán y las alternativas existentes, incluida la de no someterme a ningún tratamiento.`,
    'Declaro que he tenido la oportunidad de formular todas las preguntas que consideré necesarias, que estas me han sido respondidas de forma satisfactoria, y que he dispuesto del tiempo suficiente para reflexionar y tomar mi decisión.',
    'Declaro además que he informado con veracidad sobre mi estado de salud, enfermedades, alergias y medicamentos que consumo.',
    'En consecuencia, **autorizo de forma libre y voluntaria** la realización del procedimiento descrito, sabiendo que puedo revocar esta autorización en cualquier momento, antes de su inicio, sin necesidad de expresar el motivo y sin que ello afecte la atención que recibo.',
  ];
}

export const MARCO_NORMATIVO = 'Marco normativo aplicable: Ley N.° 26842, Ley General de Salud (arts. 4 y 15). Ley N.° 29414, Ley que establece los derechos de las personas usuarias de los servicios de salud. Decreto Supremo N.° 027-2015-SA, Reglamento de la Ley N.° 29414 (art. 24, consentimiento informado). NTS N.° 139-MINSA/2018/DGAIN, Norma Técnica de Salud para la Gestión de la Historia Clínica (el consentimiento informado forma parte de la historia clínica). Precedente de observancia obligatoria de SUSALUD, Acuerdo de Consejo Directivo N.° 006-2018-SUSALUD/CD (publicado el 20/12/2018), sobre el registro del consentimiento informado en las IPRESS.';
export const EJEMPLARES = 'Ejemplares: este documento se emite por duplicado. Un ejemplar se archiva en la historia clínica del paciente y el otro se entrega al paciente. El consentimiento debe obtenerse con la debida anticipación al procedimiento, nunca en el momento inmediato previo a su ejecución.';

/**
 * Texto plano de TODO lo que se leyó y firmó (se guarda en `texto`: búsqueda, historia en PDF y
 * cualquier lector que no entienda el formato por secciones).
 */
export function textoPlano(c: ContenidoConsentimiento, d: DatosConsentimiento, p: { firmante: string; relacion: 'paciente' | 'apoderado' }): string {
  const L: string[] = [];
  const vi = (xs: string[]) => xs.forEach((x) => L.push(`• ${sinMarcas(x)}`));
  L.push(`CONSENTIMIENTO INFORMADO — ${c.titulo}`);
  L.push('II. PROCEDIMIENTO PROPUESTO', `Nombre del procedimiento: ${sinMarcas(c.procedimiento)}`);
  if (c.campos.dedos) L.push(`Dedo o dedos a intervenir: ${d.dedos ?? '—'}`);
  if (c.campos.alcance.length) L.push(`Alcance: ${d.alcance ?? '—'}`);
  c.explicaciones.forEach((e) => L.push(`${e.titulo}: ${sinMarcas(e.texto)}`));
  if (c.aclaracion) { L.push(c.aclaracion.titulo.toUpperCase()); c.aclaracion.parrafos.forEach((x) => L.push(sinMarcas(x))); }
  L.push('III. BENEFICIOS QUE SE ESPERAN OBTENER'); vi(c.beneficios); if (c.notaBeneficios) L.push(sinMarcas(c.notaBeneficios));
  L.push('IV. RIESGOS Y COMPLICACIONES DEL PROCEDIMIENTO');
  L.push('A. Efectos esperables y frecuentes'); vi(c.riesgos.frecuentes);
  L.push('B. Complicaciones poco frecuentes'); vi(c.riesgos.pocoFrecuentes);
  L.push('C. Complicaciones raras, pero graves'); vi(c.riesgos.raros);
  L.push('V. RIESGOS PARTICULARES EN SU CASO');
  L.push(d.riesgos.length || d.otraCondicion ? [...d.riesgos, ...(d.otraCondicion ? [`Otra condición: ${d.otraCondicion}`] : [])].map((x) => `☒ ${x}`).join('\n') : 'Ninguno marcado.');
  L.push('VI. MEDICAMENTOS Y MATERIALES QUE SE UTILIZARÁN Y SUS POSIBLES EFECTOS'); c.medicamentos.forEach((x) => L.push(sinMarcas(x)));
  L.push('VII. ALTERNATIVAS AL PROCEDIMIENTO PROPUESTO'); vi(c.alternativas);
  L.push('VIII. CUIDADOS POSTERIORES Y COMPROMISOS DEL PACIENTE'); vi(c.cuidados);
  L.push('IX. DECLARACIÓN DE CONFORMIDAD'); declaracion(c.nombreCorto).forEach((x) => L.push(sinMarcas(x)));
  L.push(`Firmó: ${p.firmante}${p.relacion === 'apoderado' && d.representante ? ` (representante legal, ${d.representante.parentesco}, doc. ${d.representante.documento})` : ''}`);
  if (d.testigo) L.push(`Testigo: ${d.testigo.nombre}${d.testigo.documento ? `, doc. ${d.testigo.documento}` : ''}`);
  return L.join('\n');
}

// ─── Qué consentimiento falta ─────────────────────────────────────────────────
export interface PlantillaResumen { id: string; clave: string | null; nombre: string; servicioIds: string[]; vigenciaDias: number }
export interface FirmaResumen { plantillaClave: string | null; plantillaId: string | null; estado: string; firmadoEn: Date; citaId: string | null }

/** Plantillas oficiales que exige un servicio. */
export const plantillasDelServicio = (plantillas: PlantillaResumen[], servicioIds: string[]) =>
  plantillas.filter((p) => p.servicioIds.some((s) => servicioIds.includes(s)));

/**
 * ¿Hay una firma que cubra esta plantilla para una cita en `fechaCita`? Vale la firmada PARA esa cita
 * o cualquiera no revocada firmada hasta `vigenciaDias` antes de la cita (y no después de ella + 1 día,
 * por si se firma el mismo día un poco más tarde que la hora de la cita).
 */
export function firmaVigente<F extends FirmaResumen>(p: PlantillaResumen, firmas: F[], fechaCita: Date, citaId: string | null): F | null {
  const desde = fechaCita.getTime() - p.vigenciaDias * 86_400_000;
  const hasta = fechaCita.getTime() + 36 * 3_600_000;
  const validas = firmas.filter((f) => f.estado === 'firmado' && (f.plantillaId === p.id || (!!p.clave && f.plantillaClave === p.clave)));
  return validas.find((f) => citaId && f.citaId === citaId)
    ?? validas.filter((f) => f.firmadoEn.getTime() >= desde && f.firmadoEn.getTime() <= hasta).sort((a, b) => b.firmadoEn.getTime() - a.firmadoEn.getTime())[0]
    ?? null;
}

/** Plantillas que el servicio exige y todavía no tienen firma vigente. */
export function consentimientosPendientes(plantillas: PlantillaResumen[], servicioIds: string[], firmas: FirmaResumen[], fechaCita: Date, citaId: string | null) {
  return plantillasDelServicio(plantillas, servicioIds).filter((p) => !firmaVigente(p, firmas, fechaCita, citaId));
}
