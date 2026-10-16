import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { prisma } from '../db';
import { requireAuth, requirePermiso } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// TODAS las exportaciones exigen `exportar.usar` (antes solo requireAuth → cualquier usuario
// logueado exportaba datos por API). Contact center NO lo tiene → no puede exportar.
router.use(requireAuth, requirePermiso('exportar.usar'));

// Teléfono → formato internacional. Si tiene 9 dígitos (caso típico Perú) se le
// antepone +51. Si ya trae código de país (+1, +51, cualquier +) se respeta tal cual.
// Otros formatos se dejan intactos.
function formatearNumero(tel: string | null | undefined): string {
  const t = (tel ?? '').trim();
  if (!t) return '';
  if (t.startsWith('+')) return t.replace(/\s+/g, ''); // respeta cualquier código de país
  const digitos = t.replace(/\D/g, '');
  if (digitos.length === 9) return `+51${digitos}`;
  return t; // respeta el valor original (ya tiene código de país u otro formato)
}

// Delimitador: punto y coma (Excel en español/es-PE usa ";" como separador de
// listas; con coma lo metía todo en una sola columna).
const SEP = ';';

// Escapa un campo CSV (comillas si tiene el separador, comilla o salto de línea).
function csvCampo(v: string): string {
  const s = v ?? '';
  return new RegExp(`["${SEP}\\n\\r]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ─── GET /exportar/citas?fecha=YYYY-MM-DD[&sedeId=xxx] ───── (CSV, solo texto) ─
router.get('/citas', requireAuth, async (req, res) => {
  const { fecha, sedeId } = req.query as { fecha?: string; sedeId?: string };
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new AppError('Parámetro fecha requerido (YYYY-MM-DD)', 400, 'FECHA_REQUERIDA');
  }

  const fechaDate = new Date(fecha + 'T12:00:00');

  const citas = await prisma.cita.findMany({
    where: {
      fecha: fechaDate,
      deletedAt: null,
      estado: { notIn: ['cancelada', 'no_show'] },
      ...(sedeId ? { sedeId } : {}),
    },
    include: {
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true } },
      sede: { select: { nombre: true, direccion: true } },
    },
    orderBy: [{ sede: { nombre: 'asc' } }, { horaInicio: 'asc' }],
  });

  // DIA en formato DD/MM/YYYY (fecha es @db.Date → getters UTC para no desfasar).
  const dd = String(fechaDate.getUTCDate()).padStart(2, '0');
  const mm = String(fechaDate.getUTCMonth() + 1).padStart(2, '0');
  const diaStr = `${dd}/${mm}/${fechaDate.getUTCFullYear()}`;

  // Fuerza que Excel muestre el valor como TEXTO literal al abrir el CSV directo
  // (sin importar). Usa el marcador ="…" que Excel respeta; así el +51 / +1 no se
  // convierte a número ni a notación científica.
  const textoExcel = (v: string) => (v ? `="${v.replace(/"/g, '""')}"` : '');

  // Columnas: Numero, NOMBRE, DIA, HORA, SEDE, DIRECCION
  const lineas = [['Numero', 'NOMBRE', 'DIA', 'HORA', 'SEDE', 'DIRECCION'].join(SEP)];
  for (const c of citas) {
    const nombre = `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim();
    lineas.push([
      textoExcel(formatearNumero(c.paciente.telefono)),
      nombre,
      diaStr,
      c.horaInicio,
      c.sede.nombre,
      c.sede.direccion,
    ].map(csvCampo).join(SEP));
  }

  // 1ª línea "sep=;" → indica a Excel el separador (robusto en cualquier equipo).
  // BOM UTF-8 para las tildes. CRLF como fin de línea.
  const csv = '﻿' + `sep=${SEP}\r\n` + lineas.join('\r\n') + '\r\n';
  const nombreArchivo = `citas-limablue-${fecha}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(csv);
});

// ─── GET /exportar/citas-excel?fecha=YYYY-MM-DD[&sedeId=xxx] ───── (Excel) ──
// Lista de citas del día para control de recepción (29-sep-2026): DNI, nombre, sede, servicio, hora, teléfono, estado
// de la cita y estado de pago. TODAS las citas del día (también canceladas / no vino: la columna Estado lo dice y
// el encabezado trae filtros de Excel). El CSV de arriba (WhatsApp) no cambia.
const ESTADO_CITA_LABEL: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó', en_atencion: 'En atención', completada: 'Completada',
  no_show: 'No vino', cancelada: 'Cancelada', reprogramada: 'Reprogramada',
};
const ESTADO_PAGO_LABEL: Record<string, string> = { completo: 'Pago completo', incompleto: 'Pago incompleto', pendiente: 'Pendiente de pago' };

// 06-oct-2026: también por RANGO (?desde=YYYY-MM-DD&hasta=YYYY-MM-DD, máx. 92 días); en rango se agrega la columna «Fecha».
const MAX_DIAS_RANGO_EXCEL = 92;
// 08-oct-2026: filtro de ASISTENCIA (?asistencia=llegaron|no_llegaron; sin el parámetro = todas).
//  · llegaron    = Llegó, En atención y Completada (el paciente vino).
//  · no_llegaron = todo lo demás: No vino, Cancelada, Reprogramada y las que quedaron Agendada/Confirmada sin marcar.
const ESTADOS_LLEGARON = ['llego', 'en_atencion', 'completada'] as const;
const ASISTENCIA_LABEL: Record<string, string> = { llegaron: 'Llegaron', no_llegaron: 'No llegaron' };
// 08-oct-2026: filtro por QUIÉN AGENDÓ (rol del usuario que creó la cita). Sin el parámetro = todas (incluye las de
// administración, que a veces son pruebas, y las automáticas: reserva web / importadas).
const ROLES_AGENDADO_POR: Record<string, { roles: string[]; label: string }> = {
  equipo: { roles: ['contact_center', 'especial_contact', 'recepcionista', 'coordinadora_sedes'], label: 'Agendó: contact center y recepción' },
  contact: { roles: ['contact_center', 'especial_contact'], label: 'Agendó: contact center' },
  recepcion: { roles: ['recepcionista', 'coordinadora_sedes'], label: 'Agendó: recepción y coordinación' },
};
router.get('/citas-excel', requireAuth, async (req, res) => {
  const { fecha, desde, hasta, sedeId, asistencia: asistenciaRaw, agendadoPor: agendadoPorRaw } = req.query as {
    fecha?: string; desde?: string; hasta?: string; sedeId?: string; asistencia?: string; agendadoPor?: string;
  };
  const asistencia = asistenciaRaw === 'llegaron' || asistenciaRaw === 'no_llegaron' ? asistenciaRaw : null;
  const grupoAgendo = agendadoPorRaw ? ROLES_AGENDADO_POR[agendadoPorRaw] ?? null : null;
  const esFecha = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const esRango = esFecha(desde) && esFecha(hasta);
  if (!esRango && !esFecha(fecha)) {
    throw new AppError('Indica una fecha (YYYY-MM-DD) o un rango desde/hasta', 400, 'FECHA_REQUERIDA');
  }
  const ini = esRango ? desde : fecha!;
  const fin = esRango ? hasta : fecha!;
  if (fin < ini) throw new AppError('La fecha «hasta» no puede ser anterior a «desde»', 400, 'RANGO_INVALIDO');
  const dias = Math.round((Date.parse(fin + 'T00:00:00Z') - Date.parse(ini + 'T00:00:00Z')) / 86_400_000) + 1;
  if (dias > MAX_DIAS_RANGO_EXCEL) {
    throw new AppError(`El rango puede ser de hasta ${MAX_DIAS_RANGO_EXCEL} días (elegiste ${dias}). Divídelo en partes.`, 400, 'RANGO_MUY_LARGO');
  }
  const fechaDate = new Date(ini + 'T12:00:00');
  const finDate = new Date(fin + 'T12:00:00');
  const sede = sedeId ? await prisma.sede.findUnique({ where: { id: sedeId }, select: { nombre: true } }) : null;

  const citas = await prisma.cita.findMany({
    where: {
      fecha: esRango ? { gte: fechaDate, lte: finDate } : fechaDate, deletedAt: null, ...(sedeId ? { sedeId } : {}),
      ...(asistencia === 'llegaron' ? { estado: { in: [...ESTADOS_LLEGARON] } } : asistencia === 'no_llegaron' ? { estado: { notIn: [...ESTADOS_LLEGARON] } } : {}),
      ...(grupoAgendo ? { creadoPorUsuario: { rol: { in: grupoAgendo.roles } } } : {}),
    },
    include: {
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true, tipoDocumento: true, numeroDocumento: true } },
      sede: { select: { nombre: true } },
      servicio: { select: { nombre: true } },
      subcategoria: { select: { nombre: true } },
      creadoPorUsuario: { select: { nombre: true } },
    },
    orderBy: [...(esRango ? [{ fecha: 'asc' as const }] : []), { sede: { nombre: 'asc' } }, { horaInicio: 'asc' }],
  });
  type FilaCita = (typeof citas)[number];
  // Canal (14-oct-2026): la cita guarda el valor ("whatsapp"); el nombre visible sale del catálogo de canales.
  const etiquetaCanal = new Map((await prisma.canal.findMany({ select: { valor: true, etiqueta: true } })).map((k) => [k.valor, k.etiqueta]));
  const canalDe = (c: FilaCita) => etiquetaCanal.get(c.canal) ?? (c.canal === 'web' ? 'Reserva web' : c.canal.replace(/_/g, ' ').replace(/^./, (l) => l.toUpperCase()));
  // Quién la agendó (06-oct-2026). Sin usuario = la creó una integración (reserva web, agente) o vino del sistema anterior.
  const agendadoPor = (c: FilaCita) =>
    c.creadoPorUsuario?.nombre.trim() || (c.canal === 'web' ? 'Reserva web (internet)' : 'Sin usuario (automática o importada)');
  const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');
  const conDia = (iso: string) => {
    const d = new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
    return `${d.charAt(0).toUpperCase()}${d.slice(1)} ${ddmmyyyy(iso)}`;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Citas');
  // Columnas (en rango se agrega «Fecha» antes de la hora)
  const columnas: { titulo: string; ancho: number; valor: (c: FilaCita) => string; texto?: boolean; pago?: boolean }[] = [
    { titulo: 'DNI', ancho: 14, valor: (c) => c.paciente.numeroDocumento ?? '', texto: true },
    { titulo: 'Nombre completo', ancho: 38, valor: (c) => `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim() },
    { titulo: 'Sede', ancho: 14, valor: (c) => c.sede.nombre },
    { titulo: 'Servicio', ancho: 42, valor: (c) => (c.subcategoria ? `${c.servicio.nombre} · ${c.subcategoria.nombre}` : c.servicio.nombre) },
    ...(esRango ? [{ titulo: 'Fecha', ancho: 12, valor: (c: FilaCita) => ddmmyyyy(c.fecha.toISOString().slice(0, 10)) }] : []),
    { titulo: 'Hora cita', ancho: 11, valor: (c) => c.horaInicio },
    { titulo: 'Teléfono', ancho: 16, valor: (c) => formatearNumero(c.paciente.telefono), texto: true },
    { titulo: 'Estado', ancho: 14, valor: (c) => ESTADO_CITA_LABEL[c.estado] ?? c.estado },
    { titulo: '¿Pagado?', ancho: 19, valor: (c) => ESTADO_PAGO_LABEL[c.estadoPago] ?? c.estadoPago, pago: true },
    { titulo: 'Agendado por', ancho: 32, valor: agendadoPor },
    { titulo: 'Canal', ancho: 20, valor: canalDe },
  ];
  const COLS = columnas.map((x) => x.titulo);
  ws.columns = columnas.map((x) => ({ width: x.ancho }));

  // Filtros aplicados (arriba del listado)
  ws.mergeCells(1, 1, 1, COLS.length);
  const periodo = esRango ? `Del ${conDia(ini)} al ${conDia(fin)}` : conDia(ini);
  ws.getCell(1, 1).value = `Lista de citas · ${periodo} · Sede: ${sede?.nombre ?? 'Todas las sedes'} · ${asistencia ? ASISTENCIA_LABEL[asistencia] : 'Todas'}${grupoAgendo ? ` · ${grupoAgendo.label}` : ''} · ${citas.length} citas`;
  ws.getCell(1, 1).font = { name: 'Arial', bold: true, size: 13 };

  const FILA_CAB = 3; // título, una fila en blanco y el encabezado
  const cab = ws.getRow(FILA_CAB);
  cab.values = COLS;
  cab.eachCell((c) => {
    c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B7A5C' } };
    c.alignment = { vertical: 'middle' };
  });
  ws.autoFilter = { from: { row: FILA_CAB, column: 1 }, to: { row: FILA_CAB, column: COLS.length } };
  ws.views = [{ state: 'frozen', ySplit: FILA_CAB }];

  const COLOR_PAGO: Record<string, string> = { completo: 'FFD1FAE5', incompleto: 'FFFEF3C7', pendiente: 'FFFFE4E6' };
  citas.forEach((c, i) => {
    const fila = ws.getRow(FILA_CAB + 1 + i);
    fila.values = columnas.map((x) => x.valor(c));
    fila.font = { name: 'Arial', size: 10 };
    columnas.forEach((x, k) => {
      if (x.texto) fila.getCell(k + 1).numFmt = '@'; // DNI y teléfono como TEXTO (sin notación científica ni ceros perdidos)
      if (x.pago) fila.getCell(k + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PAGO[c.estadoPago] ?? 'FFFFFFFF' } };
    });
  });

  const nombreArchivo = `citas-limablue-${esRango ? `${ini}_a_${fin}` : ini}${sede ? `-${sede.nombre.replace(/\s+/g, '-').toLowerCase()}` : ''}${asistencia ? `-${asistencia.replace('_', '-')}` : ''}${grupoAgendo && agendadoPorRaw !== 'equipo' ? `-${agendadoPorRaw}` : ''}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreArchivo)}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── GET /exportar/tiempos-atencion?fecha= | desde=&hasta= [&sedeId=] ───── (Excel) ──
// 10-oct-2026: por cada cita que llegó, QUIÉN marcó «Llegó», «En atención» y «Completada» (o si lo hizo el sistema:
// completado automático o el aparato del consultorio), la espera, la atención y el total reales contra el tiempo
// TEÓRICO de la cita (los 30 / 60 min con que se agenda). Un día o un rango (máx. 92 días), una sede o todas.
// Hojas: «Citas» (detalle) y «Resumen» (por sede y por quién marcó «Llegó») para comparar.
type MarcaEstado = { quien: string; rol: string; automatico: boolean };
const ESTADOS_MARCADOS = ['llego', 'en_atencion', 'completada'] as const;
type EstadoMarcado = (typeof ESTADOS_MARCADOS)[number];
const horaLima = (d: Date | null) => (d ? d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const minutosEntre = (a: Date | null, b: Date | null) => {
  if (!a || !b) return null;
  const m = Math.round((b.getTime() - a.getTime()) / 60_000);
  return m >= 0 ? m : null;
};
const promedio = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null;
};

router.get('/tiempos-atencion', async (req, res) => {
  const { fecha, desde, hasta, sedeId } = req.query as { fecha?: string; desde?: string; hasta?: string; sedeId?: string };
  const esFecha = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const esRango = esFecha(desde) && esFecha(hasta);
  if (!esRango && !esFecha(fecha)) throw new AppError('Indica una fecha (YYYY-MM-DD) o un rango desde/hasta', 400, 'FECHA_REQUERIDA');
  const ini = esRango ? desde : fecha!;
  const fin = esRango ? hasta : fecha!;
  if (fin < ini) throw new AppError('La fecha «hasta» no puede ser anterior a «desde»', 400, 'RANGO_INVALIDO');
  const dias = Math.round((Date.parse(fin + 'T00:00:00Z') - Date.parse(ini + 'T00:00:00Z')) / 86_400_000) + 1;
  if (dias > MAX_DIAS_RANGO_EXCEL) {
    throw new AppError(`El rango puede ser de hasta ${MAX_DIAS_RANGO_EXCEL} días (elegiste ${dias}). Divídelo en partes.`, 400, 'RANGO_MUY_LARGO');
  }
  const sede = sedeId ? await prisma.sede.findUnique({ where: { id: sedeId }, select: { nombre: true } }) : null;

  const citas = await prisma.cita.findMany({
    where: {
      fecha: esRango ? { gte: new Date(ini + 'T12:00:00'), lte: new Date(fin + 'T12:00:00') } : new Date(ini + 'T12:00:00'),
      deletedAt: null, estado: { in: [...ESTADOS_LLEGARON] }, ...(sedeId ? { sedeId } : {}),
    },
    select: {
      id: true, fecha: true, horaInicio: true, estado: true, duracionMinutos: true, slotRol: true,
      llegoEn: true, enAtencionEn: true, completadaEn: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, numeroDocumento: true } },
      sede: { select: { nombre: true } },
      unidadNegocio: { select: { nombre: true } },
      servicio: { select: { nombre: true } },
      subcategoria: { select: { nombre: true } },
      profesional: { select: { nombres: true, apellidos: true } },
    },
    orderBy: [{ fecha: 'asc' }, { sede: { nombre: 'asc' } }, { horaInicio: 'asc' }],
  });

  // Quién hizo cada paso: el ÚLTIMO cambio a ese estado en la auditoría (si se revirtió y se volvió a marcar, vale el último).
  const roles = Object.fromEntries((await prisma.rol.findMany({ select: { nombre: true, label: true } })).map((r) => [r.nombre, r.label]));
  const marcas = new Map<string, Partial<Record<EstadoMarcado, MarcaEstado>>>();
  const ids = citas.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 2000) {
    const logs = await prisma.auditLog.findMany({
      where: { citaId: { in: ids.slice(i, i + 2000) }, accion: { in: ['cambiar_estado', 'auto_completar'] } },
      select: { citaId: true, accion: true, despues: true, usuario: { select: { nombre: true, rol: true } } },
      orderBy: { creadoEn: 'asc' },
    });
    for (const l of logs) {
      const d = (l.despues ?? {}) as { estado?: string; origen?: string; dispositivo?: string };
      const estado = (l.accion === 'auto_completar' ? 'completada' : d.estado) as EstadoMarcado | undefined;
      if (!l.citaId || !estado || !ESTADOS_MARCADOS.includes(estado)) continue;
      const m: MarcaEstado = l.accion === 'auto_completar'
        ? { quien: 'Sistema (completado automático)', rol: 'Sistema', automatico: true }
        : !l.usuario
          ? { quien: d.origen === 'dispositivo' ? `Aparato del consultorio${d.dispositivo ? ` (${d.dispositivo})` : ''}` : 'Sistema (automático)', rol: 'Sistema', automatico: true }
          : { quien: l.usuario.nombre.trim(), rol: roles[l.usuario.rol] ?? l.usuario.rol, automatico: false };
      marcas.set(l.citaId, { ...(marcas.get(l.citaId) ?? {}), [estado]: m });
    }
  }
  const sinRegistro: MarcaEstado = { quien: 'Sin registro', rol: '', automatico: false };
  const marca = (id: string, e: EstadoMarcado, hora: Date | null) => marcas.get(id)?.[e] ?? (hora ? sinRegistro : null);

  const filas = citas.map((c) => {
    const llego = marca(c.id, 'llego', c.llegoEn);
    const atencion = marca(c.id, 'en_atencion', c.enAtencionEn);
    const completada = marca(c.id, 'completada', c.completadaEn);
    const espera = minutosEntre(c.llegoEn, c.enAtencionEn);
    const minAtencion = minutosEntre(c.enAtencionEn, c.completadaEn);
    const automaticos = [llego?.automatico && 'Llegó', atencion?.automatico && 'En atención', completada?.automatico && 'Completada'].filter(Boolean) as string[];
    return {
      c, llego, atencion, completada, espera, minAtencion, total: minutosEntre(c.llegoEn, c.completadaEn),
      teorico: c.duracionMinutos,
      automatico: automaticos.length ? automaticos.join(', ') : 'No',
      // En una cita doble los tiempos son los mismos para las dos: el resumen cuenta solo el 1º tratamiento.
      cuentaEnResumen: c.slotRol !== 'SECUNDARIO',
    };
  });
  type Fila = (typeof filas)[number];

  const wb = new ExcelJS.Workbook();
  const ddmmyyyy = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('/');
  const periodo = esRango ? `Del ${ini.split('-').reverse().join('/')} al ${fin.split('-').reverse().join('/')}` : ini.split('-').reverse().join('/');
  const titulo = `Tiempos de atención · ${periodo} · Sede: ${sede?.nombre ?? 'Todas las sedes'} · ${citas.length} citas que llegaron`;
  // Azul Limablue (el `primary` de la Agenda).
  const cabecera = (ws: ExcelJS.Worksheet, fila: number, titulos: string[], color = 'FF0044AB') => {
    const r = ws.getRow(fila);
    r.values = titulos;
    r.eachCell((cell) => {
      cell.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    r.height = 30;
  };

  // ── Hoja 1: detalle por cita ──
  const ws = wb.addWorksheet('Citas');
  const columnas: { titulo: string; ancho: number; valor: (f: Fila) => string | number | null; texto?: boolean; num?: boolean; marca?: EstadoMarcado }[] = [
    { titulo: 'Fecha', ancho: 11, valor: (f) => ddmmyyyy(f.c.fecha) },
    { titulo: 'Sede', ancho: 13, valor: (f) => f.c.sede.nombre },
    { titulo: 'Unidad', ancho: 14, valor: (f) => f.c.unidadNegocio.nombre },
    { titulo: 'Hora cita', ancho: 9, valor: (f) => f.c.horaInicio },
    { titulo: 'DNI', ancho: 12, valor: (f) => f.c.paciente.numeroDocumento ?? '', texto: true },
    { titulo: 'Paciente', ancho: 32, valor: (f) => `${f.c.paciente.nombres} ${f.c.paciente.apellidoPaterno} ${f.c.paciente.apellidoMaterno ?? ''}`.replace(/\s+/g, ' ').trim() },
    { titulo: 'Servicio', ancho: 34, valor: (f) => (f.c.subcategoria ? `${f.c.servicio.nombre} · ${f.c.subcategoria.nombre}` : f.c.servicio.nombre) },
    { titulo: 'Profesional', ancho: 26, valor: (f) => (f.c.profesional ? `${f.c.profesional.nombres} ${f.c.profesional.apellidos}`.trim() : '') },
    { titulo: 'Estado', ancho: 12, valor: (f) => ESTADO_CITA_LABEL[f.c.estado] ?? f.c.estado },
    { titulo: 'Cita doble', ancho: 10, valor: (f) => (f.c.slotRol === 'PRINCIPAL' ? '1º trat.' : f.c.slotRol === 'SECUNDARIO' ? '2º trat.' : '') },
    { titulo: 'Llegó (hora)', ancho: 10, valor: (f) => horaLima(f.c.llegoEn) },
    { titulo: 'Marcó «Llegó»', ancho: 26, valor: (f) => f.llego?.quien ?? '', marca: 'llego' },
    { titulo: 'Rol (Llegó)', ancho: 18, valor: (f) => f.llego?.rol ?? '' },
    { titulo: 'En atención (hora)', ancho: 11, valor: (f) => horaLima(f.c.enAtencionEn) },
    { titulo: 'Marcó «En atención»', ancho: 26, valor: (f) => f.atencion?.quien ?? '', marca: 'en_atencion' },
    { titulo: 'Completada (hora)', ancho: 11, valor: (f) => horaLima(f.c.completadaEn) },
    { titulo: 'Marcó «Completada»', ancho: 28, valor: (f) => f.completada?.quien ?? '', marca: 'completada' },
    { titulo: 'Hecho por el sistema', ancho: 18, valor: (f) => f.automatico },
    { titulo: 'Espera (min)', ancho: 9, valor: (f) => f.espera, num: true },
    { titulo: 'Atención (min)', ancho: 10, valor: (f) => f.minAtencion, num: true },
    { titulo: 'Total (min)', ancho: 9, valor: (f) => f.total, num: true },
    { titulo: 'Tiempo teórico (min)', ancho: 10, valor: (f) => f.teorico, num: true },
  ];
  ws.columns = columnas.map((x) => ({ width: x.ancho }));
  ws.mergeCells(1, 1, 1, columnas.length);
  ws.getCell(1, 1).value = titulo;
  ws.getCell(1, 1).font = { name: 'Arial', bold: true, size: 13 };
  const FILA_CAB = 3;
  cabecera(ws, FILA_CAB, columnas.map((x) => x.titulo));
  ws.autoFilter = { from: { row: FILA_CAB, column: 1 }, to: { row: FILA_CAB, column: columnas.length } };
  ws.views = [{ state: 'frozen', ySplit: FILA_CAB }];
  filas.forEach((f, i) => {
    const r = ws.getRow(FILA_CAB + 1 + i);
    r.values = columnas.map((x) => x.valor(f));
    r.font = { name: 'Arial', size: 10 };
    columnas.forEach((x, k) => {
      const cell = r.getCell(k + 1);
      if (x.texto) cell.numFmt = '@';
      if (x.marca) {
        const m = x.marca === 'llego' ? f.llego : x.marca === 'en_atencion' ? f.atencion : f.completada;
        if (m?.automatico) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      }
    });
  });

  // ── Hoja 2: resumen para comparar ──
  const rs = wb.addWorksheet('Resumen');
  rs.columns = [{ width: 30 }, { width: 20 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }];
  rs.mergeCells(1, 1, 1, 8);
  rs.getCell(1, 1).value = titulo;
  rs.getCell(1, 1).font = { name: 'Arial', bold: true, size: 13 };

  const enResumen = filas.filter((f) => f.cuentaEnResumen);
  let fila = 3;
  rs.getCell(fila, 1).value = 'Por sede';
  rs.getCell(fila, 1).font = { name: 'Arial', bold: true, size: 11 };
  fila++;
  cabecera(rs, fila, ['Sede', 'Citas que llegaron', 'Espera prom. (min)', 'Atención prom. (min)', 'Total prom. (min)', 'Teórico prom. (min)', 'Completadas por el sistema', '% completadas por el sistema']);
  const porSede = new Map<string, Fila[]>();
  for (const f of enResumen) porSede.set(f.c.sede.nombre, [...(porSede.get(f.c.sede.nombre) ?? []), f]);
  const lineaResumen = (nombre: string, fs: Fila[]) => {
    const auto = fs.filter((f) => f.completada?.automatico).length;
    const completadas = fs.filter((f) => f.c.estado === 'completada').length;
    return [
      nombre, fs.length, promedio(fs.map((f) => f.espera)), promedio(fs.map((f) => f.minAtencion)), promedio(fs.map((f) => f.total)),
      promedio(fs.map((f) => f.teorico)), auto, completadas ? Math.round((auto / completadas) * 1000) / 10 : null,
    ];
  };
  for (const [nombre, fs] of [...porSede.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    fila++;
    rs.getRow(fila).values = lineaResumen(nombre, fs);
    rs.getRow(fila).font = { name: 'Arial', size: 10 };
  }
  fila++;
  rs.getRow(fila).values = lineaResumen('Todas las sedes', enResumen);
  rs.getRow(fila).font = { name: 'Arial', size: 10, bold: true };

  fila += 3;
  rs.getCell(fila, 1).value = 'Quién marcó «Llegó»';
  rs.getCell(fila, 1).font = { name: 'Arial', bold: true, size: 11 };
  fila++;
  cabecera(rs, fila, ['Usuario', 'Rol', 'Sede(s)', 'Citas marcadas', 'Espera prom. (min)']);
  const porUsuario = new Map<string, { rol: string; sedes: Set<string>; fs: Fila[] }>();
  for (const f of enResumen) {
    if (!f.llego) continue;
    const u = porUsuario.get(f.llego.quien) ?? { rol: f.llego.rol, sedes: new Set<string>(), fs: [] };
    u.sedes.add(f.c.sede.nombre);
    u.fs.push(f);
    porUsuario.set(f.llego.quien, u);
  }
  for (const [nombre, u] of [...porUsuario.entries()].sort((a, b) => b[1].fs.length - a[1].fs.length)) {
    fila++;
    rs.getRow(fila).values = [nombre, u.rol, [...u.sedes].sort().join(', '), u.fs.length, promedio(u.fs.map((f) => f.espera))];
    rs.getRow(fila).font = { name: 'Arial', size: 10 };
  }

  const nombreArchivo = `tiempos-atencion-${esRango ? `${ini}_a_${fin}` : ini}${sede ? `-${sede.nombre.replace(/\s+/g, '-').toLowerCase()}` : ''}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(nombreArchivo)}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── GET /exportar/reactivacion ──────────────────────────────────────────────
// Filtro por período de última visita (3 modos, prioridad de arriba hacia abajo):
//   1) fechaDesde + fechaHasta (YYYY-MM-DD) → última visita DENTRO del rango
//   2) fechaCorte (YYYY-MM-DD)              → última visita ANTES del corte
//   3) diasSinVisitar (default 90)          → última visita hace más de N días
// Otros params: sedeId?, servicioId?, minVisitas (default 1)
router.get('/reactivacion', requireAuth, async (req, res) => {
  const {
    diasSinVisitar = '90',
    fechaCorte,
    fechaDesde,
    fechaHasta,
    sedeId,
    servicioId,
    minVisitas = '1',
  } = req.query as {
    diasSinVisitar?: string; fechaCorte?: string; fechaDesde?: string; fechaHasta?: string;
    sedeId?: string; servicioId?: string; minVisitas?: string;
  };

  const minV = Math.max(1, parseInt(minVisitas, 10) || 1);
  const esFecha = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const ddmmaaaa = (v: string) => v.split('-').reverse().join('/');

  // Predicado de período sobre la fecha de la última visita del paciente.
  let pasaPeriodo: (fechaUltima: Date) => boolean;
  let etiquetaPeriodo: string;

  if (esFecha(fechaDesde) && esFecha(fechaHasta)) {
    const desde = new Date(fechaDesde + 'T00:00:00');
    const hasta = new Date(fechaHasta + 'T23:59:59');
    pasaPeriodo = (f) => f >= desde && f <= hasta;
    etiquetaPeriodo = `última visita entre ${ddmmaaaa(fechaDesde!)} y ${ddmmaaaa(fechaHasta!)}`;
  } else if (esFecha(fechaCorte)) {
    const corte = new Date(fechaCorte + 'T23:59:59');
    pasaPeriodo = (f) => f <= corte;
    etiquetaPeriodo = `última visita antes del ${ddmmaaaa(fechaCorte!)}`;
  } else {
    const dias = Math.max(1, parseInt(diasSinVisitar, 10) || 90);
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    corte.setHours(23, 59, 59, 999);
    pasaPeriodo = (f) => f <= corte;
    etiquetaPeriodo = `sin visitar en +${dias} días`;
  }

  const citaWhere = {
    deletedAt: null as null,
    estado: 'completada' as const,
    ...(sedeId ? { sedeId } : {}),
    ...(servicioId ? { servicioId } : {}),
  };

  const rawPacientes = await prisma.paciente.findMany({
    where: {
      deletedAt: null,
      citas: { some: citaWhere },
    },
    include: {
      citas: {
        where: citaWhere,
        include: {
          servicio: { select: { nombre: true } },
          sede: { select: { nombre: true } },
        },
        orderBy: { fecha: 'desc' },
      },
    },
  });

  // Total de visitas completadas por paciente (sin filtro de sede/servicio)
  const totalMap = await prisma.cita.groupBy({
    by: ['pacienteId'],
    where: { deletedAt: null, estado: 'completada', pacienteId: { in: rawPacientes.map(p => p.id) } },
    _count: { id: true },
  });
  const totalPorPaciente = new Map(totalMap.map(r => [r.pacienteId, r._count.id]));

  const hoy = new Date();
  const ahora = hoy.getTime();

  const conUltima = rawPacientes
    .filter(p => p.citas.length >= minV)
    .map(p => {
      const ultima = p.citas[0]!;
      const fechaUltima = new Date(ultima.fecha);
      const diasSinVenir = Math.floor((ahora - fechaUltima.getTime()) / (1000 * 60 * 60 * 24));
      return { paciente: p, ultima, fechaUltima, diasSinVenir, totalVisitas: totalPorPaciente.get(p.id) ?? p.citas.length };
    })
    .filter(r => pasaPeriodo(r.fechaUltima))
    .sort((a, b) => b.diasSinVenir - a.diasSinVenir);

  // ── Excel ─────────────────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Limablue Agenda';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Reactivación', {
    pageSetup: { paperSize: 9, orientation: 'landscape' },
  });

  const hoyStr = hoy.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });

  sheet.mergeCells('A1:I1');
  const t = sheet.getCell('A1');
  t.value = `Pacientes para Reactivación — Generado ${hoyStr} · ${etiquetaPeriodo}`;
  t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 26;

  sheet.mergeCells('A2:I2');
  const sub = sheet.getCell('A2');
  sub.value = `Limablue Corp. — Total: ${conUltima.length} pacientes`;
  sub.font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sub.alignment = { horizontal: 'center' };
  sheet.getRow(2).height = 16;

  const headers = [
    { label: 'Nombres',             key: 'nombres',        width: 20 },
    { label: 'Apellidos',           key: 'apellidos',      width: 24 },
    { label: 'Teléfono',            key: 'telefono',       width: 14 },
    { label: 'Email',               key: 'email',          width: 28 },
    { label: 'Último servicio',     key: 'servicio',       width: 28 },
    { label: 'Última visita',       key: 'ultimaVisita',   width: 14 },
    { label: 'Días sin visitar',    key: 'dias',           width: 14 },
    { label: 'Sede última visita',  key: 'sede',           width: 16 },
    { label: 'Total visitas',       key: 'totalVisitas',   width: 12 },
  ];

  sheet.columns = headers.map(h => ({ key: h.key, width: h.width }));

  const hr = sheet.getRow(3);
  headers.forEach((h, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = h.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCAADFA' } },
      right: { style: 'hair', color: { argb: 'FFCAADFA' } },
    };
  });
  hr.height = 20;

  conUltima.forEach(({ paciente: p, ultima, fechaUltima, diasSinVenir, totalVisitas }, idx) => {
    const row = sheet.addRow({
      nombres: p.nombres,
      apellidos: `${p.apellidoPaterno} ${p.apellidoMaterno}`,
      telefono: p.telefono,
      email: p.email ?? '',
      servicio: ultima.servicio.nombre,
      ultimaVisita: fechaUltima.toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }),
      dias: diasSinVenir,
      sede: ultima.sede.nombre,
      totalVisitas,
    });

    const bg = idx % 2 === 0 ? 'FFF5F3FF' : 'FFFFFFFF';
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2D9F8' } }, right: { style: 'hair', color: { argb: 'FFE2D9F8' } } };
    });

    // Colorear "Días sin visitar" según urgencia
    const diasCell = row.getCell('dias');
    if (diasSinVenir >= 365) {
      diasCell.font = { bold: true, color: { argb: 'FFDC2626' } };
    } else if (diasSinVenir >= 180) {
      diasCell.font = { bold: true, color: { argb: 'FFD97706' } };
    } else {
      diasCell.font = { color: { argb: 'FF059669' } };
    }
    diasCell.alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = 18;
  });

  sheet.autoFilter = { from: 'A3', to: 'I3' };
  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const sufijArchivo = fechaCorte ? `hasta-${fechaCorte}` : `${diasSinVisitar}dias`;
  res.setHeader('Content-Disposition', `attachment; filename="reactivacion-limablue-${sufijArchivo}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
});

// ─── GET /exportar/historial/:pacienteId ─────────────────────────────────────
router.get('/historial/:pacienteId', requireAuth, async (req, res) => {
  const paciente = await prisma.paciente.findUnique({
    where: { id: req.params.pacienteId, deletedAt: null },
    include: {
      paquetes: {
        where: { deletedAt: null, activo: true },
        include: { paquete: { select: { nombre: true } } },
      },
    },
  });
  if (!paciente) throw new AppError('Paciente no encontrado', 404);

  const citas = await prisma.cita.findMany({
    where: { pacienteId: req.params.pacienteId, deletedAt: null },
    include: {
      profesional: { select: { nombres: true, apellidos: true } },
      servicio: { select: { nombre: true } },
      sede: { select: { nombre: true } },
      unidadNegocio: { select: { nombre: true } },
    },
    orderBy: [{ fecha: 'desc' }, { horaInicio: 'asc' }],
  });

  // ── Métricas ──────────────────────────────────────────────────────────────
  const total = citas.length;
  const completadas = citas.filter(c => c.estado === 'completada').length;
  const noShows = citas.filter(c => c.estado === 'no_show').length;
  const canceladas = citas.filter(c => c.estado === 'cancelada').length;
  const pendientes = citas.filter(c => ['agendada', 'confirmada', 'llego', 'en_atencion'].includes(c.estado)).length;
  const asistencia = total > 0 ? Math.round((completadas / (completadas + noShows || 1)) * 100) : 0;

  // ── PDF con pdfkit ────────────────────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="historial-${paciente.apellidoPaterno}-${paciente.nombres}.pdf"`);
  doc.pipe(res);

  const W = 595.28;  // A4 width in points
  const AZUL = '#003366';
  const AZUL_CLARO = '#0A4B8C';
  const VERDE = '#059669';
  const ROJO = '#DC2626';
  const GRIS = '#6B7280';
  const NARANJA = '#D97706';
  const AZUL_MED = '#2563EB';
  const BG_GRIS = '#F8FAFC';
  const BORDE = '#E2E8F0';

  // ── BANDA SUPERIOR ────────────────────────────────────────────────────────
  doc.rect(0, 0, W, 90).fill(AZUL);

  // Logo área
  doc.roundedRect(28, 14, 52, 52, 8).fill('#FFFFFF').fillOpacity(1);
  doc.fontSize(9).fillColor(AZUL).font('Helvetica-Bold')
    .text('LIMA', 30, 30).text('BLUE', 30, 42);

  // Título en la banda
  doc.fontSize(22).fillColor('#FFFFFF').font('Helvetica-Bold')
    .text('Historia de Atenciones', 95, 18, { width: 380 });
  doc.fontSize(10).fillColor('#93C5FD').font('Helvetica')
    .text('Limablue Corp. — Sistema de Gestión de Citas', 95, 46);

  // Fecha de generación
  const ahora = new Date();
  const fechaGen = ahora.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'long', year: 'numeric' });
  doc.fontSize(8).fillColor('#93C5FD').font('Helvetica')
    .text(`Generado: ${fechaGen}`, W - 160, 68, { width: 135, align: 'right' });

  // ── DATOS DEL PACIENTE ─────────────────────────────────────────────────────
  const nombreCompleto = `${paciente.nombres} ${paciente.apellidoPaterno} ${paciente.apellidoMaterno}`;

  doc.rect(0, 90, W, 130).fill(BG_GRIS);
  doc.rect(0, 90, W, 1).fill(BORDE);
  doc.rect(0, 219, W, 1).fill(BORDE);

  // Nombre destacado
  doc.rect(28, 103, 4, 36).fill(AZUL_CLARO);
  doc.fontSize(17).fillColor('#1E293B').font('Helvetica-Bold')
    .text(nombreCompleto, 40, 103, { width: 380 });

  // Datos en dos columnas
  const col1X = 40, col2X = 310;
  const datosY = 132;
  const lineH = 16;

  const campo = (label: string, valor: string | null | undefined, x: number, y: number) => {
    doc.fontSize(7.5).fillColor(GRIS).font('Helvetica').text(label.toUpperCase(), x, y);
    doc.fontSize(9.5).fillColor('#1E293B').font('Helvetica-Bold').text(valor || '—', x, y + 9, { width: 240 });
  };

  campo('Tipo y N° Documento', `${paciente.tipoDocumento} ${paciente.numeroDocumento}`, col1X, datosY);
  campo('Teléfono / Celular', paciente.telefono, col1X, datosY + lineH * 2);

  campo('Correo electrónico', paciente.email || 'No registrado', col2X, datosY);
  const fnac = paciente.fechaNacimiento
    ? new Date(paciente.fechaNacimiento).toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' })
    : 'No registrado';
  campo('Fecha de Nacimiento', fnac, col2X, datosY + lineH * 2);

  // ── TARJETAS DE ESTADÍSTICAS ────────────────────────────────────────────
  const statsY = 228;
  doc.rect(0, 220, W, 82).fill('#FFFFFF');
  doc.rect(0, 301, W, 1).fill(BORDE);

  const statCards = [
    { label: 'Total Citas', valor: String(total), color: AZUL_CLARO, bg: '#EFF6FF' },
    { label: 'Completadas', valor: String(completadas), color: VERDE, bg: '#F0FDF4' },
    { label: 'No Asistió', valor: String(noShows), color: ROJO, bg: '#FEF2F2' },
    { label: 'Canceladas', valor: String(canceladas), color: GRIS, bg: '#F8FAFC' },
    { label: 'Pendientes', valor: String(pendientes), color: NARANJA, bg: '#FFFBEB' },
    { label: '% Asistencia', valor: `${asistencia}%`, color: AZUL_MED, bg: '#EFF6FF' },
  ];

  const cardW = (W - 56) / 6;
  statCards.forEach((s, i) => {
    const cx = 28 + i * cardW;
    doc.roundedRect(cx, statsY, cardW - 6, 60, 6).fill(s.bg);
    doc.rect(cx, statsY, 3, 60).fill(s.color);
    doc.fontSize(22).fillColor(s.color).font('Helvetica-Bold')
      .text(s.valor, cx + 8, statsY + 10, { width: cardW - 18, align: 'center' });
    doc.fontSize(7).fillColor(GRIS).font('Helvetica')
      .text(s.label, cx + 4, statsY + 40, { width: cardW - 12, align: 'center' });
  });

  // ── MAPA DE ESTADOS ─────────────────────────────────────────────────────
  // asistencia: 'si' | 'no' | 'cancelada' | 'pendiente'
  type AsistenciaKey = 'si' | 'no' | 'cancelada' | 'pendiente';
  const asistenciaMap: Record<string, AsistenciaKey> = {
    completada:  'si',
    llego:       'si',
    en_atencion: 'si',
    no_show:     'no',
    cancelada:   'cancelada',
    agendada:    'pendiente',
    confirmada:  'pendiente',
  };

  const asistenciaCfg: Record<AsistenciaKey, { simbolo: string; label: string; sublabel: string; color: string; bg: string }> = {
    si:        { simbolo: '✓', label: 'SÍ ASISTIÓ',  sublabel: '',           color: VERDE,    bg: '#F0FDF4' },
    no:        { simbolo: '✗', label: 'NO ASISTIÓ',  sublabel: '',           color: ROJO,     bg: '#FEF2F2' },
    cancelada: { simbolo: '○', label: 'CANCELADA',   sublabel: '',           color: GRIS,     bg: '#F8FAFC' },
    pendiente: { simbolo: '→', label: 'PENDIENTE',   sublabel: '',           color: AZUL_MED, bg: '#EFF6FF' },
  };

  const estadoLabel: Record<string, string> = {
    completada:  'Atención completada',
    llego:       'Paciente llegó',
    en_atencion: 'En atención',
    no_show:     'No se presentó',
    cancelada:   'Cancelada',
    agendada:    'Por confirmar',
    confirmada:  'Confirmada',
  };

  // ── COLUMNAS ──────────────────────────────────────────────────────────────
  const cols = [
    { label: 'ASISTENCIA',      x: 6,   w: 82  },
    { label: 'FECHA',           x: 92,  w: 58  },
    { label: 'HORA',            x: 154, w: 34  },
    { label: 'SERVICIO',        x: 192, w: 148 },
    { label: 'PROFESIONAL',     x: 344, w: 118 },
    { label: 'SEDE / UNIDAD',   x: 466, w: 102 },
  ];

  // ── ENCABEZADO DE TABLA ─────────────────────────────────────────────────
  const tableHeaderY = 312;
  doc.rect(0, 302, W, 26).fill(AZUL);
  doc.fontSize(7.5).fillColor('#FFFFFF').font('Helvetica-Bold');
  cols.forEach(c => doc.text(c.label, c.x, tableHeaderY, { width: c.w }));

  let rowY = 330;
  const rowH = 34;
  const PAGE_H = 841.89;
  const MARGIN_BOTTOM = 60;

  const drawTableHeader = (y: number) => {
    doc.rect(0, y, W, 24).fill(AZUL_CLARO);
    doc.fontSize(7.5).fillColor('#FFFFFF').font('Helvetica-Bold');
    cols.forEach(c => doc.text(c.label, c.x, y + 6, { width: c.w }));
  };

  const addPage = () => {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.rect(0, 0, W, 36).fill(AZUL);
    doc.fontSize(10).fillColor('#FFFFFF').font('Helvetica-Bold')
      .text(`Historial de Atenciones — ${nombreCompleto}`, 28, 12, { width: W - 56 });
    drawTableHeader(36);
    rowY = 66;
  };

  // ── FILAS ────────────────────────────────────────────────────────────────
  citas.forEach((cita, idx) => {
    if (rowY + rowH > PAGE_H - MARGIN_BOTTOM) addPage();

    const asistKey: AsistenciaKey = asistenciaMap[cita.estado] ?? 'pendiente';
    const asist = asistenciaCfg[asistKey];
    const isEven = idx % 2 === 0;
    const bgRow = isEven ? '#FFFFFF' : '#F9FAFB';

    // Fondo de fila
    doc.rect(0, rowY, W, rowH).fill(bgRow);

    // Barra lateral del color de asistencia
    doc.rect(0, rowY, 5, rowH).fill(asist.color);

    // ── Columna ASISTENCIA (grande y clara) ──────────────────────────────
    // Fondo del badge
    doc.roundedRect(8, rowY + 4, 76, rowH - 8, 5).fill(asist.bg);
    // Símbolo grande
    doc.fontSize(13).fillColor(asist.color).font('Helvetica-Bold')
      .text(asist.simbolo, 8, rowY + 6, { width: 28, align: 'center' });
    // Label principal
    doc.fontSize(7).fillColor(asist.color).font('Helvetica-Bold')
      .text(asist.label, 36, rowY + 7, { width: 46 });
    // Sub-label: estado exacto del sistema
    doc.fontSize(6.5).fillColor(asist.color).font('Helvetica')
      .text(estadoLabel[cita.estado] ?? cita.estado, 36, rowY + 17, { width: 46 });

    // ── Fecha ────────────────────────────────────────────────────────────
    const fechaStr = cita.fecha instanceof Date
      ? cita.fecha.toLocaleDateString('es-PE', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
      : String(cita.fecha).slice(0, 10).split('-').reverse().join('/');
    doc.fontSize(8.5).fillColor('#1E293B').font('Helvetica-Bold')
      .text(fechaStr, 92, rowY + 8, { width: 58 });

    // ── Hora ─────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor(GRIS).font('Helvetica')
      .text(cita.horaInicio, 154, rowY + 8, { width: 34 });

    // ── Servicio + Unidad ─────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica-Bold')
      .text(cita.servicio.nombre, 192, rowY + 5, { width: 146 });
    doc.fontSize(6.5).fillColor(GRIS).font('Helvetica')
      .text(cita.unidadNegocio.nombre, 192, rowY + 17, { width: 146 });

    // ── Profesional ───────────────────────────────────────────────────────
    const profNombre = cita.profesional
      ? `${cita.profesional.nombres} ${cita.profesional.apellidos}`
      : 'Sin asignar';
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica')
      .text(profNombre, 344, rowY + 10, { width: 116 });

    // ── Sede ──────────────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#1E293B').font('Helvetica-Bold')
      .text(cita.sede.nombre, 466, rowY + 10, { width: 100 });

    // Línea separadora
    doc.rect(0, rowY + rowH - 0.5, W, 0.5).fill(BORDE);

    rowY += rowH;
  });

  // ── FOOTER ──────────────────────────────────────────────────────────────
  const totalPages = (doc.bufferedPageRange().count);
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    const footerY = PAGE_H - 40;
    doc.rect(0, footerY - 2, W, 42).fill(AZUL);
    doc.fontSize(7.5).fillColor('#93C5FD').font('Helvetica')
      .text(
        `Documento confidencial · Limablue Corp. · Sistema desarrollado por Daniel Doy`,
        28, footerY + 6, { width: W - 160 }
      );
    doc.fontSize(7.5).fillColor('#93C5FD').font('Helvetica')
      .text(`Página ${i + 1} de ${totalPages}`, W - 100, footerY + 6, { width: 72, align: 'right' });
  }

  doc.end();
});

export default router;
