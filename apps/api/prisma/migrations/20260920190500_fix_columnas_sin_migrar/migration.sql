-- Corrige 4 columnas que existen en schema.prisma pero JAMÁS tuvieron migración
-- (quedaron "en drift" desde los commits 1aee842e, 0c310446 y 7c59f29a). Sin esta
-- migración, cualquier BD levantada con `prisma migrate deploy` falla con P2022
-- ("column ... does not exist") en cuanto una ruta hace un SELECT sin `select`
-- explícito sobre estos modelos — en producción rompe, como mínimo:
--   • GET /api/v1/profesionales      (columnas de doctores en la Agenda)
--   • GET /api/v1/almuerzos          (franjas de almuerzo en la Agenda)
--   • GET /api/v1/permisos           (franjas de permiso/vacaciones/enfermedad)
--   • GET /api/v1/pacientes/:id      (ficha de CUALQUIER paciente)
--   • GET/POST/PATCH /api/v1/combinaciones (Administración > Combinables)
-- Ver informe de auditoría de la Agenda (2026-09-20) para el detalle de cada caso.

-- Profesional.colegiatura (commit 0c310446, 2026-08-01)
ALTER TABLE "profesionales" ADD COLUMN IF NOT EXISTS "colegiatura" TEXT;

-- BloqueoAgenda.esEnfermedad (commit 7c59f29a, 2026-09-08)
ALTER TABLE "bloqueos_agenda" ADD COLUMN IF NOT EXISTS "esEnfermedad" BOOLEAN NOT NULL DEFAULT false;

-- Paciente.canalId (commit 1aee842e, 2026-07-30)
ALTER TABLE "pacientes" ADD COLUMN IF NOT EXISTS "canalId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pacientes_canalId_fkey'
  ) THEN
    ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_canalId_fkey"
      FOREIGN KEY ("canalId") REFERENCES "canales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "pacientes_canalId_idx" ON "pacientes"("canalId");

-- CombinacionPermitida.servicioAnclaId (commit 7c59f29a, 2026-09-08)
ALTER TABLE "combinaciones_permitidas" ADD COLUMN IF NOT EXISTS "servicioAnclaId" UUID;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'combinaciones_permitidas_servicioAnclaId_fkey'
  ) THEN
    ALTER TABLE "combinaciones_permitidas" ADD CONSTRAINT "combinaciones_permitidas_servicioAnclaId_fkey"
      FOREIGN KEY ("servicioAnclaId") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "combinaciones_permitidas_servicioAnclaId_servicioExtraId_idx"
  ON "combinaciones_permitidas"("servicioAnclaId", "servicioExtraId");
