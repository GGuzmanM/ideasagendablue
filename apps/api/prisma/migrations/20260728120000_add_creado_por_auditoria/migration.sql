-- Auditoría: columna 'creadoPor' (UUID del usuario que creó el registro) en las tablas de
-- datos y administración que no la tenían. Nullable y sin relación (weak FK, solo auditoría),
-- mismo patrón que asignaciones_administrativas/consumos. Aditiva: no toca índices ni datos.

-- AlterTable
ALTER TABLE "canales" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "promociones" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "sedes" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "excepciones_horario" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "unidades_negocio" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "recepcionistas" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "subcategorias_servicio" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "combinaciones_permitidas" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "configuracion_sistema" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "competencias_profesional" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "paquetes" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "paquetes_paciente" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "webhook_subscriptions" ADD COLUMN     "creadoPor" UUID;

-- AlterTable
ALTER TABLE "mail_config" ADD COLUMN     "creadoPor" UUID;

