/**
 * Embudo de Ana por día (18-nov-2026, pedido del equipo del chat): cuántas personas agendaron POR ANA, cuántas vinieron /
 * no vinieron, y cuántas vinieron «de afuera» (citas que NO nacieron del chat de Ana).
 *
 * Cómo se distingue:
 *  · «Por Ana» = la cita está enlazada (`citaId`) a una `ReservaWeb` de canal «whatsapp». NO se mira el canal de la cita.
 *  · «De afuera» = cita que vino y no está enlazada a una reserva de Ana; se desglosa por el canal de la cita
 *    (recepcion = la agendó la sede, web = página /reserva, etc.).
 *  · «Vino» = llego / en_atencion / completada. «No vino» = no_show.
 *  · «Pagaron» (sábado, domingo o feriado) = `pagoEstado` aprobado o monto_distinto: así se GUARDA en la base (al chat sale
 *    «pagado»). «No pagaron» = reserva vencida sin pagar (`expirada`).
 * «Preguntaron» (conversaciones con Ana) NO está en la Agenda: sale de GHL.
 */
import { prisma } from '../db';

export const ESTADOS_VINO = ['llego', 'en_atencion', 'completada'] as const;
const PAGADA = new Set(['aprobado', 'monto_distinto']);
const LIMA_MS = 5 * 3_600_000;

export interface ReservaAna { creadoEn: Date; estado: string; pagoEstado: string | null }
export interface CitaDia { id: string; fecha: string; estado: string; canal: string }

export interface DiaEmbudo {
  fecha: string;
  /** Reservas de Ana creadas ese día (sin contar las que vencieron sin pagar). */
  agendaronPorAna: number;
  /** De sábado/domingo/feriado: pagaron / vencieron sin pagar (reservas creadas ese día). */
  pagaron: number;
  noPagaron: number;
  /** Citas de ESE día que eran de Ana. */
  anaVinieron: number;
  anaNoVinieron: number;
  /** Citas de ESE día que no nacieron del chat de Ana. */
  deAfueraVinieron: number;
  deAfueraNoVinieron: number;
  deAfueraPorCanal: Record<string, number>;
}

const diaLima = (d: Date) => new Date(d.getTime() - LIMA_MS).toISOString().slice(0, 10);

export function armarEmbudo(dias: string[], reservas: ReservaAna[], citaIdsAna: Set<string>, citas: CitaDia[]): DiaEmbudo[] {
  const por = new Map<string, DiaEmbudo>(dias.map((f) => [f, {
    fecha: f, agendaronPorAna: 0, pagaron: 0, noPagaron: 0, anaVinieron: 0, anaNoVinieron: 0,
    deAfueraVinieron: 0, deAfueraNoVinieron: 0, deAfueraPorCanal: {},
  }]));
  for (const r of reservas) {
    const d = por.get(diaLima(r.creadoEn)); if (!d) continue;
    if (r.estado === 'expirada') { d.noPagaron++; continue; }
    d.agendaronPorAna++;
    if (r.pagoEstado && PAGADA.has(r.pagoEstado)) d.pagaron++;
  }
  for (const c of citas) {
    const d = por.get(c.fecha); if (!d) continue;
    const vino = (ESTADOS_VINO as readonly string[]).includes(c.estado);
    if (citaIdsAna.has(c.id)) { if (vino) d.anaVinieron++; else d.anaNoVinieron++; continue; }
    if (vino) { d.deAfueraVinieron++; d.deAfueraPorCanal[c.canal] = (d.deAfueraPorCanal[c.canal] ?? 0) + 1; }
    else d.deAfueraNoVinieron++;
  }
  return dias.map((f) => por.get(f)!);
}

export async function embudoAna(desde: string, hasta: string, sedeId?: string) {
  const dias: string[] = [];
  for (let t = new Date(`${desde}T00:00:00.000Z`); t <= new Date(`${hasta}T00:00:00.000Z`); t = new Date(t.getTime() + 86_400_000)) dias.push(t.toISOString().slice(0, 10));
  const ini = new Date(`${desde}T00:00:00.000Z`), fin = new Date(`${hasta}T00:00:00.000Z`);
  const creadoDesde = new Date(ini.getTime() + LIMA_MS), creadoHasta = new Date(fin.getTime() + 86_400_000 + LIMA_MS);

  const [reservas, citasRaw] = await Promise.all([
    prisma.reservaWeb.findMany({
      where: { canal: 'whatsapp', creadoEn: { gte: creadoDesde, lt: creadoHasta }, ...(sedeId ? { sedeId } : {}) },
      select: { creadoEn: true, estado: true, pagoEstado: true },
    }),
    prisma.cita.findMany({
      where: { fecha: { gte: ini, lte: fin }, deletedAt: null, estado: { in: [...ESTADOS_VINO, 'no_show'] }, ...(sedeId ? { sedeId } : {}) },
      select: { id: true, fecha: true, estado: true, canal: true },
    }),
  ]);
  // Solo las reservas de Ana enlazadas a las citas del rango (no toda la tabla).
  const enlazadas = citasRaw.length
    ? await prisma.reservaWeb.findMany({ where: { canal: 'whatsapp', citaId: { in: citasRaw.map((c) => c.id) } }, select: { citaId: true } })
    : [];
  const citaIdsAna = new Set(enlazadas.map((e) => e.citaId as string));
  const citas: CitaDia[] = citasRaw.map((c) => ({ id: c.id, fecha: c.fecha.toISOString().slice(0, 10), estado: c.estado, canal: c.canal }));
  const filas = armarEmbudo(dias, reservas, citaIdsAna, citas);
  const suma = (k: 'agendaronPorAna' | 'pagaron' | 'noPagaron' | 'anaVinieron' | 'anaNoVinieron' | 'deAfueraVinieron' | 'deAfueraNoVinieron') =>
    filas.reduce((a, f) => a + f[k], 0);
  return {
    desde, hasta, sedeId: sedeId ?? null,
    nota: '«Preguntaron» no está en la Agenda: sale de GHL (conversaciones nuevas con Ana).',
    totales: {
      agendaronPorAna: suma('agendaronPorAna'), pagaron: suma('pagaron'), noPagaron: suma('noPagaron'),
      anaVinieron: suma('anaVinieron'), anaNoVinieron: suma('anaNoVinieron'),
      deAfueraVinieron: suma('deAfueraVinieron'), deAfueraNoVinieron: suma('deAfueraNoVinieron'),
    },
    dias: filas,
  };
}
