import { prisma } from '../db';

/**
 * SEGUIMIENTO AUTOMÁTICO DE SESIONES (24-nov-2026). Al agendar un servicio cuyas opciones forman una serie
 * («Sesión 1…6», «Sesion 1…12», «Curación 1…15», «Consulta 1/2», «Infiltración 1/2»), se propone la que SIGUE a la
 * última cita VIVA del paciente en ese servicio (agendada, confirmada, llegó, en atención o completada; una cancelada,
 * no show o reprogramada no cuenta: si canceló la Sesión 1, vuelve a salir la Sesión 1).
 *
 *  - Última = «X n» → «X n+1» (o la siguiente que exista). Era la última de la serie → no propone nada (paquete completo).
 *  - Última = una opción SIN número (Base, Extracción, Regular, 1ra Atención…) → la primera de la serie («Curación 1»)
 *    o, si el servicio tiene «Consecutiva», esa.
 *  - Sin historial → la primera de la serie solo si TODAS las opciones son de la serie (Sesión 1…N) o hay una «1ra…».
 *  - Solo mira los últimos 12 meses (un tratamiento de hace años no se continúa).
 * Es una SUGERENCIA: la pantalla la preselecciona y recepción puede cambiarla.
 */

export interface OpcionServicio { id: string; nombre: string }
export interface UltimaCitaServicio { subcategoriaId: string | null }
export type MotivoSesion = 'inicio' | 'siguiente' | 'paquete_completo' | 'sin_dato' | 'sin_serie';
export interface SugerenciaSesion { sugerida: OpcionServicio | null; motivo: MotivoSesion }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** «Sesión 12» → { prefijo: 'sesion', n: 12 }. Sin número al final → null. */
export function numeroDeOpcion(nombre: string): { prefijo: string; n: number } | null {
  const m = norm(nombre).match(/^(.*?)\s*(\d{1,3})$/);
  if (!m || !m[1]) return null;
  return { prefijo: m[1], n: Number(m[2]) };
}
const esConsecutiva = (nombre: string) => /^consecutiv/.test(norm(nombre));
const esPrimera = (nombre: string) => /^(1\s*(ra|ro|er|era|a|o|°|º)?\b|primer)/.test(norm(nombre)) && !numeroDeOpcion(nombre);

/** Serie principal del servicio: el prefijo numerado con más opciones (ordenado por número). */
function seriePrincipal(opciones: OpcionServicio[]): { prefijo: string; items: (OpcionServicio & { n: number })[] } | null {
  const porPrefijo = new Map<string, (OpcionServicio & { n: number })[]>();
  for (const o of opciones) {
    const num = numeroDeOpcion(o.nombre);
    if (!num) continue;
    const lista = porPrefijo.get(num.prefijo) ?? [];
    lista.push({ ...o, n: num.n });
    porPrefijo.set(num.prefijo, lista);
  }
  let mejor: { prefijo: string; items: (OpcionServicio & { n: number })[] } | null = null;
  for (const [prefijo, items] of porPrefijo) {
    if (!mejor || items.length > mejor.items.length) mejor = { prefijo, items: items.sort((a, b) => a.n - b.n) };
  }
  return mejor;
}

/** Regla pura (testeable): qué opción sigue según la última cita viva del servicio. */
export function sugerirSiguienteSesion(opciones: OpcionServicio[], ultima: UltimaCitaServicio | null): SugerenciaSesion {
  const serie = seriePrincipal(opciones);
  const consecutiva = opciones.find((o) => esConsecutiva(o.nombre)) ?? null;
  if (!serie && !consecutiva) return { sugerida: null, motivo: 'sin_serie' };
  const limpia = (o: OpcionServicio) => ({ id: o.id, nombre: o.nombre });

  if (!ultima) {
    const todasDeLaSerie = !!serie && serie.items.length === opciones.length;
    if (todasDeLaSerie) return { sugerida: limpia(serie!.items[0]), motivo: 'inicio' };
    const primera = opciones.find((o) => esPrimera(o.nombre));
    return primera ? { sugerida: limpia(primera), motivo: 'inicio' } : { sugerida: null, motivo: 'sin_serie' };
  }

  const anterior = ultima.subcategoriaId ? opciones.find((o) => o.id === ultima.subcategoriaId) : undefined;
  if (!anterior) return { sugerida: null, motivo: 'sin_dato' }; // cita sin opción o con una opción ya desactivada

  const num = numeroDeOpcion(anterior.nombre);
  if (num) {
    const mismas = opciones
      .map((o) => ({ o, x: numeroDeOpcion(o.nombre) }))
      .filter((r) => r.x && r.x.prefijo === num.prefijo && r.x.n > num.n)
      .sort((a, b) => a.x!.n - b.x!.n);
    return mismas.length ? { sugerida: limpia(mismas[0].o), motivo: 'siguiente' } : { sugerida: null, motivo: 'paquete_completo' };
  }
  if (esConsecutiva(anterior.nombre)) return { sugerida: limpia(anterior), motivo: 'siguiente' };
  if (serie) return { sugerida: limpia(serie.items[0]), motivo: 'siguiente' };
  return consecutiva ? { sugerida: limpia(consecutiva), motivo: 'siguiente' } : { sugerida: null, motivo: 'sin_serie' };
}

const ESTADOS_QUE_NO_CUENTAN = ['cancelada', 'no_show', 'reprogramada'] as const;
const VENTANA_DIAS = 365;

export async function siguienteSesion(pacienteId: string, servicioId: string) {
  const opciones = await prisma.subcategoriaServicio.findMany({
    where: { servicioId, activo: true, deletedAt: null },
    select: { id: true, nombre: true },
  });
  if (!opciones.length) return { sugerida: null, motivo: 'sin_serie' as MotivoSesion, ultima: null };
  const desde = new Date(Date.now() - VENTANA_DIAS * 86_400_000);
  const ultimaCita = await prisma.cita.findFirst({
    where: {
      pacienteId, servicioId, deletedAt: null,
      estado: { notIn: [...ESTADOS_QUE_NO_CUENTAN] },
      fecha: { gte: new Date(Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), desde.getUTCDate())) },
    },
    orderBy: [{ fecha: 'desc' }, { horaInicio: 'desc' }, { creadoEn: 'desc' }],
    select: { id: true, fecha: true, horaInicio: true, estado: true, subcategoriaId: true, subcategoria: { select: { nombre: true } } },
  });
  const r = sugerirSiguienteSesion(opciones, ultimaCita ? { subcategoriaId: ultimaCita.subcategoriaId } : null);
  return {
    ...r,
    ultima: ultimaCita ? {
      fecha: ultimaCita.fecha.toISOString().slice(0, 10),
      horaInicio: ultimaCita.horaInicio,
      estado: ultimaCita.estado,
      opcion: ultimaCita.subcategoria?.nombre ?? null,
    } : null,
  };
}
