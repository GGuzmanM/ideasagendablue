// Tiempo real de la agenda SIN recargar la lista del día (23-oct-2026, rendimiento en producción).
//
// Antes, cada aviso del socket (un cambio de estado, por ejemplo) hacía que CADA pantalla abierta de la sede volviera a
// pedir ~6 consultas, incluida la lista completa de citas del día (la más pesada), y la pantalla de quien hizo el cambio
// las pedía dos veces. Ahora:
//   · La cita que llega en el aviso se aplica directamente a las listas en caché (agenda y visor): sin pedir la lista.
//   · Lo que sí hay que recargar (contadores, ocupación, disponibilidad) se agrupa: varios avisos seguidos → una recarga.
//   · Solo se recarga la lista completa cuando el aviso trae una cita que esa pantalla no tiene (p. ej. una cita nueva).
import type { QueryClient, QueryKey } from '@tanstack/react-query';

type Fila = { id: string; [k: string]: unknown };
type CitaParcial = { id: string; fecha?: string; paciente?: unknown; [k: string]: unknown };

/** Avisos cuya cita se puede aplicar tal cual a la lista (no cambian qué citas tiene la pantalla). */
export const AVISOS_PARCHABLES = new Set(['cita:estadoCambiado', 'cita:actualizada', 'cita:cancelada', 'cita:movida']);
/** Tiempo para juntar avisos seguidos en una sola recarga. */
export const ESPERA_AVISOS_MS = 400;

const CLAVES_COMPLETAS = ['citas', 'stats', 'disponibilidad', 'bloqueos-almuerzo', 'permisos-agenda', 'ocupacion-externa'];
const CLAVES_LIGERAS = ['stats', 'disponibilidad', 'ocupacion-externa'];

/** ¿La consulta es de esa sede y fecha y su clave empieza con alguno de los prefijos? */
export function esClaveDelDia(k: QueryKey, prefijos: string[], sedeId: string, fecha: string): boolean {
  return Array.isArray(k) && typeof k[0] === 'string' && prefijos.includes(k[0]) && k.includes(sedeId) && k.includes(fecha);
}

/** Una lista de citas (agenda o visor), no los demás datos que cuelgan de ['citas', …] (recetas del día, resumen clínico…). */
export function esListaDeCitas(d: unknown): d is Fila[] {
  return Array.isArray(d) && (d.length === 0 || (typeof d[0] === 'object' && d[0] !== null && 'id' in d[0] && 'estado' in d[0]));
}

/** Funde la cita nueva sobre la de la lista, conservando lo que solo trae la lista (alerta y familiares del paciente…). */
function fundir(vieja: Fila, nueva: CitaParcial): Fila {
  const pv = vieja.paciente as Record<string, unknown> | undefined;
  const pn = nueva.paciente as Record<string, unknown> | undefined;
  return { ...vieja, ...nueva, ...(pv && pn ? { paciente: { ...pv, ...pn } } : {}) };
}

/**
 * Aplica la cita a las listas de citas en caché de esa sede y fecha. Devuelve true si estaba en alguna lista.
 * Si la cita ya es de otro día (se movió), se quita de la lista del día de origen.
 */
export function parchearCita(qc: QueryClient, cita: CitaParcial, sedeId: string, fecha: string): boolean {
  let encontrada = false;
  const otroDia = typeof cita.fecha === 'string' && cita.fecha.slice(0, 10) !== fecha;
  for (const q of qc.getQueryCache().findAll({ predicate: (x) => esClaveDelDia(x.queryKey, ['citas'], sedeId, fecha) })) {
    const datos = q.state.data;
    if (!esListaDeCitas(datos)) continue;
    const i = datos.findIndex((c) => c.id === cita.id);
    if (i < 0) continue;
    encontrada = true;
    qc.setQueryData(q.queryKey, otroDia ? datos.filter((c) => c.id !== cita.id) : datos.map((c, k) => (k === i ? fundir(c, cita) : c)));
  }
  return encontrada;
}

/** Copia de las listas del día, para deshacer una actualización optimista si el servidor rechaza el cambio. */
export function copiaListasDelDia(qc: QueryClient, sedeId: string, fecha: string) {
  return qc.getQueriesData({ predicate: (x) => esClaveDelDia(x.queryKey, ['citas'], sedeId, fecha) });
}

// ── Recargas agrupadas ──────────────────────────────────────────────────────────
const pendientes = new Map<string, { sedeId: string; fecha: string; completa: boolean }>();
let temporizador: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa la recarga de lo que depende de las citas de esa sede y fecha. `completa` = también la lista de citas (la
 * pantalla no tenía la cita del aviso). Los avisos que llegan dentro de ESPERA_AVISOS_MS se juntan en una sola recarga.
 */
export function programarRecarga(qc: QueryClient, sedeId: string, fecha: string, completa: boolean): void {
  const k = `${sedeId}|${fecha}`;
  pendientes.set(k, { sedeId, fecha, completa: completa || !!pendientes.get(k)?.completa });
  if (temporizador) return;
  temporizador = setTimeout(() => {
    temporizador = null;
    const lote = [...pendientes.values()];
    pendientes.clear();
    for (const p of lote) {
      qc.invalidateQueries({
        predicate: (q) => p.completa
          ? esClaveDelDia(q.queryKey, CLAVES_COMPLETAS, p.sedeId, p.fecha)
          // Ligera: contadores, ocupación y disponibilidad, más lo que cuelga de ['citas', …] y NO es una lista de citas
          // (recetas del día y resumen clínico del visor). Las listas ya quedaron al día con el parche.
          : esClaveDelDia(q.queryKey, CLAVES_LIGERAS, p.sedeId, p.fecha)
            || (esClaveDelDia(q.queryKey, ['citas'], p.sedeId, p.fecha) && !esListaDeCitas(q.state.data)),
      });
    }
  }, ESPERA_AVISOS_MS);
}
