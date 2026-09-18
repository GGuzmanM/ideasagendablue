/**
 * Reportes clínicos (7.1, 7.3 y 7.4) — la parte que se puede probar sin base de datos.
 *
 * Son tres preguntas distintas sobre las mismas atenciones:
 *   · QUÉ VEMOS (7.1, epidemiológico): qué diagnósticos aparecen, dónde y en qué edades. Sin nombres:
 *     son conteos, y por eso se puede mirar por sede sin exponer a nadie.
 *   · CUÁNTO SE HACE (7.3, productividad): atenciones, pacientes distintos y procedimientos por
 *     profesional o por sede.
 *   · CÓMO SE REGISTRA (7.4, calidad): de las atenciones cerradas, cuántas quedaron con diagnóstico,
 *     con nota y con lo que corresponde. No mide a la persona, mide el registro.
 *
 * Aquí viven el agrupamiento y los cálculos (puros, con pruebas); las consultas y los permisos están
 * en routes/reportesClinicos.ts.
 */

export type Agrupar = 'diagnostico' | 'profesional' | 'sede' | 'procedimiento' | 'edad';

/** Una atención ya aplanada: es lo único que necesitan los cálculos. */
export interface AtencionPlana {
  id: string;
  fecha: Date | string;
  sedeId: string;
  sedeNombre: string;
  profesionalId: string | null;
  profesionalNombre: string;
  pacienteId: string;
  /** Edad del paciente el día de la atención (null si no hay fecha de nacimiento). */
  edad: number | null;
  cerrada: boolean;
  diagnosticos: { codigo: string; descripcion: string; principal: boolean }[];
  procedimientos: { tipo: string; nombre: string }[];
  /** ¿La nota tiene algo escrito? (cualquiera de S/O/A/P o el texto libre). */
  conNota: boolean;
  conReceta: boolean;
  conFoto: boolean;
  conConsentimiento: boolean;
}

export interface FilaReporte {
  clave: string;
  etiqueta: string;
  atenciones: number;
  pacientes: number;
  /** Porcentaje sobre el total de atenciones del rango, redondeado a un decimal. */
  porcentaje: number;
  /** Solo en «profesional» y «sede»: cuántos procedimientos se registraron. */
  procedimientos?: number;
}

export const RANGOS_EDAD: { hasta: number; etiqueta: string }[] = [
  { hasta: 11, etiqueta: '0 a 11 años' },
  { hasta: 17, etiqueta: '12 a 17 años' },
  { hasta: 29, etiqueta: '18 a 29 años' },
  { hasta: 44, etiqueta: '30 a 44 años' },
  { hasta: 59, etiqueta: '45 a 59 años' },
  { hasta: 74, etiqueta: '60 a 74 años' },
  { hasta: 200, etiqueta: '75 años a más' },
];

export function rangoDeEdad(edad: number | null): { clave: string; etiqueta: string } {
  if (edad == null || edad < 0) return { clave: 'sin-edad', etiqueta: 'Sin fecha de nacimiento' };
  const r = RANGOS_EDAD.find((x) => edad <= x.hasta) ?? RANGOS_EDAD[RANGOS_EDAD.length - 1]!;
  return { clave: r.etiqueta, etiqueta: r.etiqueta };
}

const redondear = (n: number, dec = 1) => Math.round(n * 10 ** dec) / 10 ** dec;

/**
 * Agrupa las atenciones según lo pedido. Ojo con el conteo: una atención con DOS diagnósticos suma
 * en los dos, así que la suma de la columna puede superar el total de atenciones; el porcentaje
 * siempre se calcula sobre el total de atenciones del rango, que es lo que la gente espera leer.
 */
export function agrupar(atenciones: AtencionPlana[], por: Agrupar): FilaReporte[] {
  const total = atenciones.length;
  const mapa = new Map<string, { etiqueta: string; atenciones: Set<string>; pacientes: Set<string>; procedimientos: number }>();
  const anotar = (clave: string, etiqueta: string, a: AtencionPlana, procs = 0) => {
    const g = mapa.get(clave) ?? { etiqueta, atenciones: new Set<string>(), pacientes: new Set<string>(), procedimientos: 0 };
    g.atenciones.add(a.id);
    g.pacientes.add(a.pacienteId);
    g.procedimientos += procs;
    mapa.set(clave, g);
  };

  for (const a of atenciones) {
    if (por === 'diagnostico') {
      if (!a.diagnosticos.length) anotar('sin-dx', 'Sin diagnóstico registrado', a);
      else for (const d of a.diagnosticos) anotar(d.codigo, d.descripcion || d.codigo, a);
    } else if (por === 'procedimiento') {
      if (!a.procedimientos.length) anotar('sin-proc', 'Sin procedimiento registrado', a);
      else for (const p of a.procedimientos) anotar(p.tipo, p.nombre || p.tipo, a, 1);
    } else if (por === 'profesional') {
      anotar(a.profesionalId ?? 'sin-profesional', a.profesionalNombre || 'Sin profesional', a, a.procedimientos.length);
    } else if (por === 'sede') {
      anotar(a.sedeId, a.sedeNombre, a, a.procedimientos.length);
    } else {
      const r = rangoDeEdad(a.edad);
      anotar(r.clave, r.etiqueta, a);
    }
  }

  const filas = [...mapa.entries()].map(([clave, g]) => ({
    clave,
    etiqueta: g.etiqueta,
    atenciones: g.atenciones.size,
    pacientes: g.pacientes.size,
    porcentaje: total ? redondear((g.atenciones.size * 100) / total) : 0,
    ...(por === 'profesional' || por === 'sede' || por === 'procedimiento' ? { procedimientos: g.procedimientos } : {}),
  }));
  // De mayor a menor; a igualdad, alfabético. Lo «sin registrar» siempre al final, aunque sea grande:
  // es un aviso de calidad, no un resultado clínico.
  const suelto = (c: string) => (c === 'sin-dx' || c === 'sin-proc' || c === 'sin-profesional' || c === 'sin-edad' ? 1 : 0);
  return filas.sort((x, y) => suelto(x.clave) - suelto(y.clave) || y.atenciones - x.atenciones || x.etiqueta.localeCompare(y.etiqueta, 'es'));
}

export interface FilaCalidad {
  clave: string;
  etiqueta: string;
  cerradas: number;
  conDiagnostico: number;
  conNota: number;
  conProcedimiento: number;
  conConsentimiento: number;
  /** Porcentaje de atenciones cerradas que tienen diagnóstico Y nota: lo mínimo de una historia. */
  completas: number;
}

/**
 * Calidad del registro por profesional. Solo mira atenciones CERRADAS: una abierta todavía se está
 * escribiendo y contarla sería injusto.
 */
export function calidadPorProfesional(atenciones: AtencionPlana[]): FilaCalidad[] {
  const cerradas = atenciones.filter((a) => a.cerrada);
  const mapa = new Map<string, FilaCalidad>();
  for (const a of cerradas) {
    const clave = a.profesionalId ?? 'sin-profesional';
    const f = mapa.get(clave) ?? {
      clave, etiqueta: a.profesionalNombre || 'Sin profesional',
      cerradas: 0, conDiagnostico: 0, conNota: 0, conProcedimiento: 0, conConsentimiento: 0, completas: 0,
    };
    f.cerradas += 1;
    if (a.diagnosticos.length) f.conDiagnostico += 1;
    if (a.conNota) f.conNota += 1;
    if (a.procedimientos.length) f.conProcedimiento += 1;
    if (a.conConsentimiento) f.conConsentimiento += 1;
    mapa.set(clave, f);
  }
  return [...mapa.values()]
    .map((f) => ({ ...f, completas: f.cerradas ? redondear((atenciones.filter((a) => a.cerrada && (a.profesionalId ?? 'sin-profesional') === f.clave && a.diagnosticos.length > 0 && a.conNota).length * 100) / f.cerradas) : 0 }))
    .sort((x, y) => y.cerradas - x.cerradas || x.etiqueta.localeCompare(y.etiqueta, 'es'));
}

export interface TotalesReporte {
  atenciones: number;
  cerradas: number;
  pacientes: number;
  conDiagnostico: number;
  procedimientos: number;
  /** % de atenciones cerradas con diagnóstico y nota. */
  completas: number;
}

export function totales(atenciones: AtencionPlana[]): TotalesReporte {
  const cerradas = atenciones.filter((a) => a.cerrada);
  const completas = cerradas.filter((a) => a.diagnosticos.length > 0 && a.conNota).length;
  return {
    atenciones: atenciones.length,
    cerradas: cerradas.length,
    pacientes: new Set(atenciones.map((a) => a.pacienteId)).size,
    conDiagnostico: atenciones.filter((a) => a.diagnosticos.length > 0).length,
    procedimientos: atenciones.reduce((n, a) => n + a.procedimientos.length, 0),
    completas: cerradas.length ? redondear((completas * 100) / cerradas.length) : 0,
  };
}

/** Edad cumplida el día de la atención. */
export function edadEn(nacimiento: Date | string | null | undefined, fecha: Date | string): number | null {
  if (!nacimiento) return null;
  const n = new Date(nacimiento);
  const f = new Date(fecha);
  if (Number.isNaN(n.getTime()) || Number.isNaN(f.getTime())) return null;
  let edad = f.getUTCFullYear() - n.getUTCFullYear();
  const mes = f.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && f.getUTCDate() < n.getUTCDate())) edad -= 1;
  return edad >= 0 && edad < 130 ? edad : null;
}
