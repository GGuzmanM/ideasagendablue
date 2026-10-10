-- 09-oct-2026: cupo de citas simultáneas de un servicio por sede (salas/equipos). null = sin límite.
-- Aditiva: ningún servicio cambia de comportamiento hasta que se le ponga un cupo.
-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "cupoSimultaneo" INTEGER;
