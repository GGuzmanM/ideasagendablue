/**
 * Tratamientos de Fisioterapia (25-nov-2026): la tabla «TRATAMIENTO» de la hoja «Evaluación fisioterapéutica» de la clínica,
 * en su mismo orden (primero la columna izquierda, luego la derecha). El servidor repite esta lista
 * (apps/api/src/services/tratamientoFisio.ts): si se cambia una, cambiar la otra. Las claves se guardan: no cambiarlas.
 */
import type { Procedimiento } from '../../api/historiaClinica';

export const TRATAMIENTOS_FISIO = [
  { clave: 'compresa_caliente', nombre: 'Compresa húmeda caliente' },
  { clave: 'compresa_fria', nombre: 'Compresa fría' },
  { clave: 'terapia_manual', nombre: 'Terapia manual (hands pro, artick pro, tape y punción seca)' },
  { clave: 'ultrasonido', nombre: 'Ultrasonido' },
  { clave: 'terapia_combinada', nombre: 'Terapia combinada' },
  { clave: 'electro_analgesica', nombre: 'Electroterapia analgésica' },
  { clave: 'electro_estimulante', nombre: 'Electroterapia estimulante' },
  { clave: 'tecarterapia', nombre: 'Tecarterapia' },
  { clave: 'laser', nombre: 'Láser de alta gama' },
  { clave: 'ondas_choque', nombre: 'Ondas de choque' },
  { clave: 'magnetoterapia', nombre: 'Magnetoterapia' },
  { clave: 'presoterapia', nombre: 'Presoterapia' },
  { clave: 'pistola_percusora', nombre: 'Pistola percusora' },
  { clave: 'ejercicios', nombre: 'Programa de ejercicios terapéuticos' },
  { clave: 'reeducacion_postural', nombre: 'Reeducación postural' },
  { clave: 'descarga_muscular', nombre: 'Descarga muscular' },
] as const;
/** Tope del comentario general: lo que entra en la hoja impresa (media hoja). El servidor valida el mismo. */
export const MAX_COMENTARIO_FISIO = 500;

/** Una patología (diagnóstico CIE-10) que puede salir en la hoja impresa. */
export interface PatologiaHoja { codigo: string; descripcion: string }
/** Tope de patologías que se agregan a la hoja desde el historial (el servidor valida el mismo). */
export const MAX_PATOLOGIAS_HOJA = 10;

/**
 * Lo marcado en una atención (claves), UN comentario general de lo que se hará y las sesiones recomendadas. Y qué patologías
 * salen en la hoja impresa: por defecto los diagnósticos de la atención; `dxFuera` = los que se quitan de la hoja (siguen en la
 * historia) y `dxExtra` = las que se agregan del historial del paciente (otras atenciones, de cualquier servicio).
 */
export interface PlanFisio { marcados: string[]; comentario: string; sesiones: number | null; dxExtra: PatologiaHoja[]; dxFuera: string[] }

/** ¿Es una fila de tratamiento de fisio? (las crea su propia lista, no el formulario general de procedimientos). */
export const esTratamientoFisio = (p: Pick<Procedimiento, 'tipo'>) => p.tipo === 'fisioterapia';

/** Procedimientos de la atención → lo marcado en la lista (el comentario y las sesiones van repetidos en cada fila). */
export function planDeProcedimientos(procedimientos: Procedimiento[]): PlanFisio {
  const marcados: string[] = [];
  let sesiones: number | null = null;
  let comentario = '';
  let patologias: { incluir?: unknown; excluir?: unknown } | null = null;
  for (const p of procedimientos) {
    if (!esTratamientoFisio(p)) continue;
    const clave = typeof p.parametros?.clave === 'string' ? p.parametros.clave : null;
    if (!clave) continue;
    if (!marcados.includes(clave)) marcados.push(clave);
    if (sesiones == null && p.sesionesTotales != null) sesiones = p.sesionesTotales;
    if (!comentario && typeof p.parametros?.comentario === 'string') comentario = p.parametros.comentario;
    if (!patologias && p.parametros?.patologias && typeof p.parametros.patologias === 'object') patologias = p.parametros.patologias as { incluir?: unknown; excluir?: unknown };
  }
  const dxExtra = (Array.isArray(patologias?.incluir) ? patologias.incluir : []).flatMap((d) => {
    const x = d as Partial<PatologiaHoja> | null;
    return x && typeof x.codigo === 'string' && typeof x.descripcion === 'string' ? [{ codigo: x.codigo, descripcion: x.descripcion }] : [];
  });
  const dxFuera = (Array.isArray(patologias?.excluir) ? patologias.excluir : []).filter((c): c is string => typeof c === 'string');
  return { marcados, comentario, sesiones, dxExtra, dxFuera };
}

/**
 * Lo que se manda al servidor. El comentario, las sesiones y las patologías de la hoja viajan solo si hay algo marcado
 * (se guardan en cada tratamiento).
 */
export function planAEnvio(plan: PlanFisio): { tratamientos: string[]; comentario: string | null; sesiones: number | null; patologias: { incluir: string[]; excluir: string[] } | null } {
  const tratamientos = TRATAMIENTOS_FISIO.filter((t) => plan.marcados.includes(t.clave)).map((t) => t.clave);
  const hay = tratamientos.length > 0;
  const hayDx = plan.dxExtra.length > 0 || plan.dxFuera.length > 0;
  return {
    tratamientos, comentario: hay ? plan.comentario.trim() || null : null, sesiones: hay ? plan.sesiones : null,
    patologias: hay && hayDx ? { incluir: plan.dxExtra.map((d) => d.codigo), excluir: plan.dxFuera } : null,
  };
}

/** Las patologías que saldrán en la hoja: las de la atención menos las quitadas, más las agregadas (misma regla que el servidor). */
export function patologiasEnHoja(deLaAtencion: PatologiaHoja[], plan: Pick<PlanFisio, 'dxExtra' | 'dxFuera'>): PatologiaHoja[] {
  const lista = deLaAtencion.filter((d) => !plan.dxFuera.includes(d.codigo)).map((d) => ({ codigo: d.codigo, descripcion: d.descripcion }));
  for (const d of plan.dxExtra) if (!lista.some((x) => x.codigo === d.codigo)) lista.push(d);
  return lista;
}
