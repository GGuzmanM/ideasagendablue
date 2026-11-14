/**
 * AVISO POR WHATSAPP ~2 H ANTES DE LA CITA (13-nov-2026) — solo citas reservadas por el chat de WhatsApp (reservas_web canal «whatsapp»).
 *
 * La Agenda NO manda el mensaje: avisa a un flujo de GHL (webhook entrante) con los datos de la cita y GHL envía la plantilla.
 * Se activa con GHL_AVISO_WEBHOOK_URL en el agenda.env del servidor (la carga «Integraciones (WooCommerce y GHL).bat»; vacío = apagado).
 * Una reserva = un aviso (`reservas_web.avisoWhatsappEn`). Usa la fecha y hora ACTUALES de la cita (si se reprogramó, avisa la nueva).
 * Corre cada minuto (index.ts).
 */
import { prisma } from '../db';
import { formatoNumeroCita } from '@limablue/shared';
import { citaInicioUtc, fechaAStr, fechaDb, hoyLimaStr } from '../utils/fechaLima';

const ANTICIPACION_MIN = 120; // se avisa cuando faltan 2 h o menos
const MINIMO_MIN = 20;        // con menos de 20 min ya no tiene sentido (se da por avisada)

/** Teléfono para WhatsApp: 9 dígitos peruanos → +51…; si ya trae código de país, se respeta. */
export function telefonoE164(t: string): string {
  const d = t.replace(/\D/g, '');
  return d.length === 9 ? `+51${d}` : `+${d}`;
}

/** ¿Toca avisar? (minutos que faltan para la cita) → 'avisar' | 'esperar' | 'tarde'. */
export function momentoAviso(faltanMin: number): 'avisar' | 'esperar' | 'tarde' {
  if (faltanMin > ANTICIPACION_MIN) return 'esperar';
  return faltanMin < MINIMO_MIN ? 'tarde' : 'avisar';
}

let corriendo = false;

export async function barridoAvisosWhatsapp(): Promise<void> {
  const url = process.env.GHL_AVISO_WEBHOOK_URL?.trim();
  if (!url || corriendo) return;
  corriendo = true;
  try {
    const pendientes = await prisma.reservaWeb.findMany({
      where: { canal: 'whatsapp', estado: 'confirmada', avisoWhatsappEn: null, citaId: { not: null } },
      select: { id: true, codigo: true, citaId: true, nombres: true, telefono: true },
      take: 500,
    });
    if (!pendientes.length) return;
    const hoy = hoyLimaStr();
    const manana = fechaAStr(new Date(fechaDb(hoy).getTime() + 86_400_000));
    const citas = await prisma.cita.findMany({
      where: { id: { in: pendientes.map((r) => r.citaId!) } },
      select: {
        id: true, numero: true, estado: true, deletedAt: true, fecha: true, horaInicio: true,
        sede: { select: { nombre: true, direccion: true } }, servicio: { select: { nombre: true } },
      },
    });
    const porId = new Map(citas.map((c) => [c.id, c]));
    const ahora = Date.now();
    for (const r of pendientes) {
      const marcar = () => prisma.reservaWeb.update({ where: { id: r.id }, data: { avisoWhatsappEn: new Date() } });
      const c = porId.get(r.citaId!);
      const f = c ? fechaAStr(c.fecha) : null;
      // Cita que ya no existe, se canceló o ya pasó: no se avisa y sale de la lista.
      if (!c || c.deletedAt || !['agendada', 'confirmada'].includes(c.estado) || (f !== null && f < hoy)) { await marcar(); continue; }
      if (f !== hoy && f !== manana) continue; // todavía lejos
      const m = momentoAviso((citaInicioUtc(c.fecha, c.horaInicio).getTime() - ahora) / 60_000);
      if (m === 'esperar') continue;
      if (m === 'tarde') { await marcar(); continue; }
      try {
        const resp = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            codigo: r.codigo, numeroCita: formatoNumeroCita(c.numero), telefono: telefonoE164(r.telefono), nombres: r.nombres,
            fecha: f, hora: c.horaInicio, servicio: c.servicio?.nombre ?? '', sede: c.sede?.nombre ?? '', direccion: c.sede?.direccion ?? '',
          }),
        });
        if (resp.ok) await marcar();
        else console.warn(`[aviso-wsp] ${r.codigo}: GHL respondió ${resp.status} (se reintenta el próximo minuto)`);
      } catch (e) {
        console.warn(`[aviso-wsp] ${r.codigo}: no se pudo avisar a GHL (se reintenta):`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    corriendo = false;
  }
}
