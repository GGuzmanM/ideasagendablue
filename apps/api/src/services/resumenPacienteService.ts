/**
 * Resumen de la atención para el paciente (4.4): junta lo registrado, lo traduce a lenguaje simple
 * (resumenPaciente.ts), lo dibuja en PDF (resumenPacientePdf.ts) y, si se pide, se lo manda al
 * paciente por correo con el PDF adjunto.
 *
 * Reglas:
 *  · Se puede ver y descargar siempre (también con la atención cerrada: el paciente puede pedirlo
 *    después). Enviar por correo exige `hc.registrar`, igual que el resto de acciones de la HC.
 *  · El correo solo sale si el paciente tiene un correo utilizable: si rebotó antes (`emailInvalido`)
 *    o es de un dominio que no recibe, no se intenta y se dice por qué.
 *  · Cada envío queda en la auditoría (`enviar_resumen_paciente`), que es de donde la pantalla saca
 *    «enviado el …». No se guarda copia del PDF: se vuelve a generar igual cuando haga falta.
 */
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { auditEnTx, registrarAudit } from './audit';
import { enviarEmail, resendConfigurado } from './emailService';
import { esEmailEnviable, renderPlantillaResumenAtencion } from './emailTemplates';
import { pdfABuffer } from './pdfComun';
import { armarResumen, type EntradaResumen, type Resumen } from './resumenPaciente';
import { escribirResumenPacientePdf } from './resumenPacientePdf';
import { Ctx, ctxAudit } from './historiaClinicaService';

/** Carga lo que necesita el resumen: la atención con sus hijos y los datos de contacto del paciente. */
export async function datosResumen(atencionId: string) {
  const at = await prisma.atencionClinica.findUnique({
    where: { id: atencionId },
    select: {
      id: true, fecha: true, estado: true, sedeId: true, pacienteId: true,
      sede: { select: { nombre: true } },
      servicio: { select: { nombre: true } },
      profesional: { select: { nombres: true, apellidos: true } },
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, email: true, emailInvalido: true } },
      notas: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { apreciacion: true, plan: true, texto: true, creadoEn: true } },
      diagnosticos: {
        where: { deletedAt: null }, orderBy: { creadoEn: 'asc' },
        select: { cie10Codigo: true, principal: true, cie10: { select: { descripcion: true } } },
      },
      procedimientos: { where: { deletedAt: null }, orderBy: { creadoEn: 'asc' }, select: { nombre: true, pie: true, ubicacion: true } },
      recetas: {
        where: { estado: 'emitida' }, orderBy: { fechaEmision: 'asc' },
        select: { indicacionesGenerales: true, items: { orderBy: { orden: 'asc' }, select: { nombre: true, dosis: true, frecuencia: true, duracion: true, indicaciones: true, tipo: true } } },
      },
      controles: { where: { estado: { not: 'descartado' } }, orderBy: { fechaSugerida: 'asc' }, select: { fechaSugerida: true, motivo: true, estado: true } },
      historiaClinica: { select: { antecedentes: { where: { deletedAt: null }, select: { tipo: true, descripcion: true } } } },
    },
  });
  if (!at) throw new AppError('Atención no encontrada', 404);
  return at;
}
export type DatosResumen = Awaited<ReturnType<typeof datosResumen>>;

/** Traduce lo cargado al formato que entiende `armarResumen` (y de ahí, al PDF). */
export function entradaDesdeAtencion(at: DatosResumen): EntradaResumen {
  const diabetes = at.historiaClinica.antecedentes.some((a) => /diabet/i.test(a.descripcion ?? ''));
  return {
    paciente: at.paciente,
    fecha: at.fecha,
    sede: at.sede?.nombre ?? '',
    profesional: `${at.profesional?.nombres ?? ''} ${at.profesional?.apellidos ?? ''}`.trim(),
    servicio: at.servicio?.nombre ?? '',
    notas: at.notas,
    diagnosticos: at.diagnosticos.map((d) => ({ descripcion: d.cie10?.descripcion ?? '', codigo: d.cie10Codigo, principal: d.principal })),
    procedimientos: at.procedimientos,
    tratamiento: at.recetas.flatMap((r) => r.items),
    indicacionesGenerales: at.recetas.map((r) => (r.indicacionesGenerales ?? '').trim()).filter(Boolean).join('\n') || null,
    controles: at.controles,
    banderas: { diabetes },
  };
}

export async function resumenDeAtencion(atencionId: string): Promise<{ resumen: Resumen; at: DatosResumen }> {
  const at = await datosResumen(atencionId);
  return { resumen: armarResumen(entradaDesdeAtencion(at)), at };
}

/** PDF listo para descargar o adjuntar. */
export async function resumenPdf(atencionId: string): Promise<{ buffer: Buffer; nombre: string; at: DatosResumen }> {
  const { resumen, at } = await resumenDeAtencion(atencionId);
  const buffer = await pdfABuffer('Resumen de tu atención', (doc) => escribirResumenPacientePdf(doc, resumen));
  const dia = new Date(at.fecha).toISOString().slice(0, 10);
  return { buffer, nombre: `resumen-atencion-${dia}.pdf`, at };
}

/** Motivo por el que NO se puede enviar (null = sí se puede). */
export function motivoNoEnviable(at: DatosResumen): string | null {
  const email = (at.paciente.email ?? '').trim();
  if (!email) return 'El paciente no tiene correo registrado en su ficha.';
  if (at.paciente.emailInvalido) return 'El correo del paciente rebotó en envíos anteriores: corrígelo en su ficha.';
  if (!esEmailEnviable(email)) return 'Ese correo no recibe mensajes (dominio de ejemplo o inválido).';
  return null;
}

export async function enviarResumenPaciente(p: Ctx & { atencionId: string }) {
  const { buffer, nombre, at } = await resumenPdf(p.atencionId);
  const motivo = motivoNoEnviable(at);
  if (motivo) throw new AppError(motivo, 400, 'CORREO_NO_ENVIABLE');
  if (!resendConfigurado()) throw new AppError('El envío de correos no está configurado en este servidor', 503, 'CORREO_NO_CONFIGURADO');

  const paciente = `${at.paciente.nombres} ${at.paciente.apellidoPaterno}`.trim();
  const enviado = await enviarEmail({
    to: at.paciente.email!.trim(),
    subject: `Resumen de tu atención en Limablue · ${new Date(at.fecha).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}`,
    html: renderPlantillaResumenAtencion({ paciente, sede: at.sede?.nombre ?? '', profesional: `${at.profesional?.nombres ?? ''} ${at.profesional?.apellidos ?? ''}`.trim() }),
    adjuntos: [{ filename: nombre, contenido: buffer, contentType: 'application/pdf' }],
  });

  await registrarAudit({
    ...ctxAudit(p),
    accion: 'enviar_resumen_paciente',
    entidad: 'atencion_clinica',
    entidadId: at.id,
    sedeId: at.sedeId,
    despues: { correo: at.paciente.email, mensajeId: enviado?.id ?? null, bytes: buffer.length },
  });
  return { enviadoA: at.paciente.email!, id: enviado?.id ?? null };
}

/** Cuándo se envió por última vez (sale de la auditoría; no se guarda copia del PDF). */
export async function ultimoEnvioResumen(atencionId: string) {
  const a = await prisma.auditLog.findFirst({
    where: { accion: 'enviar_resumen_paciente', entidadId: atencionId },
    orderBy: { creadoEn: 'desc' },
    select: { creadoEn: true, usuarioId: true },
  });
  return a ? { enviadoEn: a.creadoEn, porUsuarioId: a.usuarioId } : null;
}

export { auditEnTx };
