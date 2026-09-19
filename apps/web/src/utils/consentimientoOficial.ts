// Consentimiento OFICIAL por secciones: plantilla vacía para uno nuevo y limpieza antes de guardar.
import type { ContenidoConsentimiento } from '../api/consentimientos';

export const consentimientoVacio = (): ContenidoConsentimiento => ({
  version: 2, titulo: '', nombreCorto: '', procedimiento: '', explicaciones: [{ titulo: 'En qué consiste, explicado en términos sencillos', texto: '' }],
  aclaracion: null, beneficios: [], notaBeneficios: '', riesgos: { frecuentes: [], pocoFrecuentes: [], raros: [] },
  riesgosParticulares: ['Diabetes', 'Tratamiento anticoagulante o antiagregante', 'Mala circulación en las piernas o los pies', 'Trastorno de la coagulación', 'Pérdida de sensibilidad en los pies (neuropatía)', 'Alergia a anestésicos o a algún medicamento', 'Antecedente de úlcera en el pie', 'Embarazo o lactancia', 'Defensas bajas o tratamiento inmunosupresor', 'Tabaquismo'],
  medicamentos: [], alternativas: [], cuidados: [], campos: { dedos: false, alcance: [] }, servicioIds: [], vigenciaDias: 180,
});


/** Quita líneas vacías antes de guardar. */
export function limpiarConsentimiento(c: ContenidoConsentimiento): ContenidoConsentimiento {
  const l = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
  return {
    ...c,
    beneficios: l(c.beneficios), medicamentos: l(c.medicamentos), alternativas: l(c.alternativas), cuidados: l(c.cuidados),
    riesgosParticulares: l(c.riesgosParticulares),
    riesgos: { frecuentes: l(c.riesgos.frecuentes), pocoFrecuentes: l(c.riesgos.pocoFrecuentes), raros: l(c.riesgos.raros) },
    campos: { ...c.campos, alcance: l(c.campos.alcance) },
    aclaracion: c.aclaracion && l(c.aclaracion.parrafos).length ? { titulo: c.aclaracion.titulo, parrafos: l(c.aclaracion.parrafos) } : null,
    explicaciones: c.explicaciones.filter((e) => e.texto.trim()),
  };
}
