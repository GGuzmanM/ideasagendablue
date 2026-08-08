-- AlterTable: contador de envíos reales + auditoría de envío manual
ALTER TABLE "video_envio_logs" ADD COLUMN "vecesEnviado" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "video_envio_logs" ADD COLUMN "enviadoManualPor" UUID;

-- Backfill: los que ya estaban ENVIADO cuentan como 1 envío.
UPDATE "video_envio_logs" SET "vecesEnviado" = 1 WHERE "estado" = 'ENVIADO';
