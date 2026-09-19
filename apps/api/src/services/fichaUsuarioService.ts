/**
 * Ficha de la persona creada (o encontrada) JUNTO con su usuario — alta en un solo paso.
 *
 * Roles que llevan ficha, y dónde aparece:
 *  · recepcionista → `Recepcionista` + asignación administrativa (Movimientos › recepción).
 *  · medico        → `Profesional` tipo médico + asignación administrativa (Movimientos › doctores).
 *  · podologa      → `Profesional` tipo podóloga + asignación de sede + horario tipo (Movimientos y agenda).
 * Coordinación, administración y contact center no llevan ficha: su acceso lo manda el rol.
 *
 * Para no duplicar personas, antes de crear se BUSCA una ficha sin usuario con el mismo nombre:
 * si hay exactamente una, se vincula esa; si hay varias, se pide escribir el nombre completo.
 */
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { fechaDb, hoyLimaStr } from '../utils/fechaLima';

export type RolConFicha = 'recepcionista' | 'medico' | 'podologa';
export const ROLES_CON_FICHA: readonly string[] = ['recepcionista', 'medico', 'podologa'];
export const esRolConFicha = (rol: string | undefined | null): rol is RolConFicha => !!rol && ROLES_CON_FICHA.includes(rol);

// ── Reglas puras (con pruebas) ────────────────────────────────────────────────
/** Minúsculas, sin tildes ni signos, espacios simples: "  Mírtha  CHÁVEZ " → "mirtha chavez". */
export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-zñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * ¿El nombre escrito corresponde a esa ficha? Iguales, o todas las palabras del más corto están en
 * el más largo (mínimo 2 palabras): «Mirtha Chavez» ↔ «Mirtha Chavez Vazquez». Una sola palabra no basta.
 */
export function coincideNombre(escrito: string, ficha: string): boolean {
  const a = normalizarNombre(escrito).split(' ').filter(Boolean);
  const b = normalizarNombre(ficha).split(' ').filter(Boolean);
  if (a.length === 0 || b.length === 0) return false;
  if (a.join(' ') === b.join(' ')) return true;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length < 2) return false;
  return corto.every((p) => largo.includes(p));
}

/** De las fichas libres, cuál corresponde: una → esa; ninguna → crear; varias → ambiguo (exacta gana). */
export function elegirFicha<T extends { nombre: string }>(escrito: string, libres: T[]): { tipo: 'vincular'; ficha: T } | { tipo: 'crear' } | { tipo: 'ambiguo'; candidatas: T[] } {
  const candidatas = libres.filter((f) => coincideNombre(escrito, f.nombre));
  if (candidatas.length === 0) return { tipo: 'crear' };
  if (candidatas.length === 1) return { tipo: 'vincular', ficha: candidatas[0]! };
  const exactas = candidatas.filter((f) => normalizarNombre(f.nombre) === normalizarNombre(escrito));
  if (exactas.length === 1) return { tipo: 'vincular', ficha: exactas[0]! };
  return { tipo: 'ambiguo', candidatas };
}

/** «Ana María Pérez Soto» → nombres «Ana María», apellidos «Pérez Soto» (4+: dos y dos; 3: uno y dos; 2: uno y uno). */
export function partirNombre(completo: string): { nombres: string; apellidos: string } {
  const p = completo.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return { nombres: p[0] ?? '', apellidos: '-' };
  if (p.length === 2) return { nombres: p[0]!, apellidos: p[1]! };
  if (p.length === 3) return { nombres: p[0]!, apellidos: p.slice(1).join(' ') };
  return { nombres: p.slice(0, p.length - 2).join(' '), apellidos: p.slice(-2).join(' ') };
}

/** Último día del mes de `hoy` ("YYYY-MM-DD"). */
export function finDeMes(hoy: string): string {
  const [y, m] = hoy.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

// Horario tipo de una podóloga nueva (el de la casa): lun–vie 08–20, sáb 08–15. Coordinación lo ajusta.
export const HORARIO_TIPO_PODOLOGA = [
  ...[1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, horaInicio: '08:00', horaFin: '20:00', turno: 'completo' as const })),
  { diaSemana: 6, horaInicio: '08:00', horaFin: '15:00', turno: 'manana' as const },
];

// ── Médico → roster de baro (lo que pinta Movimientos › Doctores) ─────────────
/**
 * Registra al médico en la sede dentro del roster de baro (`baro_medico_sede`), que es de donde
 * Movimientos › Doctores saca sus tarjetas, y le habilita «por solicitud» los servicios de baro
 * (igual que POST /baro-solicitud). De hoy a fin de mes: la renovación mensual lo continúa.
 * Si ya tiene un periodo vigente hoy (en cualquier sede), no se toca: manda Movimientos.
 */
export async function registrarMedicoEnBaroEnTx(tx: Prisma.TransactionClient, p: { profesionalId: string; sedeId: string; creadoPor?: string }): Promise<boolean> {
  const hoy = hoyLimaStr();
  const inicio = new Date(`${hoy}T00:00:00`);
  const vigente = await tx.baroMedicoSede.findFirst({
    where: { profesionalId: p.profesionalId, activa: true, fechaInicio: { lte: new Date(`${hoy}T23:59:59`) }, OR: [{ fechaFin: null }, { fechaFin: { gte: inicio } }] },
    select: { id: true },
  });
  if (vigente) return false;
  await tx.baroMedicoSede.create({
    data: { profesionalId: p.profesionalId, sedeId: p.sedeId, activa: true, fechaInicio: inicio, fechaFin: new Date(`${finDeMes(hoy)}T00:00:00`), creadoPor: p.creadoPor },
  });
  const unidad = await tx.unidadNegocio.findFirst({ where: { nombre: { startsWith: 'Baropodometr' }, deletedAt: null }, select: { id: true } });
  const servicios = unidad ? await tx.servicio.findMany({ where: { unidadNegocioId: unidad.id, deletedAt: null }, select: { id: true } }) : [];
  for (const sv of servicios) {
    await tx.competenciaProfesional.upsert({
      where: { profesionalId_servicioId: { profesionalId: p.profesionalId, servicioId: sv.id } },
      update: { activa: true, soloPorSolicitud: true },
      create: { profesionalId: p.profesionalId, servicioId: sv.id, habilitadoDesde: new Date(), activa: true, soloPorSolicitud: true, creadoPor: p.creadoPor },
    });
  }
  return true;
}

// ── Escritura (dentro de la transacción del usuario) ──────────────────────────
export interface PedidoFicha { rol: RolConFicha; nombre: string; sedeId: string; colegiatura?: string | null; creadoPor?: string; ip?: string; userAgent?: string }
export interface FichaResuelta { recepcionistaId?: string; profesionalId?: string; accion: 'creada' | 'vinculada'; nombreFicha: string }

const TIPO_PROF: Record<'medico' | 'podologa', 'medico' | 'podologa'> = { medico: 'medico', podologa: 'podologa' };

export async function resolverFichaEnTx(tx: Prisma.TransactionClient, p: PedidoFicha): Promise<FichaResuelta> {
  const sede = await tx.sede.findFirst({ where: { id: p.sedeId, deletedAt: null }, select: { id: true } });
  if (!sede) throw new AppError('La sede donde empieza a trabajar no existe', 404, 'SEDE_INVALIDA');
  const hoy = hoyLimaStr();
  const ambiguo = (nombres: string[]) => new AppError(
    `Hay varias fichas sin usuario que coinciden con ese nombre (${nombres.join(' · ')}). Escribe el nombre completo tal como figura en su ficha.`, 409, 'FICHA_AMBIGUA');

  if (p.rol === 'recepcionista') {
    const libres = await tx.recepcionista.findMany({ where: { deletedAt: null, usuario: null }, select: { id: true, nombre: true } });
    const e = elegirFicha(p.nombre, libres);
    if (e.tipo === 'ambiguo') throw ambiguo(e.candidatas.map((c) => c.nombre));
    if (e.tipo === 'vincular') {
      // Ficha que ya existía: se respeta su sede actual de Movimientos; solo se le da una si hoy no tiene ninguna.
      const vigente = await tx.asignacionAdministrativa.findFirst({ where: { recepcionistaId: e.ficha.id, deletedAt: null, fechaInicio: { lte: fechaDb(hoy) }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb(hoy) } }] }, select: { id: true } });
      if (!vigente) await tx.asignacionAdministrativa.create({ data: { sedeId: p.sedeId, recepcionistaId: e.ficha.id, fechaInicio: fechaDb(hoy), fechaFin: fechaDb(finDeMes(hoy)), notas: 'Creada al vincular su usuario', creadoPor: p.creadoPor } });
      await auditEnTx(tx, { usuarioId: p.creadoPor, accion: 'vincular_ficha_recepcion', entidad: 'recepcionista', entidadId: e.ficha.id, despues: { nombre: e.ficha.nombre, usuario: p.nombre }, sedeId: p.sedeId, ip: p.ip, userAgent: p.userAgent });
      return { recepcionistaId: e.ficha.id, accion: 'vinculada', nombreFicha: e.ficha.nombre };
    }
    const ficha = await tx.recepcionista.create({ data: { nombre: p.nombre.trim(), creadoPor: p.creadoPor } });
    await tx.asignacionAdministrativa.create({ data: { sedeId: p.sedeId, recepcionistaId: ficha.id, fechaInicio: fechaDb(hoy), fechaFin: fechaDb(finDeMes(hoy)), notas: 'Creada junto con su usuario', creadoPor: p.creadoPor } });
    await auditEnTx(tx, { usuarioId: p.creadoPor, accion: 'crear_ficha_recepcion', entidad: 'recepcionista', entidadId: ficha.id, despues: { nombre: ficha.nombre, sedeId: p.sedeId, fechaInicio: hoy, fechaFin: finDeMes(hoy) }, sedeId: p.sedeId, ip: p.ip, userAgent: p.userAgent });
    return { recepcionistaId: ficha.id, accion: 'creada', nombreFicha: ficha.nombre };
  }

  // ── Médico / podóloga: ficha de Profesional ──
  const tipo = TIPO_PROF[p.rol];
  const libresProf = (await tx.profesional.findMany({
    where: { tipo, deletedAt: null, activo: true, esEquipo: false, usuario: null },
    select: { id: true, nombres: true, apellidos: true },
  })).map((f) => ({ id: f.id, nombre: `${f.nombres} ${f.apellidos}`.trim() }));
  const e = elegirFicha(p.nombre, libresProf);
  if (e.tipo === 'ambiguo') throw ambiguo(e.candidatas.map((c) => c.nombre));
  const cmp = p.colegiatura?.trim() || null;
  if (e.tipo === 'vincular') {
    if (p.rol === 'medico' && cmp) await tx.profesional.update({ where: { id: e.ficha.id }, data: { colegiatura: cmp } });
    if (p.rol === 'medico') await registrarMedicoEnBaroEnTx(tx, { profesionalId: e.ficha.id, sedeId: p.sedeId, creadoPor: p.creadoPor });
    await auditEnTx(tx, { usuarioId: p.creadoPor, accion: 'vincular_ficha_profesional', entidad: 'profesional', entidadId: e.ficha.id, despues: { nombre: e.ficha.nombre, usuario: p.nombre, ...(cmp ? { colegiatura: cmp } : {}) }, sedeId: p.sedeId, ip: p.ip, userAgent: p.userAgent });
    return { profesionalId: e.ficha.id, accion: 'vinculada', nombreFicha: e.ficha.nombre };
  }

  const unidad = await tx.unidadNegocio.findFirst({
    where: { nombre: { contains: p.rol === 'medico' ? 'aropodometr' : 'odolog', mode: 'insensitive' } }, select: { id: true },
  });
  if (!unidad) throw new AppError('No se encontró la unidad de negocio para crear la ficha', 500, 'UNIDAD_NO_ENCONTRADA');
  const { nombres, apellidos } = partirNombre(p.nombre);
  const ficha = await tx.profesional.create({
    data: {
      nombres, apellidos, tipo, unidadNegocioId: unidad.id, activo: true, creadoPor: p.creadoPor,
      // Los médicos no tienen columna propia: atienden por solicitud (igual que los del alta de producción).
      ...(p.rol === 'medico' ? { soloPorSolicitud: true, colegiatura: cmp } : {}),
    },
    select: { id: true, nombres: true, apellidos: true },
  });
  if (p.rol === 'medico') {
    await registrarMedicoEnBaroEnTx(tx, { profesionalId: ficha.id, sedeId: p.sedeId, creadoPor: p.creadoPor });
    await tx.asignacionAdministrativa.create({ data: { sedeId: p.sedeId, profesionalId: ficha.id, fechaInicio: fechaDb(hoy), fechaFin: fechaDb(finDeMes(hoy)), notas: 'Creada junto con su usuario', creadoPor: p.creadoPor } });
  } else {
    await tx.asignacionSede.create({ data: { profesionalId: ficha.id, sedeId: p.sedeId, fechaInicio: fechaDb(hoy), fechaFin: null, activa: true, notas: 'Creada junto con su usuario', creadoPor: p.creadoPor } });
    await tx.horarioProfesional.createMany({ data: HORARIO_TIPO_PODOLOGA.map((h) => ({ ...h, profesionalId: ficha.id })) });
  }
  const nombreFicha = `${ficha.nombres} ${ficha.apellidos}`.trim();
  await auditEnTx(tx, { usuarioId: p.creadoPor, accion: 'crear_ficha_profesional', entidad: 'profesional', entidadId: ficha.id, despues: { nombre: nombreFicha, tipo, sedeId: p.sedeId, fechaInicio: hoy, ...(cmp ? { colegiatura: cmp } : {}) }, sedeId: p.sedeId, ip: p.ip, userAgent: p.userAgent });
  return { profesionalId: ficha.id, accion: 'creada', nombreFicha };
}

// ── Un solo nombre por persona: usuario ↔ ficha ───────────────────────────────
/**
 * Parte el nombre nuevo respetando cómo estaba partida la ficha: si tiene la misma cantidad de
 * palabras que antes, los nombres conservan su cantidad («María José | Pérez» → «Ana Lucía | Pérez»);
 * si cambió, se usa la regla general de `partirNombre`.
 */
export function partirComoAntes(nuevo: string, nombresAntes: string, apellidosAntes: string): { nombres: string; apellidos: string } {
  const p = nuevo.trim().split(/\s+/).filter(Boolean);
  const nAntes = nombresAntes.trim().split(/\s+/).filter(Boolean).length;
  const aAntes = apellidosAntes.trim().split(/\s+/).filter((x) => x && x !== '-').length;
  if (p.length >= 2 && nAntes >= 1 && aAntes >= 1 && p.length === nAntes + aAntes) {
    return { nombres: p.slice(0, nAntes).join(' '), apellidos: p.slice(nAntes).join(' ') };
  }
  return partirNombre(nuevo);
}

/**
 * Cambió el nombre del USUARIO → su ficha (recepción o profesional) toma el mismo nombre, para que
 * Movimientos, la agenda, las recetas nuevas y los reportes muestren a la persona igual en todos
 * lados. Lo ya emitido (recetas, constancias, consentimientos firmados) conserva el nombre con el
 * que se firmó: es un documento y no se reescribe.
 */
export async function nombreDeUsuarioAFichaEnTx(tx: Prisma.TransactionClient, p: { nombre: string; recepcionistaId?: string | null; profesionalId?: string | null; usuarioId?: string; ip?: string; userAgent?: string }): Promise<void> {
  const nombre = p.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre) return;
  if (p.recepcionistaId) {
    const r = await tx.recepcionista.findFirst({ where: { id: p.recepcionistaId, deletedAt: null }, select: { id: true, nombre: true } });
    if (r && r.nombre.trim() !== nombre) {
      await tx.recepcionista.update({ where: { id: r.id }, data: { nombre } });
      await auditEnTx(tx, { usuarioId: p.usuarioId, accion: 'renombrar_ficha', entidad: 'recepcionista', entidadId: r.id, antes: { nombre: r.nombre }, despues: { nombre, origen: 'usuario' }, ip: p.ip, userAgent: p.userAgent });
    }
  }
  if (p.profesionalId) {
    const f = await tx.profesional.findFirst({ where: { id: p.profesionalId, deletedAt: null, esEquipo: false }, select: { id: true, nombres: true, apellidos: true } });
    const actual = f ? `${f.nombres} ${f.apellidos}`.trim() : '';
    if (f && actual !== nombre) {
      await tx.profesional.update({ where: { id: f.id }, data: partirComoAntes(nombre, f.nombres, f.apellidos) });
      await auditEnTx(tx, { usuarioId: p.usuarioId, accion: 'renombrar_ficha', entidad: 'profesional', entidadId: f.id, antes: { nombre: actual }, despues: { nombre, origen: 'usuario' }, ip: p.ip, userAgent: p.userAgent });
    }
  }
}

/** Cambió el nombre de la FICHA (Administración › Podólogas, Composición de sede) → su usuario toma el mismo. */
export async function nombreDeFichaAUsuarioEnTx(tx: Prisma.TransactionClient, p: { nombre: string; recepcionistaId?: string; profesionalId?: string; usuarioId?: string; ip?: string; userAgent?: string }): Promise<void> {
  const nombre = p.nombre.trim().replace(/\s+/g, ' ');
  if (!nombre) return;
  const u = await tx.usuario.findFirst({
    where: { deletedAt: null, ...(p.recepcionistaId ? { recepcionistaId: p.recepcionistaId } : { profesionalId: p.profesionalId }) },
    select: { id: true, nombre: true },
  });
  if (!u || u.nombre.trim() === nombre) return;
  await tx.usuario.update({ where: { id: u.id }, data: { nombre } });
  await auditEnTx(tx, { usuarioId: p.usuarioId, accion: 'renombrar_usuario', entidad: 'usuario', entidadId: u.id, antes: { nombre: u.nombre }, despues: { nombre, origen: 'ficha' }, ip: p.ip, userAgent: p.userAgent });
}
