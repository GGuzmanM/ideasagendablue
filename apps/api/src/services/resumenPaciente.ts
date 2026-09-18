/**
 * RESUMEN DE LA ATENCIÓN PARA EL PACIENTE (4.4) — qué se le entrega al paciente al terminar.
 *
 * La historia clínica está escrita para el profesional: siglas, CIE-10, S/O/A/P. Esto lo traduce a
 * lo que el paciente necesita saber al llegar a su casa: qué le hicieron, qué tiene, qué debe hacer,
 * cuándo volver y cuándo pedir ayuda antes. No inventa nada: solo ordena y pone en palabras simples
 * lo que el profesional ya registró (por eso no necesita IA ni internet).
 *
 * Este archivo es PURO a propósito (no toca base de datos ni PDF): así se prueba entero sin montar
 * nada. El servicio que lo alimenta es resumenPacienteService.ts.
 */

export interface EntradaResumen {
  paciente: { nombres: string; apellidoPaterno: string; apellidoMaterno: string };
  fecha: Date | string;
  sede: string;
  profesional: string;
  servicio: string;
  /** Notas de evolución de la atención (la más reciente manda para el plan). */
  notas: { apreciacion?: string | null; plan?: string | null; texto?: string | null; creadoEn?: Date | string }[];
  diagnosticos: { descripcion: string; codigo: string; principal: boolean }[];
  procedimientos: { nombre: string; pie?: string | null; ubicacion?: string | null }[];
  /** Ítems de las recetas e indicaciones emitidas (las anuladas no llegan aquí). */
  tratamiento: { nombre: string; dosis?: string | null; frecuencia?: string | null; duracion?: string | null; indicaciones?: string | null; tipo?: string | null }[];
  /** Texto libre del documento de indicaciones, si se emitió. */
  indicacionesGenerales?: string | null;
  /** Controles propuestos al cerrar (los que siguen pendientes o ya agendados). */
  controles: { fechaSugerida: Date | string; motivo?: string | null; estado: string }[];
  /** Antecedentes que cambian los cuidados (diabetes, anticoagulación…). */
  banderas?: { diabetes?: boolean };
}

export interface Resumen {
  titulo: string;
  paciente: string;
  fecha: string;
  sede: string;
  profesional: string;
  secciones: { titulo: string; items: string[]; nota?: string }[];
  /** Fecha del próximo control, si hay, ya en texto («lunes 29 de septiembre»). */
  proximoControl: string | null;
  pie: string;
}

const LIMA = 'America/Lima';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Fecha en palabras, como se la diría a un paciente: «lunes 29 de septiembre de 2026».
 *
 * Ojo con la zona horaria, que aquí es fácil equivocarse por un día: las fechas de calendario de la
 * base (`@db.Date`: la fecha de la atención, la del control) llegan como medianoche UTC y NO hay que
 * moverlas a Lima, porque entonces retroceden al día anterior. En cambio un instante real (algo con
 * hora, como «enviado a las 19:30») sí se lee en hora de Lima. Se distinguen porque el primero cae
 * exactamente a las 00:00 UTC.
 */
export function fechaEnPalabras(f: Date | string): string {
  const d = typeof f === 'string' ? new Date(f.length <= 10 ? `${f}T00:00:00Z` : f) : f;
  if (Number.isNaN(d.getTime())) return '';
  const esFechaDeCalendario = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  const partes = new Intl.DateTimeFormat('en-CA', {
    ...(esFechaDeCalendario ? { timeZone: 'UTC' } : { timeZone: LIMA }),
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const local = new Date(`${v('year')}-${v('month')}-${v('day')}T12:00:00Z`);
  return `${DIAS[local.getUTCDay()]} ${Number(v('day'))} de ${MESES[Number(v('month')) - 1]} de ${v('year')}`;
}

const limpio = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
/** Primera letra en mayúscula y punto final: para que cada línea se lea como una frase. */
export function comoFrase(s: string): string {
  const t = limpio(s).replace(/^[-•·*\s]+/, '');
  if (!t) return '';
  const con = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?:]$/.test(con) ? con : `${con}.`;
}
const PIE_LABEL: Record<string, string> = { izquierdo: 'pie izquierdo', derecho: 'pie derecho', ambos: 'ambos pies' };

/**
 * Separa el PLAN en dos: lo que hará la clínica y lo que tiene que hacer el paciente en casa. El
 * dictado ya escribe las indicaciones en su propia línea con el rótulo «Indicaciones:», y quien
 * escribe a mano suele hacer lo mismo; si no hay rótulo, todo el plan se toma como lo que sigue.
 */
export function partirPlan(plan?: string | null): { plan: string[]; indicaciones: string[] } {
  const lineas = (plan ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: { plan: string[]; indicaciones: string[] } = { plan: [], indicaciones: [] };
  let enIndicaciones = false;
  for (const linea of lineas) {
    const m = /^indicaciones\s*:\s*(.*)$/i.exec(linea);
    if (m) { enIndicaciones = true; if (m[1]!.trim()) out.indicaciones.push(m[1]!.trim()); continue; }
    (enIndicaciones ? out.indicaciones : out.plan).push(linea);
  }
  return out;
}

/**
 * Cómo tomar o usar algo, en una línea y como se dice en voz alta: «1 tableta, cada 8 horas, por 7
 * días». En la receta la frecuencia y la duración se escriben sueltas («12 horas», «3 días»), así
 * que se les pone delante «cada» y «por» cuando el profesional no los escribió.
 */
export function comoUsarlo(t: EntradaResumen['tratamiento'][number]): string {
  const frecuencia = limpio(t.frecuencia);
  const duracion = limpio(t.duracion);
  const conCada = frecuencia && !/^(cada|c\/|una vez|dos veces|tres veces|\d+\s*(veces|vez)|al |por |en ayunas|antes|despu[eé]s|noche|ma[ñn]ana|diari|semanal|mensual|continuo)/i.test(frecuencia)
    ? `cada ${frecuencia}` : frecuencia;
  const conPor = duracion && !/^(por|durante|hasta|mientras|\d+\s*(d[ií]as?|semanas?|meses?|a[ñn]os?)\s*(m[aá]s|seguidos)?$)/i.test(duracion)
    ? `por ${duracion}` : duracion;
  const conPorFinal = duracion && /^\d/.test(duracion) ? `por ${duracion}` : conPor;
  const detalle = [limpio(t.dosis), conCada, conPorFinal].filter(Boolean).join(', ');
  const extra = limpio(t.indicaciones);
  return [detalle, extra].filter(Boolean).join(' — ');
}

/** Señales por las que hay que volver antes de la fecha del control. */
export function señalesDeAlarma(banderas?: EntradaResumen['banderas']): string[] {
  const base = [
    'El dolor aumenta en vez de calmar, o no te deja dormir.',
    'Sale pus, mal olor o el líquido cambia de color.',
    'La zona se pone más roja, caliente o hinchada, o el enrojecimiento avanza hacia el pie o la pierna.',
    'Tienes fiebre o escalofríos.',
    'La herida crece, se abre o se pone negra.',
  ];
  if (banderas?.diabetes) {
    base.push('Por tu diabetes, no esperes a la próxima cita: cualquiera de estas señales es motivo para venir el mismo día.');
  }
  return base;
}

/** Arma el resumen completo. Las secciones vacías no se incluyen: nada de títulos sin contenido. */
export function armarResumen(e: EntradaResumen): Resumen {
  const nombre = `${e.paciente.nombres} ${e.paciente.apellidoPaterno} ${e.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();
  const secciones: Resumen['secciones'] = [];

  // 1 · Qué se hizo hoy.
  const hecho = e.procedimientos.map((p) => {
    const donde = [p.ubicacion ? limpio(p.ubicacion) : '', p.pie ? PIE_LABEL[p.pie] ?? limpio(p.pie) : ''].filter(Boolean).join(', ');
    return comoFrase(donde ? `${limpio(p.nombre)} (${donde})` : limpio(p.nombre));
  }).filter(Boolean);
  if (!hecho.length && limpio(e.servicio)) hecho.push(comoFrase(e.servicio));
  if (hecho.length) secciones.push({ titulo: 'Qué te hicimos hoy', items: hecho });

  // 2 · Qué tienes. Se escribe la descripción, no el código: el código va entre paréntesis y pequeño.
  const dx = [...e.diagnosticos].sort((a, b) => Number(b.principal) - Number(a.principal))
    .map((d) => comoFrase(limpio(d.descripcion) || d.codigo));
  if (dx.length) secciones.push({ titulo: 'Qué tienes', items: dx });

  // 3 · Tratamiento indicado.
  const trat = e.tratamiento.map((t) => {
    const como = comoUsarlo(t);
    return comoFrase(como ? `${limpio(t.nombre)}: ${como}` : limpio(t.nombre));
  }).filter(Boolean);
  if (trat.length) secciones.push({ titulo: 'Tu tratamiento', items: trat, nota: 'Si te entregamos una receta, sigue lo que dice ahí.' });

  // 4 · Cuidados en casa: las indicaciones de la nota más el texto del documento de indicaciones.
  const ultima = [...e.notas].sort((a, b) => new Date(b.creadoEn ?? 0).getTime() - new Date(a.creadoEn ?? 0).getTime())[0];
  const partido = partirPlan(ultima?.plan);
  const cuidados = [
    ...partido.indicaciones,
    ...(limpio(e.indicacionesGenerales) ? limpio(e.indicacionesGenerales).split('\n') : []),
  ].map(comoFrase).filter(Boolean);
  const cuidadosUnicos = [...new Set(cuidados)];
  if (cuidadosUnicos.length) secciones.push({ titulo: 'Qué debes hacer en casa', items: cuidadosUnicos });

  // 5 · Qué sigue (lo que hará la clínica): el resto del plan.
  const sigue = partido.plan.map(comoFrase).filter(Boolean);
  if (sigue.length) secciones.push({ titulo: 'Qué sigue en tu tratamiento', items: [...new Set(sigue)] });

  // 6 · Próximo control.
  const pendientes = e.controles
    .filter((c) => c.estado !== 'descartado')
    .sort((a, b) => new Date(a.fechaSugerida).getTime() - new Date(b.fechaSugerida).getTime());
  const proximo = pendientes[0] ?? null;
  const proximoControl = proximo ? fechaEnPalabras(proximo.fechaSugerida) : null;
  if (proximo) {
    const motivo = limpio(proximo.motivo);
    secciones.push({
      titulo: 'Cuándo volver',
      items: [comoFrase(`Tu próximo control es el ${proximoControl}${motivo ? `, para ${motivo.toLowerCase()}` : ''}`)],
      nota: proximo.estado === 'agendado' ? 'Ya tienes esta cita agendada.' : 'Aún no está agendada: llámanos o escríbenos para reservarla.',
    });
  }

  // 7 · Cuándo pedir ayuda antes (siempre va: es lo que evita una complicación).
  secciones.push({ titulo: 'Vuelve antes si…', items: señalesDeAlarma(e.banderas) });

  return {
    titulo: 'Resumen de tu atención',
    paciente: nombre,
    fecha: fechaEnPalabras(e.fecha),
    sede: limpio(e.sede),
    profesional: limpio(e.profesional),
    secciones,
    proximoControl,
    pie: 'Este resumen es para que recuerdes lo conversado. No reemplaza tu receta ni tu historia clínica. Si tienes dudas, escríbenos o llámanos.',
  };
}
