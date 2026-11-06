-- Rendimiento (06-nov-2026): acelera el cálculo de «reprogramaciones» del paciente (services/alertaPaciente.ts),
-- que se ejecuta en cada carga de la agenda y en cada búsqueda de pacientes.
-- Índice PARCIAL (con WHERE): solo indexa los movimientos de cita, que son una fracción pequeña de audit_logs.
-- No está en schema.prisma (Prisma no representa índices parciales): al correr `migrate dev`, borrar de la
-- migración generada cualquier DROP INDEX de este.
CREATE INDEX IF NOT EXISTS "audit_logs_mover_cita_idx" ON "audit_logs" ("citaId") WHERE "accion" = 'mover';
