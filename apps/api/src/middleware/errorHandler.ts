import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

interface PrismaError extends Error { code?: string; meta?: { target?: string[] | string } }

// Mapea un choque de unicidad (P2002) al mensaje y código claros según el índice
// que lo disparó. Así "slot ocupado" o "documento duplicado" dejan de mostrarse
// como un genérico "el registro ya existe".
// `target` puede venir como nombre de índice (p.ej. "citas_slot_activo_unique") o,
// para índices crudos que Prisma sí resuelve, como las COLUMNAS ("profesionalId,fecha,
// horaInicio"). Se contemplan ambas formas. Orden importa: el slot incluye
// `profesionalId`, así que se evalúa ANTES que la asignación (solo `profesionalId`).
export function conflictoUnicidad(target: string): { error: string; message: string } {
  if (target.includes('citas_slot_activo_unique') || target.includes('horaInicio')) {
    return { error: 'SLOT_OCUPADO', message: 'Ese horario ya está ocupado para este profesional. Elige otro slot.' };
  }
  if (target.includes('pacientes_documento_unico') || target.includes('numeroDocumento')) {
    return { error: 'PACIENTE_DUPLICADO', message: 'Ya existe un paciente con ese tipo y número de documento.' };
  }
  if (target.includes('idempotency') || target.includes('idempotencyKey')) {
    return { error: 'OPERACION_DUPLICADA', message: 'Esta operación ya fue registrada (se evitó un duplicado).' };
  }
  // Historia clínica — ANTES de la rama genérica de `profesionalId` (usuarios_profesionalId_key la incluye).
  if (target.includes('atenciones_clinicas_citaId_key')) {
    return { error: 'ATENCION_YA_EXISTE', message: 'Esta cita ya tiene una atención clínica registrada.' };
  }
  if (target.includes('diagnosticos_principal_unico')) {
    return { error: 'DX_PRINCIPAL_DUPLICADO', message: 'La atención ya tiene un diagnóstico principal vigente.' };
  }
  if (target.includes('historias_clinicas_pacienteId_key')) {
    return { error: 'HC_YA_EXISTE', message: 'El paciente ya tiene historia clínica abierta.' };
  }
  if (target.includes('usuarios_profesionalId_key')) {
    return { error: 'PROFESIONAL_YA_VINCULADO', message: 'Ese profesional ya está vinculado a otro usuario.' };
  }
  if (target.includes('asignaciones_sede_una_abierta') || target.includes('profesionalId')) {
    return { error: 'CONFLICTO_ASIGNACION', message: 'El profesional ya tiene una asignación abierta. Ciérrala antes de crear otra.' };
  }
  // Aparato del consultorio (índices parciales crudos → se reconocen por NOMBRE; sus columnas
  // se repiten entre tablas, así que no se infieren por columnas).
  if (target.includes('dispositivos_consultorio_unico')) {
    return { error: 'CONSULTORIO_CON_APARATO', message: 'Ese consultorio ya tiene un aparato activo. Revócalo antes de registrar otro.' };
  }
  if (target.includes('tiempos_en_curso_consultorio_unico')) {
    return { error: 'TIEMPO_YA_EN_CURSO', message: 'Ese consultorio ya tiene un tratamiento en curso.' };
  }
  if (target.includes('tiempos_cita_vigente_unico')) {
    return { error: 'CITA_YA_TIENE_TIEMPO', message: 'Esa cita ya tiene un tiempo de tratamiento registrado.' };
  }
  if (target.includes('imagenes_podograma_vista_unica')) {
    return { error: 'IMAGEN_VISTA_DUPLICADA', message: 'Esa vista del podograma ya tiene una imagen; vuelve a intentar (se reemplaza la anterior).' };
  }
  return { error: 'CONFLICT', message: 'El registro ya existe (conflicto de unicidad)' };
}

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class CitasPendientesError extends AppError {
  constructor(
    public readonly totalCitas: number,
    public readonly sedeOrigenId: string,
  ) {
    super(`La podóloga tiene ${totalCitas} citas activas en ese período. Deben gestionarse antes de confirmar el movimiento.`, 409, 'CITAS_PENDIENTES');
    this.name = 'CitasPendientesError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err.name === 'TokenExpiredError' || err.name === 'JsonWebTokenError') {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Sesión expirada, inicia sesión nuevamente',
      statusCode: 401,
    });
    return;
  }

  if (err instanceof AppError || err.name === 'AppError' || (err as any).statusCode) {
    const statusCode = (err as any).statusCode || 400;
    res.status(statusCode).json({
      error: (err as any).code || 'APP_ERROR',
      message: err.message,
      statusCode,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      statusCode: 422,
      details: err.errors.map(e => ({
        campo: e.path.join('.'),
        mensaje: e.message,
      })),
    });
    return;
  }

  const prismaErr = err as PrismaError;
  if (prismaErr.code?.startsWith('P2')) {
    if (prismaErr.code === 'P2002') {
      const target = Array.isArray(prismaErr.meta?.target)
        ? prismaErr.meta!.target.join(',')
        : String(prismaErr.meta?.target ?? '');
      const { error, message } = conflictoUnicidad(target);
      res.status(409).json({ error, message, statusCode: 409 });
      return;
    }
    if (prismaErr.code === 'P2025') {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Registro no encontrado',
        statusCode: 404,
      });
      return;
    }
  }

  console.error('Error no manejado:', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Error interno del servidor',
    statusCode: 500,
  });
}
