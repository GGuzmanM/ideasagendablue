// Cierre inteligente: qué le falta a una atención antes de cerrarla. Avisa, no bloquea.
// MISMA regla y MISMOS textos que el servidor (apps/api/src/services/bloque3Service.ts →
// faltantesDeAtencion, que usa la Bandeja clínica): si se cambia uno, cambiar el otro.
export const textoSinEscala = (n: number) => (n === 1 ? '1 hallazgo del mapa corporal sin escala' : `${n} hallazgos del mapa corporal sin escala`);

export function faltantesAtencion(a: {
  diagnosticos: { principal: boolean }[]; notas: unknown[]; procedimientos: unknown[];
  marcasPodograma: unknown[]; imagenesPodograma: unknown[]; recetas: { estado: string }[];
  dibujosSilueta?: { vista?: string; anotaciones?: unknown[] }[]; motivoConsulta?: string | null;
}, o: { fisio?: boolean } = {}): string[] {
  const f: string[] = [];
  if (a.motivoConsulta !== undefined && !(a.motivoConsulta ?? '').trim()) f.push('Falta el motivo de consulta');
  if (!a.diagnosticos.length) f.push('Sin diagnóstico');
  else if (!a.diagnosticos.some((d) => d.principal)) f.push('Sin diagnóstico principal');
  if (!a.notas.length) f.push('Sin nota de evolución');
  if (!a.procedimientos.length) f.push('Sin procedimiento (si hubo tratamiento)');
  const dibujado = (a.dibujosSilueta ?? []).some((d) => (d.anotaciones?.length ?? 0) > 0);
  // 24-nov-2026 · Fisioterapia: no emite receta; lo gráfico es el mapa corporal (también vive en dibujosSilueta).
  if (o.fisio) {
    if (!dibujado) f.push('Mapa corporal sin marcar');
    // La escala va por punto: se avisa de los hallazgos que quedaron sin su escala (EVA / intensidad).
    const sinEscala = (a.dibujosSilueta ?? []).filter((d) => d.vista === 'cuerpo3d')
      .flatMap((d) => d.anotaciones ?? []).filter((m) => (m as { intensidad?: number | null }).intensidad == null).length;
    if (sinEscala) f.push(textoSinEscala(sinEscala));
    return f;
  }
  if (!a.marcasPodograma.length && !a.imagenesPodograma.length && !dibujado) f.push('Podograma vacío');
  // Una receta anulada no cuenta como receta.
  if (!a.recetas.some((r) => r.estado === 'emitida')) f.push('Sin receta ni indicaciones');
  return f;
}
