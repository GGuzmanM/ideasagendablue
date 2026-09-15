/**
 * Avisos de controles de seguimiento (2.9): la bandeja y el contador del menú ya los muestran, pero
 * nadie mira la bandeja todos los días. Dos correos, una vez al día (07:00 de Lima):
 *   1. A COORDINACIÓN (usuarias con rol coordinadora_sedes, más `CORREO_COORDINACION` si está en
 *      el .env): resumen de los controles vencidos y de los que vencen en 7 días, por sede y con la
 *      próxima cita si ya la tiene. Un correo por persona, idempotente por día (queda en la auditoría
 *      como `aviso_controles_coordinacion`).
 *   2. Al PACIENTE, 7 días antes del control (o ya vencido, una sola vez): «Le toca su control» con
 *      el motivo y el teléfono de la sede, solo si tiene correo válido y NO tiene una cita futura.
 *      Idempotente por control (`recordatorio_control_paciente` en la auditoría).
 * Todo va por el mismo canal y cuota que los correos de la agenda (emailService + mailQuota).
 */
import { prisma } from '../db';
import { enviarEmail } from './emailService';
import { esEmailEnviable, LOGO_CID } from './emailTemplates';
import { reservarCupoEnvio } from './mailQuota';
import { registrarAudit } from './audit';
import { hoyLimaStr, fechaDb, fechaAStr } from '../utils/fechaLima';
import { CLINICA } from './pdfComun';

const ORIGEN: Record<string, string> = { iwgdf: 'por riesgo del pie', indicacion: 'por indicación', manual: 'agregado a mano' };
const fmt = (ymd: string) => ymd.split('-').reverse().join('/');
const sumarDias = (ymd: string, d: number) => { const x = new Date(`${ymd}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inicio del día de hoy en Lima, en UTC (para «¿ya se envió hoy?»). */
function inicioHoyLima(): Date {
  const hoy = hoyLimaStr();
  return new Date(`${hoy}T05:00:00Z`); // 00:00 Lima = 05:00 UTC
}

async function yaEnviadoHoy(accion: string, entidadId?: string): Promise<boolean> {
  const n = await prisma.auditLog.count({ where: { accion, creadoEn: { gte: inicioHoyLima() }, ...(entidadId ? { entidadId } : {}) } });
  return n > 0;
}

function plantilla(titulo: string, cuerpo: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1f2a3d">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e8f0">
      <img src="cid:${LOGO_CID}" alt="Limablue" style="height:36px;margin-bottom:16px">
      <h1 style="font-size:20px;margin:0 0 12px;color:#003366">${esc(titulo)}</h1>
      ${cuerpo}
      <p style="font-size:12px;color:#7a8699;margin-top:24px">Limablue · clínica del pie. Este correo se genera automáticamente desde la historia clínica.</p>
    </div>
  </div></body></html>`;
}

// ─── 1 · Coordinación ─────────────────────────────────────────────────────────
async function controlesPendientes(hastaDias: number) {
  const hoy = hoyLimaStr();
  const filas = await prisma.controlSugerido.findMany({
    where: { estado: 'pendiente', fechaSugerida: { lte: fechaDb(sumarDias(hoy, hastaDias)) } },
    orderBy: [{ fechaSugerida: 'asc' }],
    take: 500,
    select: {
      id: true, pacienteId: true, sedeId: true, fechaSugerida: true, motivo: true, origen: true,
      atencion: { select: { sede: { select: { nombre: true, direccion: true } } } },
    },
  });
  const ids = [...new Set(filas.map((f) => f.pacienteId))];
  const [pacientes, citas] = ids.length
    ? await Promise.all([
        prisma.paciente.findMany({ where: { id: { in: ids } }, select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true, telefono: true, email: true, emailInvalido: true } }),
        prisma.cita.findMany({
          where: { pacienteId: { in: ids }, deletedAt: null, fecha: { gte: fechaDb(hoy) }, estado: { in: ['agendada', 'confirmada'] } },
          orderBy: [{ fecha: 'asc' }], select: { pacienteId: true, fecha: true, horaInicio: true },
        }),
      ])
    : [[], []];
  const pacPor = new Map(pacientes.map((p) => [p.id, p]));
  const citaPor = new Map<string, { fecha: Date; horaInicio: string }>();
  for (const c of citas) if (!citaPor.has(c.pacienteId)) citaPor.set(c.pacienteId, c);
  return { hoy, controles: filas.map((f) => ({ ...f, fecha: fechaAStr(f.fechaSugerida), paciente: pacPor.get(f.pacienteId) ?? null, proximaCita: citaPor.get(f.pacienteId) ?? null })) };
}

export async function enviarAvisoCoordinacion(p: { forzar?: boolean } = {}) {
  const ACCION = 'aviso_controles_coordinacion';
  if (!p.forzar && (await yaEnviadoHoy(ACCION))) return { omitido: 'ya enviado hoy', enviados: 0, controles: 0 };
  const { hoy, controles } = await controlesPendientes(7);
  const vencidos = controles.filter((c) => c.fecha < hoy);
  const proximos = controles.filter((c) => c.fecha >= hoy);
  // Destinatarias: coordinadoras activas + un correo fijo opcional del .env.
  const coordinadoras = await prisma.usuario.findMany({ where: { rol: 'coordinadora_sedes', activo: true, deletedAt: null }, select: { email: true, nombre: true } });
  const extra = (process.env.CORREO_COORDINACION ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const destinatarios = [...new Set([...coordinadoras.map((u) => u.email), ...extra].filter(esEmailEnviable))];
  if (!controles.length || !destinatarios.length) {
    await registrarAudit({ accion: ACCION, entidad: 'control_sugerido', entidadId: '00000000-0000-0000-0000-000000000000', despues: { controles: controles.length, destinatarios: destinatarios.length, enviados: 0 } });
    return { enviados: 0, controles: controles.length, destinatarios };
  }
  // Tabla por sede.
  const porSede = new Map<string, typeof controles>();
  for (const c of controles) { const k = c.atencion.sede.nombre; porSede.set(k, [...(porSede.get(k) ?? []), c]); }
  const fila = (c: (typeof controles)[number]) => {
    const pac = c.paciente ? `${c.paciente.apellidoPaterno} ${c.paciente.apellidoMaterno}, ${c.paciente.nombres}`.trim() : '—';
    const estado = c.fecha < hoy ? `<b style="color:#b42318">venció ${fmt(c.fecha)}</b>` : `vence ${fmt(c.fecha)}`;
    const cita = c.proximaCita ? `ya tiene cita el ${fmt(fechaAStr(c.proximaCita.fecha))} ${c.proximaCita.horaInicio}` : `<b>sin cita</b>${c.paciente?.telefono ? ` · ${esc(c.paciente.telefono)}` : ''}`;
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eef1f6">${esc(pac)}</td><td style="padding:6px 8px;border-bottom:1px solid #eef1f6">${esc(c.motivo)} <span style="color:#7a8699">(${ORIGEN[c.origen] ?? c.origen})</span></td><td style="padding:6px 8px;border-bottom:1px solid #eef1f6;white-space:nowrap">${estado}</td><td style="padding:6px 8px;border-bottom:1px solid #eef1f6">${cita}</td></tr>`;
  };
  const cuerpo = `
    <p style="margin:0 0 12px">Hoy ${fmt(hoy)}: <b>${vencidos.length}</b> control(es) vencido(s) y <b>${proximos.length}</b> que vencen en los próximos 7 días. Los que dicen «sin cita» hay que llamar o agendar desde <b>Bandeja clínica › Controles por agendar</b>.</p>
    ${[...porSede.entries()].map(([sede, lista]) => `
      <h2 style="font-size:15px;margin:18px 0 6px;color:#0a4b8c">${esc(sede)} · ${lista.length}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f4f6fa;text-align:left"><th style="padding:6px 8px">Paciente</th><th style="padding:6px 8px">Control</th><th style="padding:6px 8px">Fecha</th><th style="padding:6px 8px">Cita</th></tr></thead><tbody>${lista.map(fila).join('')}</tbody></table>`).join('')}`;
  const html = plantilla(`Controles de seguimiento: ${vencidos.length} vencidos, ${proximos.length} por vencer`, cuerpo);
  let enviados = 0;
  for (const to of destinatarios) {
    if (!(await reservarCupoEnvio('auto'))) break; // se agotó la cuota diaria de correos automáticos
    try {
      const r = await enviarEmail({ to, subject: `Controles de seguimiento · ${vencidos.length} vencidos · ${proximos.length} por vencer (${fmt(hoy)})`, html });
      if (r) enviados++;
    } catch (e) { console.error('[avisos-controles] correo a coordinación falló:', (e as Error).message); }
  }
  await registrarAudit({ accion: ACCION, entidad: 'control_sugerido', entidadId: '00000000-0000-0000-0000-000000000000', despues: { controles: controles.length, vencidos: vencidos.length, proximos: proximos.length, destinatarios, enviados } });
  return { enviados, controles: controles.length, vencidos: vencidos.length, proximos: proximos.length, destinatarios };
}

// ─── 2 · Paciente ─────────────────────────────────────────────────────────────
export async function enviarRecordatoriosPacientes(p: { limite?: number } = {}) {
  const ACCION = 'recordatorio_control_paciente';
  const { hoy, controles } = await controlesPendientes(7);
  let enviados = 0, omitidos = 0;
  const ventana = controles.filter((c) => c.fecha <= sumarDias(hoy, 7)).slice(0, p.limite ?? 50);
  for (const c of ventana) {
    const pac = c.paciente;
    if (!pac || pac.emailInvalido || !esEmailEnviable(pac.email) || c.proximaCita) { omitidos++; continue; }
    // Una sola vez por control (aunque siga pendiente semanas).
    if ((await prisma.auditLog.count({ where: { accion: ACCION, entidadId: c.id } })) > 0) { omitidos++; continue; }
    if (!(await reservarCupoEnvio('auto'))) break;
    const sede = c.atencion.sede;
    const cuerpo = `
      <p style="margin:0 0 12px">Hola ${esc(pac.nombres)},</p>
      <p style="margin:0 0 12px">En su última atención en Limablue le indicamos un <b>control de seguimiento</b>: <b>${esc(c.motivo)}</b>, previsto para el <b>${fmt(c.fecha)}</b>${c.fecha < hoy ? ' (ya pasó la fecha)' : ''}.</p>
      <p style="margin:0 0 12px">Todavía no tiene una cita agendada. Puede reservarla en la sede <b>${esc(sede.nombre)}</b>${sede.direccion ? ` (${esc(sede.direccion)})` : ''}${CLINICA.tel ? `, llamando al <b>${esc(CLINICA.tel)}</b>` : ''} o escribiéndonos por nuestros canales de siempre.</p>
      <p style="margin:0;color:#55617a;font-size:13px">Si ya se atendió en otro lugar o no desea continuar, puede ignorar este mensaje.</p>`;
    try {
      const r = await enviarEmail({ to: pac.email!, subject: `Le toca su control de pie en Limablue · ${fmt(c.fecha)}`, html: plantilla('Le toca su control de seguimiento', cuerpo) });
      if (r) { enviados++; await registrarAudit({ accion: ACCION, entidad: 'control_sugerido', entidadId: c.id, sedeId: c.sedeId, despues: { to: pac.email, fecha: c.fecha, motivo: c.motivo } }); }
    } catch (e) { console.error('[avisos-controles] recordatorio al paciente falló:', (e as Error).message); omitidos++; }
  }
  return { enviados, omitidos, candidatos: ventana.length };
}

// ─── Programación: todos los días a las 07:00 de Lima (con catch-up si el servidor estaba caído) ──
export function iniciarAvisosControles(): void {
  if (process.env.AVISOS_CONTROLES === 'off') { console.log('[avisos-controles] desactivado por AVISOS_CONTROLES=off'); return; }
  const tick = async () => {
    const horaLima = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', hour12: false }).format(new Date()));
    if (horaLima < 7 || horaLima >= 20) return; // solo en horario de oficina; la idempotencia evita repetir
    try {
      const c = await enviarAvisoCoordinacion();
      if (!('omitido' in c)) console.log(`[avisos-controles] coordinación: ${c.enviados} correo(s), ${c.controles} control(es)`);
      const r = await enviarRecordatoriosPacientes();
      if (r.enviados) console.log(`[avisos-controles] pacientes: ${r.enviados} recordatorio(s)`);
    } catch (e) { console.error('[avisos-controles] error:', e); }
  };
  setTimeout(() => void tick(), 40_000);
  setInterval(() => void tick(), 30 * 60_000).unref();
}
