// Texto del consentimiento informado (5.1 + 5.2). Se arma en DOS partes, siempre:
//
//   1. ENCABEZADO, que pone el sistema: quién firma, con qué documento y en calidad de qué. Es el
//      dato legal que identifica a la persona y nunca puede faltar, así que no se deja a la
//      plantilla (si alguien la edita y lo borra, el documento quedaría cojo).
//   2. CUERPO, que sale de una PLANTILLA por procedimiento (matricectomía, láser, curación…) o,
//      si no hay ninguna que corresponda, del texto general. El cuerpo admite marcadores entre
//      llaves —{paciente}, {procedimiento}, {profesional}…— que se reemplazan al mostrarlo.
//
// Lo que se firma se guarda como copia fija (snapshot) en el consentimiento: cambiar la plantilla
// después NO cambia lo ya firmado. Todo esto es texto: el profesional puede ajustarlo antes de
// firmar, y el contenido definitivo lo decide la clínica con su asesor legal.
import type { PlantillaClinica, RelacionFirmante, TipoProcedimiento } from '../api/historiaClinica';

export interface DatosConsentimiento {
  firmante: string;
  documento: string;
  relacion: RelacionFirmante;
  paciente: string;
  profesional: string;
  procedimiento: string;
  sede?: string;
}

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Forma comparable de un texto: sin tildes, en minúsculas y sin signos ni espacios de más. */
export const clavePlantilla = (s: string) => sinAcentos(s.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Encabezado legal: quién firma y en calidad de qué. Lo pone siempre el sistema. */
export function encabezadoConsentimiento(p: DatosConsentimiento): string {
  const firmante = p.firmante.trim() || '________';
  const documento = p.documento.trim() || '________';
  return p.relacion === 'apoderado'
    ? `Yo, ${firmante}, identificado(a) con ${documento}, en mi calidad de apoderado(a) o representante de ${p.paciente},`
    : `Yo, ${firmante}, identificado(a) con ${documento},`;
}

/** Cuerpo general, el de siempre: sirve para cualquier procedimiento que no tenga plantilla propia. */
export function cuerpoGeneral(p: DatosConsentimiento): string {
  const proc = p.procedimiento.trim() || '________';
  return [
    `declaro que ${p.profesional} me ha explicado de forma clara y comprensible, y con palabras que entiendo:`,
    `1. En qué consiste el procedimiento «${proc}», su finalidad y cómo se realiza.`,
    '2. Los beneficios que se esperan y las alternativas disponibles, incluida la de no realizarlo y sus consecuencias.',
    '3. Los riesgos y molestias posibles: dolor, sangrado, infección, reacción a la anestesia local o a los productos que se usen, retraso en la cicatrización y que la lesión vuelva a aparecer. En personas con diabetes o mala circulación estos riesgos pueden ser mayores.',
    '4. Los cuidados que debo seguir después y la importancia de acudir a los controles indicados.',
    'He podido hacer preguntas y me las han respondido. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que eso afecte mi atención.',
    'Por lo anterior, doy mi consentimiento libre y voluntario para que se me realice el procedimiento indicado (Ley N° 26842, Ley General de Salud, arts. 4 y 15, y Ley N° 29414).',
  ].join('\n');
}

/** Reemplaza los marcadores {…} de una plantilla por los datos de esta atención. */
export function aplicarDatos(texto: string, p: DatosConsentimiento): string {
  const valores: Record<string, string> = {
    paciente: p.paciente,
    firmante: p.firmante.trim() || p.paciente,
    documento: p.documento.trim() || '________',
    profesional: p.profesional,
    procedimiento: p.procedimiento.trim() || '________',
    sede: p.sede ?? '',
  };
  // Un marcador desconocido se deja tal cual: es preferible que se vea a que desaparezca sin avisar.
  return texto.replace(/\{([a-zA-ZñÑ]+)\}/g, (entero, nombre: string) => valores[nombre.toLowerCase()] ?? entero);
}

/**
 * Elige la plantilla que corresponde al procedimiento que se está autorizando. Primero por el tipo
 * del procedimiento registrado en la atención (la clave de la plantilla es ese mismo slug), y si no,
 * por el nombre escrito: la plantilla «Láser» vale para «Sesión de láser en uña del primer dedo».
 */
export function plantillaParaProcedimiento(
  plantillas: PlantillaClinica[],
  p: { tipo?: TipoProcedimiento | null; texto: string },
): PlantillaClinica | null {
  const activas = plantillas.filter((x) => x.tipo === 'consentimiento' && x.activa);
  if (!activas.length) return null;
  if (p.tipo) {
    const porTipo = activas.find((x) => (x.clave ?? '').trim().toLowerCase() === p.tipo);
    if (porTipo) return porTipo;
  }
  const texto = clavePlantilla(p.texto);
  if (!texto) return null;
  // Gana la coincidencia más específica, medida por lo que DE VERDAD casó: entre «Curación de herida
  // o úlcera» (que solo casa por su clave, «curacion») y «Curación de úlcera» (que casa por nombre
  // entero) para el texto «Curación de úlcera del talón», gana la segunda.
  const candidatas = activas
    .map((x) => {
      const nombre = clavePlantilla(x.nombre);
      const clave = clavePlantilla(x.clave ?? '');
      const casaNombre = !!nombre && texto.includes(nombre);
      const casaClave = !!clave && texto.includes(clave);
      return { x, puntaje: Math.max(casaNombre ? nombre.length : 0, casaClave ? clave.length : 0) };
    })
    .filter((c) => c.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje);
  return candidatas[0]?.x ?? null;
}

/** Texto completo que se va a firmar: encabezado del sistema + cuerpo (de plantilla o general). */
export function textoConsentimiento(p: DatosConsentimiento, plantilla?: PlantillaClinica | null): string {
  const cuerpoPlantilla = plantilla && typeof (plantilla.contenido as { texto?: unknown }).texto === 'string'
    ? aplicarDatos(String((plantilla.contenido as { texto: string }).texto).trim(), p)
    : null;
  return `${encabezadoConsentimiento(p)}\n${cuerpoPlantilla || cuerpoGeneral(p)}`;
}
