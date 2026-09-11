// Historial del podograma POR ZONA (idea del doctor: "odontograma" del pie con línea de tiempo por zona).
// Reparte todo lo registrado en las atenciones del paciente —puntos, trazos pintados, fotos,
// procedimientos y mediciones de úlcera— en las zonas fijas de utils/zonasPie.ts:
//  · puntos y trazos: por posición (zona más cercana en su vista; el trazo usa su centro);
//  · fotos, procedimientos y úlceras: por el texto de su zona/ubicación ("Talón", "borde lateral"…).
// Lo que no se puede ubicar (sin pie o sin zona reconocible) queda fuera del mapa.
import { COLOR_LESION, TIPO_LESION_LABEL, TIPO_PROCEDIMIENTO_LABEL, type HistorialPodograma, type PiePodograma, type TipoLesion, type TipoProcedimiento, type VistaSilueta } from '../api/historiaClinica';
import { coordZona, zonaMasCercana, zonaPorId, zonaPorTexto } from './zonasPie';

export type FuenteEvento = 'punto' | 'trazo' | 'foto' | 'procedimiento' | 'ulcera';
export const FUENTE_ICONO: Record<FuenteEvento, string> = { punto: 'location_on', trazo: 'brush', foto: 'photo_camera', procedimiento: 'medical_services', ulcera: 'straighten' };
export const FUENTE_LABEL: Record<FuenteEvento, string> = { punto: 'Punto', trazo: 'Dibujo', foto: 'Foto', procedimiento: 'Procedimiento', ulcera: 'Úlcera medida' };

export interface EventoZona {
  zonaId: string; vista: VistaSilueta; pie: PiePodograma;
  fecha: string; atencionId: string; profesional: string;
  fuente: FuenteEvento; tipo: TipoLesion | null; texto: string; color: string;
  x: number; y: number; fotoId?: string;
}

const piesDe = (p: string | null | undefined): PiePodograma[] =>
  (p === 'izquierdo' || p === 'derecho' ? [p] : p === 'ambos' ? ['izquierdo', 'derecho'] : []);
const centro = (pts: [number, number][]): [number, number] => {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
};
const unir = (...partes: (string | null | undefined)[]) => partes.filter((x) => x && x.trim()).join(' · ');

export function eventosPorZona(historial: HistorialPodograma[]): EventoZona[] {
  const out: EventoZona[] = [];
  for (const a of historial) {
    const base = { fecha: a.fecha.slice(0, 10), atencionId: a.atencionId, profesional: a.profesional };
    for (const m of a.marcas) {
      const vista = m.vista ?? 'plantar';
      const z = zonaMasCercana(vista, m.pie, m.x, m.y);
      out.push({ ...base, zonaId: z.id, vista, pie: m.pie, fuente: 'punto', tipo: m.tipoLesion, texto: unir(TIPO_LESION_LABEL[m.tipoLesion], m.nota), color: COLOR_LESION[m.tipoLesion], x: m.x, y: m.y });
    }
    for (const d of a.dibujos) {
      for (const t of d.anotaciones) {
        if (t.tipo !== 'trazo' || !t.puntos.length) continue;
        const [cx, cy] = centro(t.puntos);
        const z = zonaMasCercana(d.vista, d.pie, cx, cy);
        out.push({ ...base, zonaId: z.id, vista: d.vista, pie: d.pie, fuente: 'trazo', tipo: t.tipoLesion ?? null, texto: unir(t.tipoLesion ? TIPO_LESION_LABEL[t.tipoLesion] : 'Trazo sin indicar', t.nota), color: t.color, x: cx, y: cy });
      }
    }
    for (const f of a.fotos) {
      if (f.categoria === 'calzado') continue;
      const z = zonaPorTexto(f.zona);
      if (!z) continue;
      for (const pie of piesDe(f.pie)) {
        const c = coordZona(z.id, pie);
        out.push({ ...base, fecha: f.tomadaEn.slice(0, 10), zonaId: z.id, vista: z.vista, pie, fuente: 'foto', tipo: null, texto: unir(`Foto${f.zona ? `: ${f.zona}` : ''}`, f.descripcion), color: '#475569', x: c.x, y: c.y, fotoId: f.id });
      }
    }
    for (const p of a.procedimientos) {
      const z = zonaPorTexto(p.ubicacion);
      if (!z) continue;
      for (const pie of piesDe(p.pie)) {
        const c = coordZona(z.id, pie);
        out.push({ ...base, zonaId: z.id, vista: z.vista, pie, fuente: 'procedimiento', tipo: null, texto: unir(TIPO_PROCEDIMIENTO_LABEL[p.tipo as TipoProcedimiento] ?? p.nombre, p.ubicacion, p.detalle), color: '#0f766e', x: c.x, y: c.y });
      }
    }
    for (const u of a.ulceras) {
      const d = u.datos ?? {};
      const z = zonaPorTexto(typeof d.ubicacion === 'string' ? d.ubicacion : null);
      if (!z) continue;
      for (const pie of piesDe(typeof d.pie === 'string' ? d.pie : u.pie)) {
        const c = coordZona(z.id, pie);
        out.push({ ...base, zonaId: z.id, vista: z.vista, pie, fuente: 'ulcera', tipo: 'ulcera', texto: u.resultado ?? 'Úlcera medida', color: COLOR_LESION.ulcera, x: c.x, y: c.y });
      }
    }
  }
  return out;
}

export interface ResumenZona { clave: string; zonaId: string; etiqueta: string; vista: VistaSilueta; pie: PiePodograma; total: number; ultima: string; colores: string[] }
export const claveZona = (vista: VistaSilueta, pie: PiePodograma, zonaId: string) => `${vista}:${pie}:${zonaId}`;

/** Zonas con registros en una vista, de la más movida a la menos (con la fecha del último registro). */
export function resumenZonas(eventos: EventoZona[], vista: VistaSilueta): ResumenZona[] {
  const m = new Map<string, ResumenZona>();
  for (const e of eventos) {
    if (e.vista !== vista) continue;
    const k = claveZona(e.vista, e.pie, e.zonaId);
    const r = m.get(k) ?? { clave: k, zonaId: e.zonaId, etiqueta: zonaPorId(e.zonaId).etiqueta, vista: e.vista, pie: e.pie, total: 0, ultima: '', colores: [] };
    r.total++;
    if (e.fecha > r.ultima) r.ultima = e.fecha;
    if (!r.colores.includes(e.color) && r.colores.length < 4) r.colores.push(e.color);
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.total - a.total || b.ultima.localeCompare(a.ultima));
}
