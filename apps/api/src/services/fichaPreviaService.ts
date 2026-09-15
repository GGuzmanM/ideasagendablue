// Ficha previa "de 10 segundos" (2.8 de la lista del doctor): lo mínimo que hay que saber ANTES
// de entrar al consultorio, para el modal de la cita y la ficha del paciente. Banderas de riesgo
// calculadas con reglas explícitas (sin IA) sobre antecedentes, alergias, diagnósticos y escalas.
// También expone las escalas del paciente a lo largo de sus atenciones (comparar visitas, curvas).
import { prisma } from '../db';
import { paquetesLaserVivos, categoriaIwgdfDe } from './bloque3Service';

export type NivelBandera = 'alto' | 'medio' | 'info';
export interface Bandera { clave: string; etiqueta: string; nivel: NivelBandera }

const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Reglas por texto de antecedente (activos). Cada regla: patrón sobre el texto normalizado.
const REGLAS_ANTECEDENTE: { re: RegExp; clave: string; etiqueta: string; nivel: NivelBandera }[] = [
  { re: /diabet/, clave: 'diabetes', etiqueta: 'Diabetes', nivel: 'alto' },
  { re: /anticoag|warfarin|apixab|rivaroxab|dabigatr|clopidogrel|heparina|acenocumarol/, clave: 'anticoagulado', etiqueta: 'Anticoagulado / antiagregado', nivel: 'alto' },
  { re: /insuficiencia renal|enfermedad renal|dialisis|nefropat/, clave: 'renal', etiqueta: 'Enfermedad renal', nivel: 'medio' },
  { re: /arteriopat|arterial periferica|claudicacion|isquemia/, clave: 'eap', etiqueta: 'Enfermedad arterial periférica', nivel: 'medio' },
  { re: /neuropat/, clave: 'neuropatia', etiqueta: 'Neuropatía', nivel: 'medio' },
  { re: /inmunosupr|quimioterap|corticoide|trasplant|vih/, clave: 'inmuno', etiqueta: 'Inmunosupresión', nivel: 'medio' },
  { re: /hipertens|\bhta\b/, clave: 'hta', etiqueta: 'Hipertensión', nivel: 'info' },
  { re: /latex/, clave: 'latex', etiqueta: 'Reacción al látex', nivel: 'alto' },
  { re: /fuma|tabaqu/, clave: 'tabaco', etiqueta: 'Fumador', nivel: 'info' },
];
// Reglas por código CIE-10 vigente en cualquier atención.
const REGLAS_DX: { re: RegExp; clave: string; etiqueta: string; nivel: NivelBandera }[] = [
  { re: /^E1[0-4]/, clave: 'diabetes', etiqueta: 'Diabetes', nivel: 'alto' },
  // E1x.4 es neuropatía (regla de abajo) y E1x.5 complicaciones circulatorias: no son úlcera.
  { re: /^(L97|L89)/, clave: 'ulcera', etiqueta: 'Úlcera registrada', nivel: 'alto' },
  { re: /^E1[0-4]\.5/, clave: 'eap', etiqueta: 'Diabetes con complicación circulatoria', nivel: 'medio' },
  { re: /^I7[03]/, clave: 'eap', etiqueta: 'Enfermedad arterial periférica', nivel: 'medio' },
  { re: /^(G6[23]|E1[0-4]\.4)/, clave: 'neuropatia', etiqueta: 'Neuropatía', nivel: 'medio' },
];

/**
 * Lo que quedó del sistema anterior (Genexis, archivo congelado): cuántas visitas asistió y la
 * última. Sirve para que la ficha previa y la HC no digan «sin historia» a un paciente de años.
 */
export async function resumenGenexis(pacienteId: string) {
  const base = { pacienteId, deletedAt: null, llegoPaciente: 'Sí' };
  const [total, ultima] = await Promise.all([
    prisma.historialGenexis.count({ where: base }),
    prisma.historialGenexis.findFirst({
      where: base, orderBy: [{ fechaCita: 'desc' }, { horaCita: 'desc' }],
      select: { id: true, fechaCita: true, servicio: true, podologo: true, sede: true },
    }),
  ]);
  return { total, ultima: ultima ? { id: ultima.id, fecha: ultima.fechaCita, servicio: ultima.servicio, podologo: ultima.podologo, sede: ultima.sede } : null };
}

export async function fichaPrevia(pacienteId: string) {
  const genexis = await resumenGenexis(pacienteId);
  const hcRow = await prisma.historiaClinica.findUnique({
    where: { pacienteId },
    select: {
      id: true, numero: true,
      alergias: { where: { deletedAt: null, activa: true }, select: { sustancia: true, reaccion: true, severidad: true }, orderBy: { creadoEn: 'asc' } },
      antecedentes: { where: { deletedAt: null, activo: true }, select: { tipo: true, descripcion: true } },
    },
  });
  const paquetes = await paquetesLaserVivos(pacienteId);
  const sesionesPendientes = paquetes.filter((q) => q.sesionesRestantes > 0).map((q) => ({ nombre: q.nombre, restantes: q.sesionesRestantes, total: q.sesionesTotal, vigenciaFin: q.vigenciaFin }));
  if (!hcRow) {
    return { tieneHistoria: false, numero: null, alergias: [], banderas: [] as Bandera[], riesgoIwgdf: null, ultimoDx: null, ultimoProcedimiento: null, ultimaAtencion: null, fotoAnterior: null, monofilamentoAlterado: null, sesionesPendientes, totalAtenciones: 0, genexis };
  }

  const [ultima, totalAtenciones, dxTodos, escalas, foto] = await Promise.all([
    prisma.atencionClinica.findFirst({
      where: { pacienteId },
      orderBy: [{ fecha: 'desc' }, { creadoEn: 'desc' }],
      select: {
        id: true, fecha: true, motivoConsulta: true, estado: true,
        profesional: { select: { nombres: true, apellidos: true } }, sede: { select: { nombre: true } },
        diagnosticos: { where: { deletedAt: null }, orderBy: [{ principal: 'desc' }, { creadoEn: 'desc' }], take: 3, select: { cie10Codigo: true, tipo: true, principal: true, cie10: { select: { descripcion: true } } } },
        procedimientos: { where: { deletedAt: null }, orderBy: { creadoEn: 'desc' }, take: 1, select: { tipo: true, nombre: true, pie: true, ubicacion: true, creadoEn: true } },
      },
    }),
    prisma.atencionClinica.count({ where: { pacienteId } }),
    prisma.diagnosticoAtencion.findMany({ where: { deletedAt: null, atencion: { pacienteId } }, select: { cie10Codigo: true }, distinct: ['cie10Codigo'] }),
    prisma.escalaClinica.findMany({
      where: { deletedAt: null, atencion: { pacienteId } },
      orderBy: { creadoEn: 'desc' },
      select: { tipo: true, datos: true, resultado: true, creadoEn: true, atencion: { select: { fecha: true } } },
    }),
    prisma.fotoClinica.findFirst({ where: { pacienteId, deletedAt: null }, orderBy: { tomadaEn: 'desc' }, select: { id: true, zona: true, pie: true, tomadaEn: true } }),
  ]);

  // Última escala de cada tipo (la lista viene de más nueva a más vieja).
  const ultimaPorTipo = new Map<string, (typeof escalas)[number]>();
  for (const e of escalas) if (!ultimaPorTipo.has(e.tipo)) ultimaPorTipo.set(e.tipo, e);
  const iwgdf = ultimaPorTipo.get('iwgdf');
  const categoria = iwgdf ? categoriaIwgdfDe(iwgdf) : null;
  const mf = ultimaPorTipo.get('monofilamento');
  const mfDatos = (mf?.datos ?? {}) as Record<string, unknown>;
  const mfAlterado = mf ? [mfDatos.izquierdo, mfDatos.derecho].some((l) => Array.isArray(l) && l.some((v) => v === false)) : null;
  const wagner = ultimaPorTipo.get('wagner');
  const wagnerGrado = typeof (wagner?.datos as Record<string, unknown> | undefined)?.grado === 'number' ? ((wagner!.datos as Record<string, unknown>).grado as number) : null;
  const ulcera = ultimaPorTipo.get('ulcera');
  // EAP por el último ITB (≤ 0,90) o algún pulso ausente.
  const itbDatos = (ultimaPorTipo.get('itb')?.datos ?? {}) as Record<string, unknown>;
  const itbMin = [itbDatos.itbIzq, itbDatos.itbDer].filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).reduce<number | null>((m, v) => (m == null || v < m ? v : m), null);
  const pulsoAusente = Object.values((itbDatos.pulsos && typeof itbDatos.pulsos === 'object' ? itbDatos.pulsos : {}) as Record<string, unknown>).includes('ausente');

  // ── Banderas de riesgo (deduplicadas por clave; gana el nivel más alto) ──
  const banderas = new Map<string, Bandera>();
  const poner = (b: Bandera) => { const prev = banderas.get(b.clave); if (!prev || orden(b.nivel) > orden(prev.nivel)) banderas.set(b.clave, b); };
  for (const a of hcRow.antecedentes) {
    // Un antecedente FAMILIAR («madre con diabetes») no es del paciente; una negación («no fuma», «niega
    // diabetes») tampoco levanta bandera.
    if (a.tipo === 'familiar') continue;
    const t = sinAcentos(a.descripcion);
    if (/^(no |niega|sin |nunca )/.test(t.trim())) continue;
    for (const r of REGLAS_ANTECEDENTE) if (r.re.test(t)) poner({ clave: r.clave, etiqueta: r.etiqueta, nivel: r.nivel });
  }
  for (const d of dxTodos) for (const r of REGLAS_DX) if (r.re.test(d.cie10Codigo)) poner({ clave: r.clave, etiqueta: r.etiqueta, nivel: r.nivel });
  for (const al of hcRow.alergias) if (al.severidad === 'severa') poner({ clave: `alergia:${al.sustancia}`, etiqueta: `Alergia severa: ${al.sustancia}`, nivel: 'alto' });
  if (categoria != null && categoria >= 2) poner({ clave: 'iwgdf', etiqueta: `Riesgo IWGDF ${categoria} (${categoria === 3 ? 'alto' : 'moderado'})`, nivel: 'alto' });
  else if (categoria === 1) poner({ clave: 'iwgdf', etiqueta: 'Riesgo IWGDF 1 (bajo)', nivel: 'medio' });
  if (mfAlterado) poner({ clave: 'psp', etiqueta: 'Sensibilidad protectora disminuida', nivel: 'medio' });
  if (itbMin != null && itbMin <= 0.9) poner({ clave: 'eap', etiqueta: `Enfermedad arterial: ITB ${itbMin.toFixed(2)}`, nivel: itbMin < 0.7 ? 'alto' : 'medio' });
  else if (pulsoAusente) poner({ clave: 'eap', etiqueta: 'Pulso pedio o tibial ausente', nivel: 'medio' });
  if (wagnerGrado != null && wagnerGrado >= 1) poner({ clave: 'ulcera', etiqueta: `Úlcera Wagner ${wagnerGrado}`, nivel: 'alto' });
  if (ulcera) poner({ clave: 'ulcera', etiqueta: 'Úlcera en seguimiento', nivel: 'alto' });
  if (sesionesPendientes.length) poner({ clave: 'sesiones', etiqueta: `${sesionesPendientes.reduce((n, q) => n + q.restantes, 0)} sesión(es) por usar`, nivel: 'info' });

  const dxPrincipal = ultima?.diagnosticos.find((d) => d.principal) ?? ultima?.diagnosticos[0] ?? null;
  const proc = ultima?.procedimientos[0] ?? null;
  return {
    tieneHistoria: true,
    numero: hcRow.numero,
    totalAtenciones,
    alergias: hcRow.alergias,
    banderas: [...banderas.values()].sort((a, b) => orden(b.nivel) - orden(a.nivel)),
    riesgoIwgdf: iwgdf && categoria != null ? { categoria, etiqueta: iwgdf.resultado, fecha: iwgdf.atencion.fecha } : null,
    monofilamentoAlterado: mfAlterado,
    ultimoDx: dxPrincipal && ultima ? { codigo: dxPrincipal.cie10Codigo, descripcion: dxPrincipal.cie10.descripcion, tipo: dxPrincipal.tipo, fecha: ultima.fecha } : null,
    ultimoProcedimiento: proc && ultima ? { tipo: proc.tipo, nombre: proc.nombre, pie: proc.pie, ubicacion: proc.ubicacion, fecha: ultima.fecha } : null,
    ultimaAtencion: ultima ? { id: ultima.id, fecha: ultima.fecha, estado: ultima.estado, motivoConsulta: ultima.motivoConsulta, profesional: `${ultima.profesional.nombres} ${ultima.profesional.apellidos}`.trim(), sede: ultima.sede.nombre } : null,
    fotoAnterior: foto,
    sesionesPendientes,
    genexis,
  };
}
const orden = (n: NivelBandera) => (n === 'alto' ? 3 : n === 'medio' ? 2 : 1);

/** Escalas del paciente en todas sus atenciones, de la más antigua a la más nueva (comparar visitas, curva de úlceras). */
export async function escalasDePaciente(pacienteId: string, tipo?: string) {
  const filas = await prisma.escalaClinica.findMany({
    where: { deletedAt: null, atencion: { pacienteId }, ...(tipo ? { tipo: tipo.trim().toLowerCase() } : {}) },
    select: { id: true, atencionId: true, tipo: true, datos: true, resultado: true, pie: true, creadoEn: true, atencion: { select: { fecha: true } } },
  });
  return filas
    .map(({ atencion, ...e }) => ({ ...e, fecha: atencion.fecha }))
    .sort((a, b) => (a.fecha.getTime() - b.fecha.getTime()) || (a.creadoEn.getTime() - b.creadoEn.getTime()));
}

/**
 * Historial del podograma: todo lo registrado sobre el pie del paciente, atención por atención
 * (puntos, dibujos, fotos, procedimientos y mediciones de úlcera). El front lo reparte por zona.
 */
export async function historialPodograma(pacienteId: string) {
  const atenciones = await prisma.atencionClinica.findMany({
    where: { pacienteId },
    orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }],
    select: {
      id: true, fecha: true,
      profesional: { select: { nombres: true, apellidos: true } },
      marcasPodograma: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { id: true, pie: true, vista: true, x: true, y: true, zona: true, tipoLesion: true, nota: true } },
      dibujosSilueta: { where: { deletedAt: null }, select: { vista: true, pie: true, anotaciones: true } },
      fotos: { where: { deletedAt: null }, orderBy: { tomadaEn: 'asc' }, select: { id: true, pie: true, zona: true, categoria: true, descripcion: true, tomadaEn: true } },
      procedimientos: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { id: true, tipo: true, nombre: true, pie: true, ubicacion: true, detalle: true } },
      escalas: { where: { deletedAt: null, tipo: 'ulcera' }, orderBy: { creadoEn: 'asc' }, select: { id: true, datos: true, resultado: true, pie: true } },
    },
  });
  return atenciones.map((a) => ({
    atencionId: a.id, fecha: a.fecha, profesional: `${a.profesional.nombres} ${a.profesional.apellidos}`.trim(),
    marcas: a.marcasPodograma, dibujos: a.dibujosSilueta, fotos: a.fotos, procedimientos: a.procedimientos, ulceras: a.escalas,
  }));
}
