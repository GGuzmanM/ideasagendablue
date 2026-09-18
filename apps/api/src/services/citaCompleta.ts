/**
 * Lectura COMPLETA de una cita para respuestas, eventos de tiempo real y webhooks.
 *
 * Vivía dentro de `routes/citas.ts`; se movió aquí para que los servicios (cambio de estado,
 * aparato del consultorio) la usen sin importar la ruta (evita la importación circular).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { auditEnTx } from './audit';

// Campos de la promoción que se exponen en la cita.
export const promoCitaSelect = { id: true, nombre: true, tipo: true, valor: true } as const;

// Include reutilizable del hilo de comentarios (append-only, orden cronológico).
// `autor` (vivo) para el nombre actual; `autorEtiqueta` (snapshot) como respaldo/legacy.
export const comentariosInclude = {
  where: { deletedAt: null },
  orderBy: { creadoEn: 'asc' },
  select: { id: true, texto: true, creadoEn: true, autorEtiqueta: true, autor: { select: { id: true, nombre: true } } },
} as const;

// Promo HEREDADA de una cita SECUNDARIO de un bloque: la de su portadora (PRINCIPAL).
// null si la cita no es la secundaria de un combinado. Su propio `promocion` es null.
export async function promoHeredadaDe(cita: { slotGrupoId: string | null; slotRol: 'PRINCIPAL' | 'SECUNDARIO' | null }) {
  if (!cita.slotGrupoId || cita.slotRol !== 'SECUNDARIO') return null;
  const portadora = await prisma.cita.findFirst({
    where: { slotGrupoId: cita.slotGrupoId, slotRol: 'PRINCIPAL', deletedAt: null },
    select: { promocion: { select: promoCitaSelect } },
  });
  return portadora?.promocion ?? null;
}

export async function getCitaCompleta(id: string) {
  const cita = await prisma.cita.findUnique({
    where: { id },
    include: {
      paciente: true,
      profesional: true,
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
      // Médico de la cita (podología): quien firma la receta médica de la atención.
      medico: { select: { id: true, nombres: true, apellidos: true, colegiatura: true } },
      sede: true,
      unidadNegocio: true,
      servicio: true,
      subcategoria: { select: { id: true, nombre: true } },
      paquetePaciente: { include: { paquete: true } },
      promocion: { select: promoCitaSelect },
      creadoPorUsuario: { select: { id: true, nombre: true } },
      comentarios: comentariosInclude,
      // Aparato del consultorio: el tiempo real vigente del tratamiento (máx 1, índice parcial).
      tiemposTratamiento: {
        where: { deletedAt: null, estado: { not: 'descartado' } },
        orderBy: { inicioEn: 'desc' },
        take: 1,
        select: { id: true, estado: true, inicioEn: true, finEn: true, duracionSegundos: true, consultorioNumero: true, horaAproximada: true, origen: true },
      },
    },
  });
  if (!cita) return cita;
  return { ...cita, promocionHeredada: await promoHeredadaDe(cita), reprogramacion: await reprogramacionDeCita(cita.id) };
}

export type CitaCompleta = NonNullable<Awaited<ReturnType<typeof getCitaCompleta>>>;

// ─── Reprogramación (para el banner del modal) ────────────────────────────────
// La última vez que ESTA cita se movió a otro día U otra hora, derivada del audit del
// `mover` (que se escribe DENTRO de la transacción → garantizado, no best-effort). Devuelve
// de qué día/hora a qué día/hora y quién lo hizo, para mostrar "Reprogramada del … al …".
async function reprogramacionDeCita(citaId: string): Promise<
  { deFecha: string; deHora: string | null; aFecha: string; aHora: string | null; por: string; en: Date } | null
> {
  const logs = await prisma.auditLog.findMany({
    where: { citaId, accion: 'mover', entidad: 'cita' },
    orderBy: { creadoEn: 'desc' },
    take: 10,
    select: { antes: true, despues: true, usuarioId: true, creadoEn: true },
  });
  for (const log of logs) {
    const antes = log.antes as { fecha?: string; horaInicio?: string } | null;
    const despues = log.despues as { fecha?: string; horaInicio?: string } | null;
    const deFecha = typeof antes?.fecha === 'string' ? antes.fecha.slice(0, 10) : null;
    const aFecha = typeof despues?.fecha === 'string' ? despues.fecha.slice(0, 10) : null;
    // Cuenta como reprogramación si cambió el DÍA o la HORA (mover a otra hora el mismo día
    // también es reprogramar). Un "mover" sin cambios reales queda excluido.
    const cambioHora = !!(antes?.horaInicio && despues?.horaInicio && antes.horaInicio !== despues.horaInicio);
    if (deFecha && aFecha && (deFecha !== aFecha || cambioHora)) {
      const u = log.usuarioId
        ? await prisma.usuario.findUnique({ where: { id: log.usuarioId }, select: { nombre: true } })
        : null;
      return {
        deFecha,
        deHora: antes?.horaInicio ?? null,
        aFecha,
        aHora: despues?.horaInicio ?? null,
        por: u?.nombre ?? 'Sistema',
        en: log.creadoEn,
      };
    }
  }
  return null;
}

// Crea una ENTRADA del hilo append-only + su audit, DENTRO de una transacción.
// `autorId` null = legacy/sistema. `autorEtiqueta` se captura al escribir (snapshot
// del nombre) para que el hilo sea legible aunque el usuario se borre luego.
export async function crearComentarioEnTx(
  tx: Prisma.TransactionClient,
  args: { citaId: string; sedeId: string; autorId?: string | null; texto: string; ip?: string; userAgent?: string },
) {
  const texto = args.texto.trim();
  if (!texto) return;
  let autorEtiqueta: string | null = null;
  if (args.autorId) {
    const u = await tx.usuario.findUnique({ where: { id: args.autorId }, select: { nombre: true } });
    autorEtiqueta = u?.nombre ?? null;
  }
  const entrada = await tx.comentarioCita.create({
    data: { citaId: args.citaId, autorId: args.autorId ?? null, autorEtiqueta, texto },
  });
  await auditEnTx(tx, {
    citaId: args.citaId,
    usuarioId: args.autorId ?? undefined,
    accion: 'agregar_comentario',
    entidad: 'cita',
    entidadId: args.citaId,
    despues: { comentarioId: entrada.id, texto },
    sedeId: args.sedeId,
    ip: args.ip,
    userAgent: args.userAgent,
  });
  return entrada;
}
