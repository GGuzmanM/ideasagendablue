/**
 * Receta médica reservada (decisión 18-sep-2026): la ven e imprimen SOLO admin, coordinación y
 * médico (`receta_medica.ver`). Recepción sigue viendo e imprimiendo las indicaciones podológicas.
 *
 * La receta aparece en muchas respuestas (la atención completa se devuelve tras cada guardado,
 * la historia, el listado del paciente…). Para no depender de acordarse de cada ruta, el filtro va
 * a la SALIDA de los routers clínicos: a quien no tiene el permiso, toda receta médica le llega
 * sin ítems, sin indicaciones y sin código de verificación, marcada `reservada: true`. Sabe que
 * existe (para pedírsela a coordinación), pero no su contenido.
 */
import type { Request, Response, NextFunction } from 'express';

export const PERMISO_RECETA_MEDICA = 'receta_medica.ver';

const esObjetoPlano = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function esRecetaMedica(o: Record<string, unknown>): boolean {
  return o.tipoDocumento === 'RECETA_MEDICA' && 'numero' in o && ('estado' in o || 'fechaEmision' in o);
}

/** Copia del dato con las recetas médicas reducidas a su cabecera. No modifica el original. */
export function ocultarRecetasMedicas<T>(dato: T): T {
  const recorrer = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(recorrer);
    if (!esObjetoPlano(v)) return v;
    if (esRecetaMedica(v)) {
      const { items: _i, indicacionesGenerales: _g, codigoVerificacion: _c, historiaClinica: _h, ...resto } = v;
      return {
        ...resto,
        items: [],
        indicacionesGenerales: null,
        codigoVerificacion: null,
        reservada: true,
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = recorrer(x);
    return out;
  };
  return recorrer(dato) as T;
}

export const puedeVerRecetaMedica = (req: Request) => !!req.user?.permisos?.includes(PERMISO_RECETA_MEDICA);

/** Middleware de salida: envuelve res.json y filtra si el usuario no tiene el permiso. */
export function filtroRecetaMedica(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((cuerpo: unknown) => json(puedeVerRecetaMedica(req) ? cuerpo : ocultarRecetasMedicas(cuerpo))) as Response['json'];
  next();
}
