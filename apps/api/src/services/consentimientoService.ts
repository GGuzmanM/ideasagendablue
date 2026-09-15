/**
 * Consentimiento informado (5.1) firmado en la tablet.
 *
 * Inmutable como la receta: el TEXTO que se leyó y firmó queda como snapshot y la corrección es la
 * REVOCACIÓN con motivo (queda en el historial y en su PDF con marca de agua; nunca se borra). La
 * firma son trazos normalizados 0..1 sobre un lienzo de proporción `firmaAspecto` (ancho/alto); el
 * PDF la redibuja como vector. Solo se firma en una atención ABIERTA (el consentimiento va antes
 * del procedimiento).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx } from './audit';
import { Ctx, etiquetaUsuario } from './historiaClinicaService';

const ctxAudit = (c: Ctx) => ({ usuarioId: c.usuarioId, ip: c.ip, userAgent: c.userAgent });

export interface TrazoFirma { puntos: [number, number][]; grosor?: number }

const MAX_TRAZOS = 300, MAX_PUNTOS_TRAZO = 2000, MIN_PUNTOS_FIRMA = 12;

/** Valida y sanea la firma. 400 FIRMA_INVALIDA / FIRMA_VACIA. */
export function validarFirma(firma: unknown): TrazoFirma[] {
  if (!Array.isArray(firma) || firma.length > MAX_TRAZOS) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
  const limpia: TrazoFirma[] = [];
  let total = 0;
  for (const t of firma) {
    const puntos = (t as { puntos?: unknown })?.puntos;
    if (!Array.isArray(puntos) || puntos.length > MAX_PUNTOS_TRAZO) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
    const pts: [number, number][] = [];
    for (const p of puntos) {
      if (!Array.isArray(p) || p.length < 2) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
      const x = Number(p[0]), y = Number(p[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new AppError('La firma no es válida', 400, 'FIRMA_INVALIDA');
      pts.push([Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
    }
    if (!pts.length) continue;
    const g = Number((t as { grosor?: unknown }).grosor);
    limpia.push({ puntos: pts, grosor: Number.isFinite(g) ? Math.min(12, Math.max(1, g)) : 3 });
    total += pts.length;
  }
  if (total < MIN_PUNTOS_FIRMA) throw new AppError('Falta la firma: pide que firme en el recuadro', 400, 'FIRMA_VACIA');
  return limpia;
}

export async function crearConsentimiento(p: Ctx & {
  atencionId: string; procedimiento: string; texto: string;
  firmanteNombre: string; firmanteDocumento?: string | null; firmanteRelacion: 'paciente' | 'apoderado';
  firma: unknown; firmaAspecto: number;
}) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: p.atencionId },
    select: { id: true, estado: true, pacienteId: true, sedeId: true, citaId: true, profesionalId: true, profesional: { select: { nombres: true, apellidos: true } } },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  if (at.estado !== 'abierta') throw new AppError('El consentimiento se firma con la atención abierta (antes del procedimiento)', 409, 'ATENCION_CERRADA');
  if (p.firmanteRelacion === 'apoderado' && !(p.firmanteDocumento ?? '').trim()) {
    throw new AppError('Para un apoderado, registra su documento de identidad', 400, 'FALTA_DOCUMENTO_APODERADO');
  }
  const firma = validarFirma(p.firma);
  const etiqueta = await etiquetaUsuario(prisma, p.usuarioId);
  const c = await prisma.$transaction(async (tx) => {
    const creado = await tx.consentimientoInformado.create({
      data: {
        atencionId: at.id, pacienteId: at.pacienteId, sedeId: at.sedeId,
        procedimiento: p.procedimiento.trim(), texto: p.texto.trim(),
        firmanteNombre: p.firmanteNombre.trim(), firmanteDocumento: (p.firmanteDocumento ?? '').trim() || null, firmanteRelacion: p.firmanteRelacion,
        firma: firma as unknown as Prisma.InputJsonValue, firmaAspecto: p.firmaAspecto,
        profesionalId: at.profesionalId, profesionalEtiqueta: `${at.profesional.nombres} ${at.profesional.apellidos}`.trim(),
        registradoPorUsuarioId: p.usuarioId ?? null, registradoEtiqueta: etiqueta,
      },
      select: { id: true, numero: true },
    });
    await auditEnTx(tx, {
      ...ctxAudit(p), citaId: at.citaId, sedeId: at.sedeId, accion: 'firmar_consentimiento', entidad: 'consentimiento', entidadId: creado.id,
      despues: { numero: creado.numero, procedimiento: p.procedimiento.trim(), firmante: p.firmanteNombre.trim(), relacion: p.firmanteRelacion, trazos: firma.length },
    });
    return creado;
  });
  return c;
}

export async function revocarConsentimiento(p: Ctx & { id: string; motivo: string }) {
  const c = await prisma.consentimientoInformado.findUnique({ where: { id: p.id }, select: { id: true, estado: true, sedeId: true, numero: true } });
  if (!c) throw new AppError('Consentimiento no encontrado', 404);
  if (c.estado === 'revocado') throw new AppError('El consentimiento ya fue revocado', 409, 'YA_REVOCADO');
  await prisma.$transaction(async (tx) => {
    // Con guarda: dos revocaciones a la vez → la segunda recibe 409 y no pisa el motivo de la primera.
    const u = await tx.consentimientoInformado.updateMany({
      where: { id: c.id, estado: 'firmado' },
      data: { estado: 'revocado', revocadoEn: new Date(), revocadoPorUsuarioId: p.usuarioId ?? null, motivoRevocacion: p.motivo.trim() },
    });
    if (u.count === 0) throw new AppError('El consentimiento ya fue revocado', 409, 'YA_REVOCADO');
    await auditEnTx(tx, {
      ...ctxAudit(p), sedeId: c.sedeId, accion: 'revocar_consentimiento', entidad: 'consentimiento', entidadId: c.id,
      antes: { estado: 'firmado' }, despues: { estado: 'revocado', motivo: p.motivo.trim() },
    });
  });
}

/** Todo para el PDF del consentimiento. */
export async function consentimientoParaPdf(id: string) {
  const c = await prisma.consentimientoInformado.findUnique({
    where: { id },
    include: {
      atencion: {
        select: {
          fecha: true, sedeId: true,
          sede: { select: { nombre: true, direccion: true } },
          servicio: { select: { nombre: true } },
          historiaClinica: { select: { numero: true } },
          paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true, tipoDocumento: true, numeroDocumento: true, fechaNacimiento: true, sexo: true } },
        },
      },
    },
  });
  if (!c) throw new AppError('Consentimiento no encontrado', 404);
  return c;
}
export type ConsentimientoParaPdf = Awaited<ReturnType<typeof consentimientoParaPdf>>;
