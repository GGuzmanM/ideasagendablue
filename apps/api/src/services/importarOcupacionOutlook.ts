/**
 * Sincronización INVERSA: calendario Outlook del profesional → Limablue.
 *
 * Lee el calendario del buzón @limablue.com de cada profesional y, por cada evento que él
 * marcó como "Ocupado"/"Fuera de oficina" POR FUERA (independiente de las citas), crea un
 * Bloqueo de agenda (tipo PERMISO) en Limablue — que se pinta en la agenda y frena reservas
 * a esa hora. Es la contraparte de `sincronizarCitaOutlook` (que escribe Limablue → Outlook).
 *
 * Reglas (confirmadas con el usuario):
 *  - Solo cuentan los eventos con `showAs` = busy | oof (Ocupado / Fuera de oficina).
 *  - NUNCA se re-importan los eventos que Limablue empujó (citas/reuniones): se identifican por
 *    su `outlookEventId` guardado en BD. Sin esto entraríamos en bucle.
 *  - El bloqueo se crea en la sede donde el profesional está ASIGNADO ese día. Si no trabaja
 *    ese día en ninguna sede, no se crea nada (igual no estaría disponible).
 *  - Idempotente: cada bloqueo importado guarda el `outlookEventId` del evento de origen. Si el
 *    doctor edita el evento, se actualiza; si lo borra (o lo pasa a "Libre"), el bloqueo se quita.
 *  - Solo aplica a buzones DENTRO del tenant (@limablue.com). Un Gmail/Hotmail externo no se
 *    puede leer por Graph → se omite.
 *
 * Requiere Azure configurado (AZURE_*). Sin credenciales queda inerte.
 */
import { prisma } from '../db';
import {
  outlookConfigurado,
  listarEventosCalendario,
  emailTenantDeProfesional,
} from './outlookCalendarService';
import { invalidateDisponibilidadCache } from '../redis';

const SHOWAS_OCUPADO = new Set(['busy', 'oof']); // "Ocupado" + "Fuera de oficina"
const MOTIVO_PREFIJO = 'Ocupado (Outlook)';

// Instante UTC → { fecha 'YYYY-MM-DD', hora 'HH:mm' } en America/Lima.
function aLima(utc: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(utc);
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  let hh = g('hour'); if (hh === '24') hh = '00';
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${hh}:${g('minute')}` };
}

interface ProfMailbox { id: string; nombres: string; apellidos: string; email: string }

async function importarDeProfesional(prof: ProfMailbox, inicioIso: string, finIso: string) {
  const eventos = await listarEventosCalendario(prof.email, inicioIso, finIso);

  // Eventos que Limablue empujó (citas + reuniones) para ESTE profesional → nunca se re-importan.
  const [citas, reuniones] = await Promise.all([
    prisma.cita.findMany({
      where: { OR: [{ profesionalId: prof.id }, { solicitadoProfesionalId: prof.id }], outlookEventId: { not: null } },
      select: { outlookEventId: true },
    }),
    prisma.bloqueoAgenda.findMany({
      where: { profesionalId: prof.id, esReunion: true, outlookEventId: { not: null } },
      select: { outlookEventId: true },
    }),
  ]);
  const propios = new Set<string>([...citas, ...reuniones].map((x) => x.outlookEventId!).filter(Boolean));

  // Solo eventos "ocupado" del doctor (no nuestros).
  const ocupados = eventos.filter((e) => !propios.has(e.id) && SHOWAS_OCUPADO.has(e.showAs));

  let creados = 0, actualizados = 0, borrados = 0;
  const vistos = new Set<string>();
  const sedesTocadas = new Set<string>(); // "sedeId|YYYY-MM-DD"

  for (const e of ocupados) {
    const ini = aLima(e.inicioUtc);
    const fin = aLima(e.finUtc);
    const fecha = ini.fecha;
    const horaInicio = e.isAllDay ? '00:00' : ini.hora;
    let horaFin = e.isAllDay ? '23:59' : (fin.fecha === ini.fecha ? fin.hora : '23:59');
    if (horaFin <= horaInicio) horaFin = '23:59';

    // Sede donde trabaja ESE día. Si no está asignado, no se bloquea.
    const fechaDate = new Date(`${fecha}T00:00:00`);
    const asig = await prisma.asignacionSede.findFirst({
      where: { profesionalId: prof.id, fechaInicio: { lte: fechaDate }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }] },
      select: { sedeId: true }, orderBy: { fechaInicio: 'desc' },
    });
    if (!asig) continue;

    vistos.add(e.id);
    const fechaInicioDt = new Date(`${fecha}T${horaInicio}:00`);
    const fechaFinDt = new Date(`${fecha}T${horaFin}:00`);
    const motivo = `${MOTIVO_PREFIJO}${e.subject ? ': ' + e.subject : ''}`.slice(0, 200);

    const existente = await prisma.bloqueoAgenda.findFirst({
      where: { profesionalId: prof.id, outlookEventId: e.id, tipo: 'PERMISO', esReunion: false },
      select: { id: true },
    });
    if (existente) {
      await prisma.bloqueoAgenda.update({
        where: { id: existente.id },
        data: { deletedAt: null, sedeId: asig.sedeId, fechaInicio: fechaInicioDt, fechaFin: fechaFinDt, horaInicio, horaFin, motivo },
      });
      actualizados++;
    } else {
      await prisma.bloqueoAgenda.create({
        data: {
          profesionalId: prof.id, sedeId: asig.sedeId, tipo: 'PERMISO', esRecurrente: false,
          fechaInicio: fechaInicioDt, fechaFin: fechaFinDt, horaInicio, horaFin, motivo, outlookEventId: e.id,
        },
      });
      creados++;
    }
    sedesTocadas.add(`${asig.sedeId}|${fecha}`);
  }

  // BORRADO INVERSO: bloqueos importados en la ventana cuyo evento ya NO está "ocupado" en el
  // calendario (el doctor lo borró o lo pasó a "Libre") → se soft-borran.
  const importadosVivos = await prisma.bloqueoAgenda.findMany({
    where: {
      profesionalId: prof.id, tipo: 'PERMISO', esReunion: false, outlookEventId: { not: null }, deletedAt: null,
      fechaInicio: { gte: new Date(inicioIso), lt: new Date(finIso) },
    },
    select: { id: true, outlookEventId: true, sedeId: true, fechaInicio: true },
  });
  for (const b of importadosVivos) {
    if (b.outlookEventId && !vistos.has(b.outlookEventId)) {
      await prisma.bloqueoAgenda.update({ where: { id: b.id }, data: { deletedAt: new Date() } });
      borrados++;
      if (b.sedeId) sedesTocadas.add(`${b.sedeId}|${b.fechaInicio.toISOString().slice(0, 10)}`);
    }
  }

  for (const key of sedesTocadas) {
    const [sedeId, fecha] = key.split('|');
    await invalidateDisponibilidadCache(sedeId, fecha).catch(() => { /* noop */ });
  }

  return { creados, actualizados, borrados };
}

/**
 * Recorre los profesionales con buzón en el tenant y reimporta su ocupación de Outlook a
 * Limablue para los próximos `dias`. No bloqueante por profesional (un fallo no corta al resto).
 */
export async function importarOcupacionOutlookTodos(dias = 30): Promise<{ profesionales: number; creados: number; actualizados: number; borrados: number }> {
  if (!outlookConfigurado()) return { profesionales: 0, creados: 0, actualizados: 0, borrados: 0 };

  const hoy0 = new Date(); hoy0.setUTCHours(0, 0, 0, 0);
  const inicioIso = hoy0.toISOString();
  const finIso = new Date(hoy0.getTime() + dias * 24 * 3600 * 1000).toISOString();

  // Candidatos: profesionales activos con emailAgenda; el resolvedor descarta los externos.
  const candidatos = await prisma.profesional.findMany({
    where: { deletedAt: null, activo: true, emailAgenda: { not: null } },
    select: { id: true, nombres: true, apellidos: true, emailAgenda: true },
  });

  let profesionales = 0, creados = 0, actualizados = 0, borrados = 0;
  for (const c of candidatos) {
    const email = emailTenantDeProfesional(c.nombres, c.apellidos, c.emailAgenda);
    if (!email) continue; // buzón externo (Gmail/Hotmail) → no se puede leer
    try {
      const r = await importarDeProfesional({ id: c.id, nombres: c.nombres, apellidos: c.apellidos, email }, inicioIso, finIso);
      profesionales++; creados += r.creados; actualizados += r.actualizados; borrados += r.borrados;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[outlook-inverso] fallo importando ${c.nombres} ${c.apellidos} (${email}):`, msg);
    }
  }
  return { profesionales, creados, actualizados, borrados };
}
