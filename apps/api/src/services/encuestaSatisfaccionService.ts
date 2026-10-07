/**
 * ENCUESTA DE SATISFACCIÓN (07-oct-2026)
 *
 * 2 horas después de que una cita pasa a «Completada» se envía al paciente un correo con el botón a la encuesta
 * (ENCUESTA_SATISFACCION_URL, por defecto https://encuestalimablue.pages.dev/). Lo hace un BARRIDO cada 5 min
 * (no depende de Redis), igual que los demás envíos programados. Reglas:
 *  - Solo si el paciente tiene un correo válido (registrado, sin rebote previo y no de relleno).
 *  - Una por VISITA (paciente + día): dos citas el mismo día o un bloque de 2 tratamientos → un solo correo.
 *  - Solo si la cita SIGUE «Completada» al momento de enviar (si se revirtió o canceló, no sale).
 *  - Horario de envío 8:00–21:00 (Lima): lo que cae de noche sale a las 8:00.
 *  - No se repite al mismo paciente antes de ENCUESTA_DIAS_SIN_REPETIR días (30 por defecto).
 *  - Solo citas completadas desde ENCUESTA_DESDE (arranque de la función: no se manda a las de antes).
 * Cada visita queda en `encuestas_satisfaccion` (enviada / omitida con su motivo / error) y lo enviado, en la
 * auditoría de la cita («encuesta_enviada»). Se apaga con ENCUESTA_SATISFACCION_ACTIVA=false.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { enviarEmail } from './emailService';
import { esEmailEnviable, renderPlantillaEncuesta } from './emailTemplates';
import { reservarCupoEnvio } from './mailQuota';
import { registrarAudit } from './audit';
import { esFichaAdicional } from '../utils/fichaAdicional';
import { fechaAStr } from '../utils/fechaLima';

const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const HORAS_DESPUES = () => num(process.env.ENCUESTA_HORAS_DESPUES, 2);
const DIAS_SIN_REPETIR = () => num(process.env.ENCUESTA_DIAS_SIN_REPETIR, 30);
const URL_ENCUESTA = () => process.env.ENCUESTA_SATISFACCION_URL?.trim() || 'https://encuestalimablue.pages.dev/';
// Desde cuándo: solo citas completadas DESPUÉS de activar la función (no se manda a la carga de días anteriores).
const DESDE = () => new Date(process.env.ENCUESTA_DESDE?.trim() || '2026-10-07T09:30:00-05:00');
const HORA_INICIO = 8;
const HORA_FIN = 21;
const MAX_INTENTOS = 3;
const VENTANA_HORAS = 36; // más atrás que esto no se busca (lo de anoche entra a las 8:00)

export function encuestaActiva(): boolean {
  const v = (process.env.ENCUESTA_SATISFACCION_ACTIVA ?? 'true').trim().toLowerCase();
  return v !== 'false' && v !== '0';
}

function horaLima(d: Date): number {
  return (d.getUTCHours() - 5 + 24) % 24;
}
function hoyLima(d: Date): Date {
  return new Date(new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00Z');
}
const nombrePropio = (s: string) => s.trim().toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
const primero = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? '';

const incluirCita = {
  paciente: { select: { id: true, nombres: true, email: true, emailInvalido: true } },
  sede: { select: { nombre: true } },
  servicio: { select: { nombre: true } },
  subcategoria: { select: { nombre: true } },
  profesional: { select: { nombres: true, apellidos: true } },
  atendidoPor: { select: { nombres: true, apellidos: true } },
  medico: { select: { nombres: true, apellidos: true } },
  solicitadoProfesional: { select: { nombres: true, apellidos: true } },
} satisfies Prisma.CitaInclude;
type CitaEncuesta = Prisma.CitaGetPayload<{ include: typeof incluirCita }>;

/** Quién atendió de verdad: la de «Adicional», el médico de baro, o la profesional de la columna (si es persona). */
function quienAtendio(c: CitaEncuesta): string | null {
  const persona = (p: { nombres: string; apellidos: string } | null) => (p ? nombrePropio(`${primero(p.nombres)} ${primero(p.apellidos)}`) : null);
  if (c.atendidoPor) return persona(c.atendidoPor);
  const columnaEsPersona = c.profesional && !esFichaAdicional(c.profesional.nombres) && !/^baro\b/i.test(c.profesional.nombres.trim());
  if (columnaEsPersona) return persona(c.profesional);
  return persona(c.medico) ?? persona(c.solicitadoProfesional);
}

/** Motivo por el que NO se envía (o null si se puede enviar). */
async function motivoParaOmitir(c: CitaEncuesta, ahora: Date): Promise<string | null> {
  const email = c.paciente.email?.trim();
  if (!email) return 'sin_correo';
  if (c.paciente.emailInvalido) return 'correo_rebotado';
  if (!esEmailEnviable(email)) return 'correo_no_valido';
  const reciente = await prisma.encuestaSatisfaccion.findFirst({
    where: { pacienteId: c.pacienteId, estado: 'enviada', enviadoEn: { gt: new Date(ahora.getTime() - DIAS_SIN_REPETIR() * 86_400_000) } },
    select: { id: true },
  });
  return reciente ? 'encuesta_reciente' : null;
}

async function enviarUna(c: CitaEncuesta, filaId: string): Promise<boolean> {
  const sub = c.subcategoria?.nombre;
  const html = renderPlantillaEncuesta({
    nombre: nombrePropio(primero(c.paciente.nombres)) || 'Hola',
    servicio: sub ? `${c.servicio.nombre} · ${sub}` : c.servicio.nombre,
    sede: c.sede.nombre,
    profesional: quienAtendio(c),
    fechaDate: c.fecha,
    hora: c.horaInicio,
    url: URL_ENCUESTA(),
  });
  try {
    const r = await enviarEmail({ to: c.paciente.email!.trim(), subject: `${nombrePropio(primero(c.paciente.nombres))}, ¿cómo te fue en tu cita en Limablue?`, html });
    await prisma.encuestaSatisfaccion.update({
      where: { id: filaId },
      data: { estado: 'enviada', resendEmailId: r?.id ?? null, enviadoEn: new Date(), motivo: r ? null : 'proveedor_no_configurado', intentos: { increment: 1 } },
    });
    void registrarAudit({ accion: 'encuesta_enviada', entidad: 'cita', entidadId: c.id, citaId: c.id, sedeId: c.sedeId,
      despues: { destinatario: c.paciente.email, resendEmailId: r?.id ?? null, url: URL_ENCUESTA() } });
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await prisma.encuestaSatisfaccion.update({ where: { id: filaId }, data: { estado: 'error', motivo: msg, intentos: { increment: 1 } } });
    console.warn(`[encuesta] no se pudo enviar a ${c.paciente.email} (cita ${c.id}): ${msg}`);
    return false;
  }
}

let corriendo = false;
/** Barrido: envía las encuestas pendientes. Devuelve el resumen (para logs y pruebas). */
export async function barrerEncuestas(ahora = new Date()): Promise<{ enviadas: number; omitidas: number; errores: number; fueraDeHorario?: boolean }> {
  const res = { enviadas: 0, omitidas: 0, errores: 0 };
  if (!encuestaActiva() || corriendo) return res;
  const h = horaLima(ahora);
  if (h < HORA_INICIO || h >= HORA_FIN) return { ...res, fueraDeHorario: true };
  corriendo = true;
  try {
    const limite = new Date(ahora.getTime() - HORAS_DESPUES() * 3600_000);
    const desde = new Date(Math.max(ahora.getTime() - VENTANA_HORAS * 3600_000, DESDE().getTime()));
    if (desde > limite) return res;

    // 1) Reintentos de las que fallaron (máx. 3, solo del último día) — si la cita sigue completada.
    const fallidas = await prisma.encuestaSatisfaccion.findMany({
      where: { estado: 'error', intentos: { lt: MAX_INTENTOS }, creadoEn: { gt: new Date(ahora.getTime() - 24 * 3600_000) } },
      select: { id: true, citaId: true }, take: 50,
    });
    for (const f of fallidas) {
      const c = await prisma.cita.findFirst({ where: { id: f.citaId, estado: 'completada', deletedAt: null }, include: incluirCita });
      if (!c) { await prisma.encuestaSatisfaccion.update({ where: { id: f.id }, data: { estado: 'omitida', motivo: 'cita_ya_no_completada' } }); res.omitidas++; continue; }
      if (!(await reservarCupoEnvio('auto'))) return res; // sin cupo hoy: se reintenta en el próximo barrido
      if (await enviarUna(c, f.id)) res.enviadas++; else res.errores++;
    }

    // 2) Citas completadas hace ≥ 2 h que aún no tienen encuesta en su visita (paciente + día).
    const candidatas = await prisma.cita.findMany({
      where: { estado: 'completada', deletedAt: null, completadaEn: { gte: desde, lte: limite }, fecha: { lte: hoyLima(ahora) } },
      include: incluirCita,
      orderBy: { completadaEn: 'asc' },
      take: 300,
    });
    if (!candidatas.length) return res;
    const ya = await prisma.encuestaSatisfaccion.findMany({
      where: { OR: candidatas.map((c) => ({ pacienteId: c.pacienteId, fecha: c.fecha })) },
      select: { pacienteId: true, fecha: true },
    });
    const visto = new Set(ya.map((x) => `${x.pacienteId}|${fechaAStr(x.fecha)}`));

    for (const c of candidatas) {
      const clave = `${c.pacienteId}|${fechaAStr(c.fecha)}`;
      if (visto.has(clave)) continue; // otra cita de la misma visita ya la tiene
      visto.add(clave);
      const motivo = await motivoParaOmitir(c, ahora);
      let fila: { id: string };
      try {
        fila = await prisma.encuestaSatisfaccion.create({
          data: { citaId: c.id, pacienteId: c.pacienteId, fecha: c.fecha, sedeId: c.sedeId, email: c.paciente.email?.trim() || null,
            estado: motivo ? 'omitida' : 'enviando', motivo },
          select: { id: true },
        });
      } catch {
        continue; // otro proceso la tomó (índice único por cita y por visita)
      }
      if (motivo) { res.omitidas++; continue; }
      if (!(await reservarCupoEnvio('auto'))) {
        await prisma.encuestaSatisfaccion.update({ where: { id: fila.id }, data: { estado: 'error', motivo: 'cuota_diaria' } });
        return res;
      }
      if (await enviarUna(c, fila.id)) res.enviadas++; else res.errores++;
    }
    return res;
  } finally {
    corriendo = false;
  }
}

/** Arranca el barrido cada 5 minutos (lo llama index.ts). */
export function iniciarBarridoEncuestas(): void {
  if (!encuestaActiva()) { console.log('[encuesta] desactivada (ENCUESTA_SATISFACCION_ACTIVA=false)'); return; }
  const correr = () => barrerEncuestas().then((r) => {
    if (r.enviadas || r.errores) console.log(`[encuesta] enviadas ${r.enviadas} · omitidas ${r.omitidas} · errores ${r.errores}`);
  }).catch((e) => console.error('[encuesta] error en el barrido:', e));
  setTimeout(correr, 60_000);
  setInterval(correr, 5 * 60_000);
}
