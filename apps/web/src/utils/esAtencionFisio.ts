/** 24-nov-2026: ¿la atención es de Fisioterapia? (la atendió una fisioterapeuta o la cita es del área). Fisio no emite receta y
 *  tiene el mapa corporal 3D; su escala va por punto del mapa (EVA en cada dolor) y sale al final de la atención. */
export function esAtencionFisio(a: { profesional?: { tipo?: string | null } | null; cita?: { unidadNegocio?: { nombre?: string } | null } | null } | null | undefined): boolean {
  if (!a) return false;
  return a.profesional?.tipo === 'fisioterapeuta' || /fisioterap/i.test(a.cita?.unidadNegocio?.nombre ?? '');
}
