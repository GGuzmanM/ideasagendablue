// Plantillas de la historia clínica, todas en la misma tabla:
//   · `nota`          (1.1) — texto S/O/A/P sugerido por diagnóstico CIE-10 (la clave es el código).
//   · `autotexto`     (1.2) — atajo que se expande mientras se escribe (la clave es el atajo, «.oc»).
//   · `consentimiento`(5.2) — cuerpo del consentimiento informado por PROCEDIMIENTO (la clave es el
//     mismo slug que `procedimientos_atencion.tipo`: matricectomia, laser, curacion…). El encabezado
//     legal (quién firma y con qué documento) NO va en la plantilla: lo pone siempre el sistema.
// Contenido editable por administración y médicos; borrado suave y auditado. El contenido clínico y
// legal real lo carga el doctor (las de muestra vienen en la migración y se pueden editar o quitar).
import { prisma } from '../db';
import { esFormatoOficial, normalizarContenido, ErrorConsentimiento } from './consentimientoFormal';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { Ctx, ctxAudit, etiquetaUsuario } from './historiaClinicaService';

export type TipoPlantilla = 'nota' | 'autotexto' | 'consentimiento';
export const TIPOS_PLANTILLA: TipoPlantilla[] = ['nota', 'autotexto', 'consentimiento'];
const CAMPOS_NOTA = ['subjetivo', 'objetivo', 'apreciacion', 'plan'] as const;
const RE_ATAJO = /^[.\/#][a-z0-9_-]{1,20}$/;
/** Procedimientos que pueden tener su propio consentimiento (mismos slugs que el bloque 3). */
const TIPOS_PROCEDIMIENTO = ['matricectomia', 'laser', 'curacion', 'debridacion', 'onicotomia', 'quiropodia', 'infiltracion', 'otro'] as const;
/** Un consentimiento corto no informa de nada; el tope es el mismo que acepta la ruta al firmar. */
const MIN_CONSENTIMIENTO = 120;
const MAX_CONSENTIMIENTO = 20000;

const seleccion = { id: true, tipo: true, clave: true, nombre: true, contenido: true, activa: true, creadoEtiqueta: true, creadoEn: true, actualizadoEn: true } as const;

/** Valida y normaliza contenido + clave según el tipo. Devuelve lo que se guarda. */
function normalizar(tipo: TipoPlantilla, clave: string | null | undefined, contenido: Record<string, unknown>) {
  if (tipo === 'consentimiento') {
    const proc = (clave ?? '').trim().toLowerCase();
    if (!proc) throw new AppError('Elige para qué procedimiento es este consentimiento', 400, 'CONSENTIMIENTO_SIN_PROCEDIMIENTO');
    // Formato OFICIAL por secciones (18-sep-2026): la clave identifica el procedimiento (puede ser
    // uno nuevo, como rodetoplastia o espiculectomía) y el contenido se valida entero.
    if (esFormatoOficial(contenido)) {
      if (!/^[a-z0-9_-]{2,40}$/.test(proc)) throw new AppError('La clave del procedimiento solo lleva minúsculas, números y guiones (ej. «rodetoplastia»)', 400, 'PROCEDIMIENTO_INVALIDO');
      try {
        return { clave: proc, contenido: normalizarContenido(contenido) as unknown as Record<string, string> };
      } catch (e) {
        if (e instanceof ErrorConsentimiento) throw new AppError(e.message, 400, e.code);
        throw e;
      }
    }
    if (!(TIPOS_PROCEDIMIENTO as readonly string[]).includes(proc)) throw new AppError('Ese procedimiento no existe en la lista', 400, 'PROCEDIMIENTO_INVALIDO');
    const texto = typeof contenido.texto === 'string' ? contenido.texto.trim() : '';
    if (texto.length < MIN_CONSENTIMIENTO) throw new AppError(`El consentimiento necesita al menos ${MIN_CONSENTIMIENTO} caracteres: tiene que explicar en qué consiste, los riesgos y los cuidados`, 400, 'CONSENTIMIENTO_CORTO');
    if (texto.length > MAX_CONSENTIMIENTO) throw new AppError(`El consentimiento es demasiado largo (máx. ${MAX_CONSENTIMIENTO})`, 400, 'CONSENTIMIENTO_LARGO');
    return { clave: proc, contenido: { texto } };
  }
  if (tipo === 'autotexto') {
    const atajo = (clave ?? '').trim().toLowerCase();
    if (!RE_ATAJO.test(atajo)) throw new AppError('El atajo debe empezar con ".", "/" o "#" y tener hasta 20 letras o números (ej. ".oc")', 400, 'ATAJO_INVALIDO');
    const texto = typeof contenido.texto === 'string' ? contenido.texto.trim() : '';
    if (!texto) throw new AppError('El autotexto necesita el texto que reemplaza al atajo', 400, 'AUTOTEXTO_SIN_TEXTO');
    if (texto.length > 2000) throw new AppError('El autotexto es demasiado largo (máx. 2000)', 400, 'AUTOTEXTO_LARGO');
    return { clave: atajo, contenido: { texto } };
  }
  const out: Record<string, string> = {};
  for (const c of CAMPOS_NOTA) {
    const v = contenido[c];
    if (typeof v === 'string' && v.trim()) { if (v.length > 5000) throw new AppError(`El campo ${c} es demasiado largo (máx. 5000)`, 400, 'PLANTILLA_LARGA'); out[c] = v.trim(); }
  }
  if (!Object.keys(out).length) throw new AppError('La plantilla necesita al menos un campo (subjetivo, objetivo, apreciación o plan)', 400, 'PLANTILLA_VACIA');
  const cie = (clave ?? '').trim().toUpperCase() || null;
  if (cie && cie.length > 10) throw new AppError('Código CIE-10 no válido', 400, 'CIE10_INVALIDO');
  return { clave: cie, contenido: out };
}

export async function listarPlantillas(tipo?: string) {
  const t = tipo?.trim().toLowerCase();
  return prisma.plantillaClinica.findMany({
    where: { deletedAt: null, ...((TIPOS_PLANTILLA as string[]).includes(t ?? '') ? { tipo: t } : {}) },
    select: seleccion,
    orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
  });
}

export async function crearPlantilla(p: Ctx & { tipo: TipoPlantilla; clave?: string | null; nombre: string; contenido: Record<string, unknown>; activa?: boolean }) {
  const n = normalizar(p.tipo, p.clave, p.contenido);
  if (p.tipo === 'autotexto') {
    const dup = await prisma.plantillaClinica.findFirst({ where: { deletedAt: null, tipo: 'autotexto', clave: n.clave }, select: { id: true } });
    if (dup) throw new AppError(`Ya existe un autotexto con el atajo ${n.clave}`, 409, 'ATAJO_DUPLICADO');
  }
  return prisma.$transaction(async (tx) => {
    const etiqueta = await etiquetaUsuario(tx, p.usuarioId);
    const row = await tx.plantillaClinica.create({
      data: { tipo: p.tipo, clave: n.clave, nombre: p.nombre.trim(), contenido: n.contenido, activa: p.activa ?? true, creadoPorUsuarioId: p.usuarioId ?? null, creadoEtiqueta: etiqueta },
      select: seleccion,
    });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'crear_plantilla', entidad: 'plantilla_clinica', entidadId: row.id, despues: { tipo: row.tipo, clave: row.clave, nombre: row.nombre } });
    return row;
  });
}

export async function editarPlantilla(p: Ctx & { id: string; tipo?: TipoPlantilla; clave?: string | null; nombre?: string; contenido?: Record<string, unknown>; activa?: boolean }) {
  const actual = await prisma.plantillaClinica.findFirst({ where: { id: p.id, deletedAt: null } });
  if (!actual) throw new AppError('Plantilla no encontrada', 404);
  const tipo = (p.tipo ?? actual.tipo) as TipoPlantilla;
  const n = normalizar(tipo, p.clave !== undefined ? p.clave : actual.clave, (p.contenido ?? (actual.contenido as Record<string, unknown>)));
  if (tipo === 'autotexto') {
    const dup = await prisma.plantillaClinica.findFirst({ where: { deletedAt: null, tipo: 'autotexto', clave: n.clave, NOT: { id: p.id } }, select: { id: true } });
    if (dup) throw new AppError(`Ya existe un autotexto con el atajo ${n.clave}`, 409, 'ATAJO_DUPLICADO');
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.plantillaClinica.update({
      where: { id: p.id },
      data: { tipo, clave: n.clave, nombre: (p.nombre ?? actual.nombre).trim(), contenido: n.contenido, activa: p.activa ?? actual.activa },
      select: seleccion,
    });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'editar_plantilla', entidad: 'plantilla_clinica', entidadId: row.id, antes: { clave: actual.clave, nombre: actual.nombre, contenido: actual.contenido }, despues: { clave: row.clave, nombre: row.nombre, contenido: row.contenido } });
    return row;
  });
}

export async function eliminarPlantilla(p: Ctx & { id: string }) {
  const actual = await prisma.plantillaClinica.findFirst({ where: { id: p.id, deletedAt: null }, select: { id: true, tipo: true, clave: true, nombre: true } });
  if (!actual) throw new AppError('Plantilla no encontrada', 404);
  await prisma.$transaction(async (tx) => {
    await tx.plantillaClinica.update({ where: { id: p.id }, data: { deletedAt: new Date() } });
    await auditEnTx(tx, { ...ctxAudit(p), accion: 'eliminar_plantilla', entidad: 'plantilla_clinica', entidadId: p.id, antes: actual });
  });
  return { ok: true };
}
