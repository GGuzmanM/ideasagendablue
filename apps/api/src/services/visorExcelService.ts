// Excel del Visor de Pacientes (23-oct-2026): las visitas del periodo (Llegó, En atención y Completada) con todo lo que se
// registró en su atención clínica — médico que atendió, diagnósticos, procedimientos y recetas — para administración y el
// auditor de médicos. Tres hojas: Resumen (totales por sede y por médico), Atenciones (una fila por cita) y Procedimientos
// (una fila por procedimiento: qué, pie y ubicación). Con «solo con procedimiento» quedan únicamente las visitas cuya atención tiene alguno.
import ExcelJS from 'exceljs';
import { prisma } from '../db';
import { fechaAStr } from '../utils/fechaLima';

type FiltroFecha = Date | { gte: Date; lte: Date };

export interface OpcionesExcelVisor {
  sedeId?: string;
  /** Solo las visitas de este médico (filtro del Visor con «Todas las sedes»). */
  medicoId?: string;
  medicoNombre?: string;
  fecha: FiltroFecha;
  soloConProcedimiento: boolean;
  /** Sin `receta_medica.ver` los ítems de la receta médica no se listan (receta reservada). */
  verRecetaMedica: boolean;
  periodo: string;
  sedeNombre: string;
  generadoPor: string;
}

const ESTADOS_VISITA = ['llego', 'en_atencion', 'completada'] as const;
const ESTADO_CITA: Record<string, string> = { llego: 'Llegó', en_atencion: 'En atención', completada: 'Completada' };
const PIE: Record<string, string> = { izquierdo: 'pie izquierdo', derecho: 'pie derecho', ambos: 'ambos pies' };

// Paleta de la marca (mismos tonos que la documentación del sistema)
const AZUL = 'FF0F4C9A';
const AZUL_CLARO = 'FFE8F0FB';
const ZEBRA = 'FFF7F9FC';
const BORDE = 'FFD5DDE8';
const VERDE = 'FFE7F6EC';

const horaLima = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
const minutosEntre = (a: Date | null | undefined, b: Date | null | undefined) =>
  a && b ? Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000)) : null;
const ddmmyyyy = (d: Date) => fechaAStr(d).split('-').reverse().join('/');
const persona = (p: { nombres: string; apellidos: string } | null | undefined) => (p ? `${p.nombres} ${p.apellidos}`.replace(/\s+/g, ' ').trim() : '');
function edadEn(nac: Date | null, ref: Date): number | null {
  if (!nac) return null;
  let e = ref.getUTCFullYear() - nac.getUTCFullYear();
  if (ref.getUTCMonth() < nac.getUTCMonth() || (ref.getUTCMonth() === nac.getUTCMonth() && ref.getUTCDate() < nac.getUTCDate())) e--;
  return e >= 0 && e < 130 ? e : null;
}

async function cargarVisitas(o: OpcionesExcelVisor) {
  return prisma.cita.findMany({
    where: { deletedAt: null, estado: { in: [...ESTADOS_VISITA] }, fecha: o.fecha, ...(o.sedeId ? { sedeId: o.sedeId } : {}), ...(o.medicoId ? { medicoId: o.medicoId } : {}) },
    select: {
      id: true, fecha: true, horaInicio: true, estado: true, slotGrupoId: true,
      llegoEn: true, enAtencionEn: true, completadaEn: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, telefono: true, fechaNacimiento: true } },
      sede: { select: { nombre: true } },
      unidadNegocio: { select: { nombre: true } },
      servicio: { select: { nombre: true } },
      subcategoria: { select: { nombre: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      medico: { select: { nombres: true, apellidos: true, colegiatura: true } },
      atencionClinica: {
        select: {
          id: true, estado: true,
          profesional: { select: { nombres: true, apellidos: true } },
          diagnosticos: { where: { deletedAt: null }, orderBy: [{ principal: 'desc' }, { creadoEn: 'asc' }], select: { cie10Codigo: true, principal: true, cie10: { select: { descripcion: true } } } },
          procedimientos: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { nombre: true, tipo: true, pie: true, ubicacion: true, sesionNumero: true, sesionesTotales: true } },
          recetas: { where: { estado: { not: 'anulada' } }, select: { tipoDocumento: true, items: { orderBy: { orden: 'asc' }, select: { nombre: true, dosis: true, frecuencia: true, duracion: true } } } },
        },
      },
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });
}

type Visita = Awaited<ReturnType<typeof cargarVisitas>>[number];
type Atencion = NonNullable<Visita['atencionClinica']>;

/** Fila lista para el Excel. En un bloque combinado la atención vive en la cita PRINCIPAL: la otra mitad la referencia sin repetir datos. */
interface Fila { v: Visita; at: Atencion | null; compartida: boolean }

function armarFilas(visitas: Visita[], soloConProcedimiento: boolean): Fila[] {
  const atPorGrupo = new Map<string, Atencion>();
  for (const v of visitas) if (v.slotGrupoId && v.atencionClinica) atPorGrupo.set(v.slotGrupoId, v.atencionClinica);
  const filas = visitas.map((v): Fila => {
    if (v.atencionClinica) return { v, at: v.atencionClinica, compartida: false };
    const at = v.slotGrupoId ? atPorGrupo.get(v.slotGrupoId) ?? null : null;
    return { v, at, compartida: !!at };
  });
  return soloConProcedimiento ? filas.filter((f) => (f.at?.procedimientos.length ?? 0) > 0) : filas;
}

const textoProcedimiento = (p: Atencion['procedimientos'][number]) => {
  const donde = [p.pie ? PIE[p.pie] ?? p.pie : '', p.ubicacion ?? ''].filter(Boolean).join(', ');
  const sesion = p.sesionNumero ? ` · sesión ${p.sesionNumero}${p.sesionesTotales ? `/${p.sesionesTotales}` : ''}` : '';
  return `${p.nombre}${donde ? ` (${donde})` : ''}${sesion}`;
};
const textoItem = (i: { nombre: string; dosis: string | null; frecuencia: string | null; duracion: string | null }) =>
  [i.nombre, i.dosis, i.frecuencia, i.duracion].filter((x) => x && x.trim()).join(' · ');

// ── Estilo ──────────────────────────────────────────────────────────────────────
function titulo(ws: ExcelJS.Worksheet, texto: string, sub: string, columnas: number) {
  ws.mergeCells(1, 1, 1, columnas);
  ws.mergeCells(2, 1, 2, columnas);
  const t = ws.getCell(1, 1); t.value = texto; t.font = { name: 'Calibri', size: 15, bold: true, color: { argb: AZUL } };
  const s = ws.getCell(2, 1); s.value = sub; s.font = { name: 'Calibri', size: 10, color: { argb: 'FF4B5563' } };
  ws.getRow(1).height = 24;
}
function cabecera(ws: ExcelJS.Worksheet, fila: number, titulos: string[]) {
  const r = ws.getRow(fila);
  r.values = titulos;
  r.height = 30;
  r.eachCell((c) => {
    c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: AZUL } } };
  });
}
interface Col<T> { t: string; w: number; v: (x: T) => string | number | null; texto?: boolean; wrap?: boolean; centro?: boolean }
function tabla<T>(ws: ExcelJS.Worksheet, filaCab: number, cols: Col<T>[], datos: T[], resaltar?: (x: T) => boolean) {
  ws.columns = cols.map((c) => ({ width: c.w }));
  cabecera(ws, filaCab, cols.map((c) => c.t));
  datos.forEach((d, i) => {
    const r = ws.getRow(filaCab + 1 + i);
    r.values = cols.map((c) => c.v(d) ?? '');
    const fondo = resaltar?.(d) ? VERDE : i % 2 ? ZEBRA : undefined;
    cols.forEach((c, k) => {
      const cel = r.getCell(k + 1);
      cel.font = { name: 'Calibri', size: 10 };
      cel.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: c.centro ? 'center' : 'left' };
      cel.border = { bottom: { style: 'hair', color: { argb: BORDE } } };
      if (c.texto) cel.numFmt = '@';
      if (fondo) cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } };
    });
  });
  if (datos.length) ws.autoFilter = { from: { row: filaCab, column: 1 }, to: { row: filaCab, column: cols.length } };
  ws.views = [{ state: 'frozen', ySplit: filaCab, xSplit: 0 }];
}

// ── Libro ───────────────────────────────────────────────────────────────────────
export async function generarExcelVisor(o: OpcionesExcelVisor) {
  const filas = armarFilas(await cargarVisitas(o), o.soloConProcedimiento);
  const propias = filas.filter((f) => f.at && !f.compartida); // cada atención una sola vez (para conteos y procedimientos)

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Limablue Agenda';
  wb.created = new Date();
  const filtros = `${o.periodo} · Sede: ${o.sedeNombre}${o.medicoNombre ? ` · Médico: ${o.medicoNombre}` : ''} · ${o.soloConProcedimiento ? 'Solo visitas con procedimiento' : 'Todas las visitas'}`;
  const generado = `Generado el ${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'long', timeStyle: 'short' })} por ${o.generadoPor}`;

  // 1) Resumen
  const rs = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: AZUL } } });
  rs.columns = [{ width: 34 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 18 }, { width: 16 }];
  titulo(rs, 'Visor de Pacientes — Resumen', `${filtros}\n${generado}`, 6);
  rs.getRow(2).height = 30;
  rs.getCell(2, 1).alignment = { wrapText: true, vertical: 'top' };
  const indicadores: [string, number][] = [
    ['Visitas', filas.length],
    ['Visitas con atención clínica', filas.filter((f) => f.at).length],
    ['Visitas con procedimiento', filas.filter((f) => (f.at?.procedimientos.length ?? 0) > 0).length],
    ['Procedimientos registrados', propias.reduce((s, f) => s + f.at!.procedimientos.length, 0)],
    ['Atenciones con receta médica', propias.filter((f) => f.at!.recetas.some((r) => r.tipoDocumento === 'RECETA_MEDICA')).length],
    ['Atenciones con indicaciones', propias.filter((f) => f.at!.recetas.some((r) => r.tipoDocumento !== 'RECETA_MEDICA')).length],
  ];
  indicadores.forEach(([k, n], i) => {
    const r = rs.getRow(4 + i);
    r.getCell(1).value = k; r.getCell(1).font = { name: 'Calibri', size: 11, color: { argb: 'FF374151' } };
    r.getCell(2).value = n; r.getCell(2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: AZUL } };
    r.getCell(2).alignment = { horizontal: 'center' };
    [1, 2].forEach((c) => { r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } }; r.getCell(c).border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } }; });
  });
  const agrupar = (clave: (f: Fila) => string) => {
    const m = new Map<string, { visitas: number; conProc: number; proc: number; rx: number; ind: number }>();
    for (const f of filas) {
      const k = clave(f) || '—';
      const a = m.get(k) ?? { visitas: 0, conProc: 0, proc: 0, rx: 0, ind: 0 };
      a.visitas++;
      if ((f.at?.procedimientos.length ?? 0) > 0) a.conProc++;
      if (f.at && !f.compartida) {
        a.proc += f.at.procedimientos.length;
        if (f.at.recetas.some((r) => r.tipoDocumento === 'RECETA_MEDICA')) a.rx++;
        if (f.at.recetas.some((r) => r.tipoDocumento !== 'RECETA_MEDICA')) a.ind++;
      }
      m.set(k, a);
    }
    return [...m.entries()].sort((x, y) => y[1].visitas - x[1].visitas);
  };
  let fila = 4 + indicadores.length + 2;
  for (const [tituloTabla, clave, etiqueta] of [
    ['Por sede', (f: Fila) => f.v.sede.nombre, 'Sede'],
    ['Por médico que atendió', (f: Fila) => persona(f.v.medico) || 'Sin médico asignado', 'Médico'],
  ] as const) {
    rs.getCell(fila, 1).value = tituloTabla;
    rs.getCell(fila, 1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: AZUL } };
    fila++;
    cabecera(rs, fila, [etiqueta, 'Visitas', 'Con procedimiento', 'Procedimientos', 'Con receta médica', 'Con indicaciones']);
    for (const [k, a] of agrupar(clave)) {
      fila++;
      const r = rs.getRow(fila);
      r.values = [k, a.visitas, a.conProc, a.proc, a.rx, a.ind];
      r.eachCell((c, n) => { c.font = { name: 'Calibri', size: 10 }; if (n > 1) c.alignment = { horizontal: 'center' }; c.border = { bottom: { style: 'hair', color: { argb: BORDE } } }; });
    }
    fila += 3;
  }

  // 2) Atenciones (una fila por cita)
  const wa = wb.addWorksheet('Atenciones', { properties: { tabColor: { argb: 'FF166534' } } });
  const colsA: Col<Fila>[] = [
    { t: 'Fecha', w: 11, v: (f) => ddmmyyyy(f.v.fecha), centro: true },
    { t: 'Hora', w: 7, v: (f) => f.v.horaInicio, centro: true },
    { t: 'Sede', w: 13, v: (f) => f.v.sede.nombre },
    { t: 'Unidad', w: 15, v: (f) => f.v.unidadNegocio.nombre },
    { t: 'Servicio', w: 30, v: (f) => (f.v.subcategoria ? `${f.v.servicio.nombre} · ${f.v.subcategoria.nombre}` : f.v.servicio.nombre), wrap: true },
    { t: 'Estado de la cita', w: 12, v: (f) => ESTADO_CITA[f.v.estado] ?? f.v.estado },
    { t: 'Paciente', w: 30, v: (f) => `${f.v.paciente.nombres} ${f.v.paciente.apellidoPaterno} ${f.v.paciente.apellidoMaterno ?? ''}`.replace(/\s+/g, ' ').trim(), wrap: true },
    { t: 'Tipo doc.', w: 8, v: (f) => f.v.paciente.tipoDocumento, centro: true },
    { t: 'N.º documento', w: 13, v: (f) => f.v.paciente.numeroDocumento ?? '', texto: true },
    { t: 'Edad', w: 6, v: (f) => edadEn(f.v.paciente.fechaNacimiento, f.v.fecha), centro: true },
    { t: 'Teléfono', w: 13, v: (f) => f.v.paciente.telefono ?? '', texto: true },
    { t: 'Profesional de la cita', w: 24, v: (f) => persona(f.v.profesional), wrap: true },
    { t: 'Médico que atendió', w: 24, v: (f) => persona(f.v.medico) || 'Sin médico asignado', wrap: true },
    { t: 'CMP', w: 10, v: (f) => f.v.medico?.colegiatura ?? '', texto: true },
    { t: 'Registró la atención', w: 24, v: (f) => (f.compartida ? 'Ver cita principal del bloque' : persona(f.at?.profesional)), wrap: true },
    { t: 'Llegó', w: 7, v: (f) => horaLima(f.v.llegoEn), centro: true },
    { t: 'Inicio atención', w: 9, v: (f) => horaLima(f.v.enAtencionEn), centro: true },
    { t: 'Completada', w: 9, v: (f) => horaLima(f.v.completadaEn), centro: true },
    { t: 'Espera (min)', w: 8, v: (f) => minutosEntre(f.v.llegoEn, f.v.enAtencionEn), centro: true },
    { t: 'Atención (min)', w: 9, v: (f) => minutosEntre(f.v.enAtencionEn, f.v.completadaEn), centro: true },
    { t: 'Historia clínica', w: 14, v: (f) => (!f.at ? 'Sin atención' : f.compartida ? 'Bloque combinado' : f.at.estado === 'cerrada' ? 'Cerrada' : 'Abierta') },
    { t: 'Diagnósticos (CIE-10)', w: 40, v: (f) => (f.compartida || !f.at ? '' : f.at.diagnosticos.map((d) => `${d.cie10Codigo} ${d.cie10.descripcion}${d.principal ? ' (principal)' : ''}`).join('\n')), wrap: true },
    { t: 'N.º proced.', w: 8, v: (f) => (f.compartida || !f.at ? 0 : f.at.procedimientos.length), centro: true },
    { t: 'Procedimientos', w: 44, v: (f) => (f.compartida ? 'Registrados en la cita principal del bloque' : (f.at?.procedimientos ?? []).map(textoProcedimiento).join('\n')), wrap: true },
    { t: 'Recetas médicas', w: 9, v: (f) => (f.compartida || !f.at ? 0 : f.at.recetas.filter((r) => r.tipoDocumento === 'RECETA_MEDICA').length), centro: true },
    { t: 'Indicaciones', w: 9, v: (f) => (f.compartida || !f.at ? 0 : f.at.recetas.filter((r) => r.tipoDocumento !== 'RECETA_MEDICA').length), centro: true },
    {
      t: 'Medicamentos e indicaciones', w: 48, wrap: true,
      v: (f) => {
        if (f.compartida || !f.at) return '';
        return f.at.recetas.flatMap((r) => (r.tipoDocumento === 'RECETA_MEDICA' && !o.verRecetaMedica ? ['Receta médica (reservada)'] : r.items.map(textoItem))).join('\n');
      },
    },
  ];
  titulo(wa, 'Visor de Pacientes — Atenciones', filtros, colsA.length);
  tabla(wa, 4, colsA, filas, (f) => !f.compartida && (f.at?.procedimientos.length ?? 0) > 0);

  // 3) Procedimientos (una fila por procedimiento)
  const wp = wb.addWorksheet('Procedimientos', { properties: { tabColor: { argb: 'FF4338CA' } } });
  type FilaP = { f: Fila; p: Atencion['procedimientos'][number] };
  const procs: FilaP[] = propias.flatMap((f) => f.at!.procedimientos.map((p) => ({ f, p })));
  const colsP: Col<FilaP>[] = [
    { t: 'Fecha', w: 11, v: ({ f }) => ddmmyyyy(f.v.fecha), centro: true },
    { t: 'Sede', w: 13, v: ({ f }) => f.v.sede.nombre },
    { t: 'Paciente', w: 30, v: ({ f }) => `${f.v.paciente.nombres} ${f.v.paciente.apellidoPaterno} ${f.v.paciente.apellidoMaterno ?? ''}`.replace(/\s+/g, ' ').trim(), wrap: true },
    { t: 'N.º documento', w: 13, v: ({ f }) => f.v.paciente.numeroDocumento ?? '', texto: true },
    { t: 'Procedimiento', w: 28, v: ({ p }) => p.nombre, wrap: true },
    { t: 'Tipo', w: 13, v: ({ p }) => p.tipo },
    { t: 'Pie', w: 12, v: ({ p }) => (p.pie ? PIE[p.pie] ?? p.pie : '') },
    { t: 'Ubicación', w: 18, v: ({ p }) => p.ubicacion ?? '', wrap: true },
    { t: 'Médico de la cita', w: 24, v: ({ f }) => persona(f.v.medico) || 'Sin médico asignado', wrap: true },
    { t: 'Servicio', w: 28, v: ({ f }) => f.v.servicio.nombre, wrap: true },
  ];
  titulo(wp, 'Visor de Pacientes — Procedimientos', filtros, colsP.length);
  tabla(wp, 4, colsP, procs);

  return { wb, visitas: filas.length, procedimientos: procs.length };
}
