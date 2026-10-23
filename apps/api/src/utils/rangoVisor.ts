// Rango de días del Visor de Pacientes (10-oct-2026): solo administración y el auditor de médicos pueden ver otros días
// o un rango. `hasta` vacío o igual a `fecha` = un solo día (lo de siempre, para todos).
import type { Request } from 'express';
import { AppError } from '../middleware/errorHandler';
import { fechaDb } from './fechaLima';
import { assertSede } from '../middleware/auth';

export const ROLES_RANGO_VISOR = ['admin', 'medico_auditor'];
const MAX_DIAS = 31;

/** Valor para `where.fecha`: un día (Date) o `{ gte, lte }`. Rechaza el rango si el rol no lo tiene. */
export function filtroFechaVisor(req: Request, fecha: string, hasta?: string | null): Date | { gte: Date; lte: Date } {
  if (!hasta || hasta === fecha) return fechaDb(fecha);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta)) throw new AppError('Fecha final inválida', 400, 'VALIDATION_ERROR');
  if (!ROLES_RANGO_VISOR.includes(req.user?.rol ?? '')) throw new AppError('Solo administración y el auditor de médicos pueden ver un rango de fechas', 403, 'SIN_PERMISO');
  if (hasta < fecha) throw new AppError('La fecha final no puede ser anterior a la inicial', 400, 'RANGO_INVALIDO');
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias > MAX_DIAS) throw new AppError(`El rango puede tener como máximo ${MAX_DIAS} días`, 400, 'RANGO_MUY_LARGO');
  return { gte: fechaDb(fecha), lte: fechaDb(hasta) };
}

/** 23-oct-2026: «Todas las sedes» en el Visor (y su Excel) — mismos roles que el rango de fechas. */
export const puedeTodasSedesVisor = (req: Request) => ROLES_RANGO_VISOR.includes(req.user?.rol ?? '');

/**
 * Sede del Visor: con `sedeId` se valida que el usuario la pueda operar y se devuelve; sin `sedeId` = todas las sedes,
 * solo para administración y el auditor de médicos (el resto debe elegir una sede).
 */
export function filtroSedeVisor(req: Request, sedeId?: string | null): string | undefined {
  if (sedeId) { assertSede(req, sedeId); return sedeId; }
  if (!puedeTodasSedesVisor(req)) throw new AppError('Elige una sede', 400, 'SEDE_REQUERIDA');
  return undefined;
}
