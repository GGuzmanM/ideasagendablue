import { api } from './client';

export type TipoPromocion = 'PRECIO_FIJO' | 'PORCENTAJE' | 'MONTO_DESCUENTO' | 'OTRO';

// Promo que CALIFICA para un contexto (servicio+sede+fecha+canal+paciente).
export interface PromocionElegible {
  id: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoPromocion;
  valor: number | null;
  requiereCodigo: boolean;
}

export interface ContextoPromoQuery {
  servicio: string;
  sede: string;
  fecha: string; // YYYY-MM-DD
  canal?: string;
  paciente?: string;
}

/** Aplica una promo a un precio de lista (misma fórmula que el backend). Nunca negativo. */
export function calcularConPromo(precioLista: number, tipo: TipoPromocion, valor: number | null): { descuento: number; final: number } {
  const base = Math.max(0, Number(precioLista) || 0);
  const v = Number(valor ?? 0);
  let fin = base;
  if (tipo === 'PORCENTAJE') fin = base * (1 - v / 100);
  else if (tipo === 'MONTO_DESCUENTO') fin = base - v;
  else if (tipo === 'PRECIO_FIJO') fin = v;
  fin = Math.max(0, Math.round(fin * 100) / 100);
  return { descuento: Math.max(0, Math.round((base - fin) * 100) / 100), final: fin };
}

// Restricciones configurables (Fase 2). null = sin restricción (aplica a todo).
export interface RestriccionesPromo {
  serviciosIds?: string[] | null;
  sedesIds?: string[] | null;
  canales?: string[] | null;
  vigenciaInicio?: string | null; // YYYY-MM-DD
  vigenciaFin?: string | null;
  diasSemana?: number[] | null; // 0=Dom..6=Sáb
  codigo?: string | null;
  soloPacientesNuevos?: boolean;
  cupoTotal?: number | null;
  limitePorPaciente?: number | null;
}

export interface Promocion extends RestriccionesPromo {
  id: string;
  nombre: string;
  descripcion?: string | null;
  tipo: TipoPromocion;
  valor: number | null;
  activo?: boolean;
  orden?: number;
  enUso?: number;
}

export interface CrearPromocionInput extends RestriccionesPromo {
  nombre: string;
  descripcion?: string;
  tipo: TipoPromocion;
  valor?: number | null;
}

// Formato compartido del valor de una promo (drawer/popover/herramientas/analytics):
// PRECIO_FIJO → "S/ N"; PORCENTAJE → "N%"; OTRO/null → "—". Una sola fuente para no divergir.
export function formatPromoValor(tipo: TipoPromocion, valor: number | null | undefined): string {
  const n = valor == null ? null : Number(valor);
  const s = (x: number) => (x % 1 === 0 ? String(x) : x.toFixed(2));
  if (tipo === 'PRECIO_FIJO' && n != null) return `S/ ${s(n)} (precio final)`;
  if (tipo === 'PORCENTAJE' && n != null) return `${n}% dscto`;
  if (tipo === 'MONTO_DESCUENTO' && n != null) return `− S/ ${s(n)} dscto`;
  return '—';
}

export interface ReporteFilaPromo {
  promocionId: string;
  nombre: string;
  tipo: TipoPromocion | null;
  valor: number | null;
  activo: boolean;
  usos: number;
  descontado: number;
  facturado: number;
  precioLista: number;
}
export interface ReporteUsoPromos {
  porPromo: ReporteFilaPromo[];
  totales: { usos: number; descontado: number; facturado: number; precioLista: number };
  desde: string;
  hasta: string;
}

export const promocionesApi = {
  activas: () => api.get<Promocion[]>('/promociones'),
  todas: () => api.get<Promocion[]>('/promociones/todas'),
  reporte: (params: { desde: string; hasta: string; sede?: string }) => {
    const qs = new URLSearchParams({ desde: params.desde, hasta: params.hasta });
    if (params.sede) qs.set('sede', params.sede);
    return api.get<ReporteUsoPromos>(`/promociones/reporte?${qs.toString()}`);
  },
  elegibles: (ctx: ContextoPromoQuery) => {
    const qs = new URLSearchParams({ servicio: ctx.servicio, sede: ctx.sede, fecha: ctx.fecha });
    if (ctx.canal) qs.set('canal', ctx.canal);
    if (ctx.paciente) qs.set('paciente', ctx.paciente);
    return api.get<PromocionElegible[]>(`/promociones/elegibles?${qs.toString()}`);
  },
  crear: (data: CrearPromocionInput) => api.post<Promocion>('/promociones', data),
  actualizar: (id: string, data: Partial<{ nombre: string; descripcion: string | null; tipo: TipoPromocion; valor: number | null; activo: boolean; orden: number } & RestriccionesPromo>) =>
    api.patch<Promocion>(`/promociones/${id}`, data),
  eliminar: (id: string) =>
    api.delete<{ ok: boolean; desactivado?: boolean; eliminado?: boolean; enUso?: number }>(`/promociones/${id}`),
};
