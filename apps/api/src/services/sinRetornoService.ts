/**
 * Pacientes SIN RETORNO (18-nov-2026): pacientes que se atendieron (llegó / en atención / completada) y no volvieron a agendar.
 * Se agrupan por días desde su última atención: 1-7, 8-14, 15-21, 22-31 y más de 31, por servicio y por sede de esa última cita.
 *
 *  · «Agendó de nuevo» = tiene otra cita POSTERIOR (futura incluida) que no está cancelada ni reprogramada (un no_show cuenta como agendó).
 *  · Solo mira atenciones de los últimos `dias` días (por defecto 90); quien se atendió hoy va aparte en «recienAtendidos».
 *  · Los rangos se calculan con el día de Lima.
 */
import { prisma } from '../db';
import { ESTADOS_VINO } from './embudoAnaService';

export const RANGOS = ['1-7', '8-14', '15-21', '22-31', '32+'] as const;
export type Rango = (typeof RANGOS)[number];

export interface UltimaAtencion { pacienteId: string; fecha: string; servicioId: string; sedeId: string }

export function rangoDe(dias: number): Rango | null {
  if (dias < 1) return null;
  if (dias <= 7) return '1-7';
  if (dias <= 14) return '8-14';
  if (dias <= 21) return '15-21';
  if (dias <= 31) return '22-31';
  return '32+';
}

const dif = (hoy: string, f: string) => Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${f}T00:00:00Z`)) / 86_400_000);

export interface ResumenRetorno { sinRetorno: number; retornaron: number }
export function armarSinRetorno(hoy: string, ultimas: UltimaAtencion[], conCitaPosterior: Set<string>) {
  const porRango: Record<Rango, ResumenRetorno> = Object.fromEntries(RANGOS.map((r) => [r, { sinRetorno: 0, retornaron: 0 }])) as Record<Rango, ResumenRetorno>;
  const porServicio = new Map<string, Record<Rango, number>>();
  const porSede = new Map<string, Record<Rango, number>>();
  let recienAtendidos = 0;
  const vacio = () => Object.fromEntries(RANGOS.map((r) => [r, 0])) as Record<Rango, number>;
  for (const u of ultimas) {
    const rango = rangoDe(dif(hoy, u.fecha));
    if (!rango) { recienAtendidos++; continue; }
    if (conCitaPosterior.has(u.pacienteId)) { porRango[rango].retornaron++; continue; }
    porRango[rango].sinRetorno++;
    (porServicio.get(u.servicioId) ?? porServicio.set(u.servicioId, vacio()).get(u.servicioId)!)[rango]++;
    (porSede.get(u.sedeId) ?? porSede.set(u.sedeId, vacio()).get(u.sedeId)!)[rango]++;
  }
  return { recienAtendidos, porRango, porServicio, porSede };
}

const diaLima = (d: Date) => new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

export async function sinRetorno(dias: number, sedeId?: string) {
  const hoy = diaLima(new Date());
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000);
  const hoyDate = new Date(`${hoy}T00:00:00.000Z`);
  const atendidas = await prisma.cita.findMany({
    where: { fecha: { gte: desde, lte: hoyDate }, deletedAt: null, estado: { in: [...ESTADOS_VINO] }, ...(sedeId ? { sedeId } : {}) },
    select: { pacienteId: true, fecha: true, servicioId: true, sedeId: true },
    orderBy: { fecha: 'desc' },
  });
  // Última atención de cada paciente (ya vienen de la más reciente a la más antigua).
  const ultima = new Map<string, UltimaAtencion>();
  for (const c of atendidas) if (!ultima.has(c.pacienteId)) ultima.set(c.pacienteId, { pacienteId: c.pacienteId, fecha: c.fecha.toISOString().slice(0, 10), servicioId: c.servicioId, sedeId: c.sedeId });
  const ultimas = [...ultima.values()];

  // ¿Tiene otra cita posterior a esa atención? Se mira por trozos para no armar una consulta gigante.
  const conPosterior = new Set<string>();
  const ids = ultimas.map((u) => u.pacienteId);
  for (let i = 0; i < ids.length; i += 2000) {
    const trozo = ids.slice(i, i + 2000);
    const filas = await prisma.cita.groupBy({
      by: ['pacienteId'],
      where: { pacienteId: { in: trozo }, fecha: { gt: desde }, deletedAt: null, estado: { notIn: ['cancelada', 'reprogramada'] } },
      _max: { fecha: true },
    });
    for (const f of filas) {
      const u = ultima.get(f.pacienteId);
      if (u && f._max.fecha && f._max.fecha.toISOString().slice(0, 10) > u.fecha) conPosterior.add(f.pacienteId);
    }
  }

  const r = armarSinRetorno(hoy, ultimas, conPosterior);
  const [servicios, sedes] = await Promise.all([
    prisma.servicio.findMany({ where: { id: { in: [...r.porServicio.keys()] } }, select: { id: true, nombre: true } }),
    prisma.sede.findMany({ where: { id: { in: [...r.porSede.keys()] } }, select: { id: true, nombre: true } }),
  ]);
  const nombre = (lista: { id: string; nombre: string }[], id: string) => lista.find((x) => x.id === id)?.nombre ?? id;
  const total = (m: Record<Rango, number>) => RANGOS.reduce((a, k) => a + m[k], 0);
  return {
    hoy, dias, sedeId: sedeId ?? null,
    nota: 'Sin retorno = se atendió y no tiene otra cita posterior (cancelada o reprogramada no cuenta). Rangos en días desde su última atención.',
    pacientesAtendidos: ultimas.length,
    recienAtendidos: r.recienAtendidos,
    rangos: RANGOS.map((k) => ({ rango: k, ...r.porRango[k] })),
    porServicio: [...r.porServicio].map(([id, m]) => ({ servicio: nombre(servicios, id), total: total(m), ...m })).sort((a, b) => b.total - a.total),
    porSede: [...r.porSede].map(([id, m]) => ({ sede: nombre(sedes, id), total: total(m), ...m })).sort((a, b) => b.total - a.total),
  };
}
