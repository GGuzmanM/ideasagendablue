-- 09-oct-2026: marca para excluir a un profesional de la asignación automática (solo se le agenda si se le elige).
-- Aditiva: por defecto todos siguen entrando (true). Quién queda fuera se configura desde Administración.
-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "asignacionAutomatica" BOOLEAN NOT NULL DEFAULT true;
