/**
 * Reporte de creación de citas (23-oct-2026): QUIÉN creó cada cita y el DÍA y la HORA en que la creó.
 *
 *   GET /reporte-creacion-citas?desde&hasta&sedeId&usuarioId&canal        → resumen por usuario, por hora y detalle
 *   GET /reporte-creacion-citas/excel?…mismos filtros                       → Excel (Resumen + Detalle)
 *
 * `desde`/`hasta` son días de CREACIÓN en hora Lima (no el día de la cita). Una cita doble (bloque de dos
 * servicios) cuenta como UNA reserva: se toma la principal y se le suma el nombre del segundo servicio.
 * Las de la reserva web no tienen usuario: salen como «Reserva web». Permiso `analytics.ver`, con el
 * scoping por sede de siempre. El detalle lleva nombres de pacientes: cada Excel queda en la auditoría.
 */
import { Router, Request } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../db';
import { requireAuth, requirePermiso, assertSede, puedeTodasLasSedes } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { fechaAStr, LIMA_OFFSET_H } from '../utils/fechaLima';
import { registrarAudit } from '../services/audit';

const router = Router();
router.use(requireAuth, requirePermiso('analytics.ver'));

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const filtrosSchema = z.object({
  desde: z.string().regex(FECHA),
  hasta: z.string().regex(FECHA),
  sedeId: z.string().uuid().optional(),
  usuarioId: z.string().optional(), // uuid, o «sin-usuario» (reserva web / API)
  canal: z.string().max(60).optional(),
});
const SIN_USUARIO = 'sin-usuario';
const MAX_DIAS = 93;
const MAX_DETALLE_PANTALLA = 500;
const MAX_DETALLE_EXCEL = 20_000;

const ESTADO: Record<string, string> = {
  agendada: 'Agendada', confirmada: 'Confirmada', llego: 'Llegó', en_atencion: 'En atención',
  completada: 'Completada', no_show: 'No asistió', cancelada: 'Cancelada', reprogramada: 'Reprogramada',
};

/** Inicio del día Lima en UTC (00:00 Lima = 05:00 UTC). */
const inicioDiaLima = (f: string) => new Date(Date.parse(`${f}T00:00:00Z`) + LIMA_OFFSET_H * 3_600_000);
const diaLima = (d: Date) => new Date(d.getTime() - LIMA_OFFSET_H * 3_600_000).toISOString().slice(0, 10);
const horaLima = (d: Date) => new Date(d.getTime() - LIMA_OFFSET_H * 3_600_000).toISOString().slice(11, 16);
const dmy = (iso: string) => iso.split('-').reverse().join('/');

async function cargar(req: Request) {
  const q = filtrosSchema.parse(req.query);
  if (q.desde > q.hasta) throw new AppError('El rango de fechas está invertido', 400, 'RANGO_INVALIDO');
  const dias = (Date.parse(q.hasta) - Date.parse(q.desde)) / 86_400_000 + 1;
  if (dias > MAX_DIAS) throw new AppError(`El rango máximo es de ${MAX_DIAS} días`, 400, 'RANGO_MUY_LARGO');
  if (q.sedeId) assertSede(req, q.sedeId);
  const sedes = q.sedeId ? [q.sedeId] : (req.user && !puedeTodasLasSedes(req.user) ? req.user.sedes : null);

  const creadoEn = { gte: inicioDiaLima(q.desde), lt: new Date(inicioDiaLima(q.hasta).getTime() + 86_400_000) };
  const base = {
    deletedAt: null,
    // La cita doble cuenta una vez (su principal). `slotRol` null = cita suelta: hay que incluirlo a mano
    // (`not` solo no trae los null).
    OR: [{ slotRol: null }, { slotRol: { not: 'SECUNDARIO' as const } }],
    creadoEn,
    ...(sedes ? { sedeId: { in: sedes } } : {}),
    ...(q.canal ? { canal: q.canal } : {}),
  };
  const filtroUsuario = q.usuarioId === SIN_USUARIO ? { creadoPorUsuarioId: null } : q.usuarioId ? { creadoPorUsuarioId: q.usuarioId } : {};

  const [citas, porUsuarioTodos, canales] = await Promise.all([
    prisma.cita.findMany({
      where: { ...base, ...filtroUsuario },
      orderBy: { creadoEn: 'desc' },
      take: MAX_DETALLE_EXCEL,
      select: {
        id: true, creadoEn: true, fecha: true, horaInicio: true, estado: true, canal: true, slotGrupoId: true,
        creadoPorUsuarioId: true,
        creadoPorUsuario: { select: { nombre: true, rol: true } },
        paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true } },
        sede: { select: { nombre: true } },
        servicio: { select: { nombre: true } },
        profesional: { select: { nombres: true, apellidos: true } },
      },
    }),
    // Lista de usuarios del rango SIN el filtro de usuario (para el desplegable).
    prisma.cita.groupBy({ by: ['creadoPorUsuarioId'], where: base, _count: { _all: true } }),
    prisma.canal.findMany({ select: { valor: true, etiqueta: true } }),
  ]);

  // Segundo servicio de las citas dobles
  const grupos = citas.map((c) => c.slotGrupoId).filter((g): g is string => !!g);
  const secundarios = grupos.length
    ? await prisma.cita.findMany({ where: { slotGrupoId: { in: grupos }, slotRol: 'SECUNDARIO', deletedAt: null }, select: { slotGrupoId: true, servicio: { select: { nombre: true } } } })
    : [];
  const extraDe = new Map(secundarios.map((s) => [s.slotGrupoId!, s.servicio.nombre]));
  const etiquetaCanal = new Map(canales.map((c) => [c.valor, c.etiqueta]));
  const idsUsuarios = porUsuarioTodos.map((g) => g.creadoPorUsuarioId).filter((x): x is string => !!x);
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: idsUsuarios } }, select: { id: true, nombre: true, rol: true } });
  const nombreUsuario = new Map(usuarios.map((u) => [u.id, u]));

  const filas = citas.map((c) => {
    const creado = c.creadoEn;
    const fechaCita = fechaAStr(c.fecha);
    const diaCreacion = diaLima(creado);
    const anticipacion = Math.round((Date.parse(fechaCita) - Date.parse(diaCreacion)) / 86_400_000);
    const extra = c.slotGrupoId ? extraDe.get(c.slotGrupoId) : undefined;
    return {
      id: c.id,
      creadoEn: creado.toISOString(),
      diaCreacion,
      horaCreacion: horaLima(creado),
      usuarioId: c.creadoPorUsuarioId ?? SIN_USUARIO,
      usuario: c.creadoPorUsuario?.nombre ?? (c.canal === 'web' ? 'Reserva web' : 'Sin usuario (API)'),
      rol: c.creadoPorUsuario?.rol ?? null,
      paciente: `${c.paciente.nombres} ${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}`.replace(/\s+/g, ' ').trim(),
      documento: `${c.paciente.tipoDocumento} ${c.paciente.numeroDocumento}`,
      sede: c.sede.nombre,
      servicio: extra ? `${c.servicio.nombre} + ${extra}` : c.servicio.nombre,
      profesional: c.profesional ? `${c.profesional.nombres} ${c.profesional.apellidos}`.replace(/\s+/g, ' ').trim() : '',
      fechaCita,
      horaCita: c.horaInicio,
      anticipacionDias: anticipacion,
      retroactiva: anticipacion < 0,
      canal: etiquetaCanal.get(c.canal) ?? c.canal,
      estado: ESTADO[c.estado] ?? c.estado,
    };
  });

  // Resumen por usuario (con los filtros aplicados)
  const resumen = new Map<string, { usuarioId: string; usuario: string; rol: string | null; citas: number; primera: string; ultima: string; dias: Set<string>; retroactivas: number }>();
  for (const f of filas) {
    const r = resumen.get(f.usuarioId) ?? { usuarioId: f.usuarioId, usuario: f.usuario, rol: f.rol, citas: 0, primera: f.creadoEn, ultima: f.creadoEn, dias: new Set<string>(), retroactivas: 0 };
    r.citas++;
    if (f.creadoEn < r.primera) r.primera = f.creadoEn;
    if (f.creadoEn > r.ultima) r.ultima = f.creadoEn;
    r.dias.add(f.diaCreacion);
    if (f.retroactiva) r.retroactivas++;
    resumen.set(f.usuarioId, r);
  }
  const porUsuario = [...resumen.values()]
    .map(({ dias, ...r }) => ({ ...r, diasConCitas: dias.size, promedioPorDia: Math.round((r.citas / dias.size) * 10) / 10 }))
    .sort((a, b) => b.citas - a.citas);

  // Por hora del día en que se crearon (0–23, hora Lima)
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, citas: 0 }));
  for (const f of filas) porHora[Number(f.horaCreacion.slice(0, 2))]!.citas++;

  const opcionesUsuario = porUsuarioTodos
    .map((g) => ({
      id: g.creadoPorUsuarioId ?? SIN_USUARIO,
      nombre: g.creadoPorUsuarioId ? nombreUsuario.get(g.creadoPorUsuarioId)?.nombre ?? 'Usuario eliminado' : 'Reserva web / sin usuario',
      citas: g._count._all,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return { q, filas, porUsuario, porHora, opcionesUsuario, truncado: citas.length >= MAX_DETALLE_EXCEL };
}

router.get('/', async (req, res) => {
  const { q, filas, porUsuario, porHora, opcionesUsuario, truncado } = await cargar(req);
  res.json({
    desde: q.desde,
    hasta: q.hasta,
    totales: {
      citas: filas.length,
      usuarios: porUsuario.filter((u) => u.usuarioId !== SIN_USUARIO).length,
      sinUsuario: filas.filter((f) => f.usuarioId === SIN_USUARIO).length,
      retroactivas: filas.filter((f) => f.retroactiva).length,
    },
    porUsuario,
    porHora,
    usuarios: opcionesUsuario,
    detalle: filas.slice(0, MAX_DETALLE_PANTALLA),
    detalleTotal: filas.length,
    truncado,
  });
});

// Paleta de la marca (la misma del Excel del Visor)
const AZUL = 'FF0F4C9A';
const AZUL_CLARO = 'FFE8F0FB';
const ZEBRA = 'FFF7F9FC';
const BORDE = 'FFD5DDE8';
const AMBAR = 'FFFFF4DB';

function hoja(wb: ExcelJS.Workbook, nombre: string, titulo: string, subtitulo: string, columnas: { header: string; key: string; width: number }[]) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = columnas.map((c) => ({ key: c.key, width: c.width }));
  ws.mergeCells(1, 1, 1, columnas.length);
  ws.getCell(1, 1).value = titulo;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } };
  ws.mergeCells(2, 1, 2, columnas.length);
  ws.getCell(2, 1).value = subtitulo;
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF5B6B80' } };
  const cab = ws.getRow(4);
  columnas.forEach((c, i) => { cab.getCell(i + 1).value = c.header; });
  cab.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  cab.height = 22;
  return ws;
}
function cebra(ws: ExcelJS.Worksheet, desde: number) {
  ws.eachRow((row, n) => {
    if (n < desde) return;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { bottom: { style: 'thin', color: { argb: BORDE } } };
      if ((n - desde) % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
    });
  });
}

router.get('/excel', async (req, res) => {
  const { q, filas, porUsuario, truncado } = await cargar(req);
  const [sede, quien] = await Promise.all([
    q.sedeId ? prisma.sede.findUnique({ where: { id: q.sedeId }, select: { nombre: true } }) : Promise.resolve(null),
    prisma.usuario.findUnique({ where: { id: req.user!.userId }, select: { nombre: true } }),
  ]);
  const periodo = q.desde === q.hasta ? `Creadas el ${dmy(q.desde)}` : `Creadas del ${dmy(q.desde)} al ${dmy(q.hasta)}`;
  const sub = `${periodo} · ${sede?.nombre ?? 'Todas las sedes'} · Generado por ${quien?.nombre ?? 'usuario del sistema'}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Limablue Agenda';
  const r = hoja(wb, 'Resumen por usuario', 'Creación de citas por usuario', sub, [
    { header: 'Usuario', key: 'usuario', width: 32 },
    { header: 'Rol', key: 'rol', width: 20 },
    { header: 'Citas creadas', key: 'citas', width: 14 },
    { header: 'Días con citas', key: 'dias', width: 14 },
    { header: 'Promedio por día', key: 'prom', width: 16 },
    { header: 'Retroactivas', key: 'retro', width: 13 },
    { header: 'Primera creación', key: 'primera', width: 20 },
    { header: 'Última creación', key: 'ultima', width: 20 },
  ]);
  const fh = (iso: string) => { const d = new Date(iso); return `${dmy(diaLima(d))} ${horaLima(d)}`; };
  for (const u of porUsuario) {
    r.addRow({ usuario: u.usuario, rol: (u.rol ?? '').replace(/_/g, ' '), citas: u.citas, dias: u.diasConCitas, prom: u.promedioPorDia, retro: u.retroactivas, primera: fh(u.primera), ultima: fh(u.ultima) });
  }
  const tot = r.addRow({ usuario: 'Total', citas: filas.length, retro: filas.filter((f) => f.retroactiva).length });
  tot.font = { bold: true };
  tot.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } }; });
  cebra(r, 5);

  const d = hoja(wb, 'Detalle', 'Detalle de citas creadas', `${sub}${truncado ? ` · Solo las ${MAX_DETALLE_EXCEL.toLocaleString('es-PE')} más recientes` : ''}`, [
    { header: 'Día de creación', key: 'dia', width: 14 },
    { header: 'Hora de creación', key: 'hora', width: 14 },
    { header: 'Usuario', key: 'usuario', width: 28 },
    { header: 'Paciente', key: 'paciente', width: 32 },
    { header: 'Documento', key: 'doc', width: 16 },
    { header: 'Sede', key: 'sede', width: 16 },
    { header: 'Servicio', key: 'servicio', width: 34 },
    { header: 'Profesional', key: 'prof', width: 26 },
    { header: 'Día de la cita', key: 'fechaCita', width: 14 },
    { header: 'Hora de la cita', key: 'horaCita', width: 13 },
    { header: 'Anticipación (días)', key: 'antic', width: 16 },
    { header: 'Canal', key: 'canal', width: 18 },
    { header: 'Estado actual', key: 'estado', width: 15 },
  ]);
  for (const f of [...filas].reverse()) { // cronológico
    const row = d.addRow({
      dia: dmy(f.diaCreacion), hora: f.horaCreacion, usuario: f.usuario, paciente: f.paciente, doc: f.documento, sede: f.sede,
      servicio: f.servicio, prof: f.profesional, fechaCita: dmy(f.fechaCita), horaCita: f.horaCita,
      antic: f.retroactiva ? `${f.anticipacionDias} (retroactiva)` : f.anticipacionDias, canal: f.canal, estado: f.estado,
    });
    if (f.retroactiva) row.getCell('antic').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBAR } };
  }
  cebra(d, 5);
  d.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 13 } };

  void registrarAudit({
    usuarioId: req.user?.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
    accion: 'exportar_creacion_citas', entidad: 'reporte_creacion_citas', entidadId: req.user!.userId, sedeId: q.sedeId,
    despues: { sede: sede?.nombre ?? 'Todas las sedes', desde: q.desde, hasta: q.hasta, usuarioId: q.usuarioId ?? null, canal: q.canal ?? null, citas: filas.length },
  });
  const archivo = `creacion-citas-${q.desde === q.hasta ? q.desde : `${q.desde}_a_${q.hasta}`}-${(sede?.nombre ?? 'todas-las-sedes').toLowerCase().replace(/\s+/g, '-')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archivo)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  await wb.xlsx.write(res);
  res.end();
});

export default router;
