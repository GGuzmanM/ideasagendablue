// Cierre inteligente: qué le falta a una atención antes de cerrarla. Avisa, no bloquea.
// MISMA regla y MISMOS textos que el servidor (apps/api/src/services/bloque3Service.ts →
// faltantesDeAtencion, que usa la Bandeja clínica): si se cambia uno, cambiar el otro.
export function faltantesAtencion(a: {
  diagnosticos: { principal: boolean }[]; notas: unknown[]; procedimientos: unknown[];
  marcasPodograma: unknown[]; imagenesPodograma: unknown[]; recetas: { estado: string }[];
  dibujosSilueta?: { anotaciones?: unknown[] }[];
}): string[] {
  const f: string[] = [];
  if (!a.diagnosticos.length) f.push('Sin diagnóstico');
  else if (!a.diagnosticos.some((d) => d.principal)) f.push('Sin diagnóstico principal');
  if (!a.notas.length) f.push('Sin nota de evolución');
  if (!a.procedimientos.length) f.push('Sin procedimiento (si hubo tratamiento)');
  const dibujado = (a.dibujosSilueta ?? []).some((d) => (d.anotaciones?.length ?? 0) > 0);
  if (!a.marcasPodograma.length && !a.imagenesPodograma.length && !dibujado) f.push('Podograma vacío');
  // Una receta anulada no cuenta como receta.
  if (!a.recetas.some((r) => r.estado === 'emitida')) f.push('Sin receta ni indicaciones');
  return f;
}
