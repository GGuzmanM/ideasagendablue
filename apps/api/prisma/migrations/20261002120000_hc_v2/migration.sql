-- HC v2 (02-oct-2026): «Niega» por tipo, notas para doctores, consentimiento por foto, rol médico auditor.
-- Estructura solo aditiva + datos idempotentes.
-- AlterTable
ALTER TABLE "consentimientos_informados" ADD COLUMN     "archivoMime" TEXT,
ADD COLUMN     "archivoRuta" TEXT,
ADD COLUMN     "archivoTamano" INTEGER;

-- CreateTable
CREATE TABLE "negaciones_hc" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "historiaClinicaId" UUID NOT NULL,
    "categoria" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negaciones_hc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_medico_paciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "historiaClinicaId" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "autorUsuarioId" UUID,
    "autorEtiqueta" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedPorUsuarioId" UUID,

    CONSTRAINT "notas_medico_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "negaciones_hc_historiaClinicaId_categoria_key" ON "negaciones_hc"("historiaClinicaId", "categoria");

-- CreateIndex
CREATE INDEX "notas_medico_paciente_historiaClinicaId_creadoEn_idx" ON "notas_medico_paciente"("historiaClinicaId", "creadoEn");

-- AddForeignKey
ALTER TABLE "negaciones_hc" ADD CONSTRAINT "negaciones_hc_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_medico_paciente" ADD CONSTRAINT "notas_medico_paciente_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── DATOS (idempotente) ─────────────────────────────────────────────────────────────────────────
-- Permiso nuevo «receta.favoritas.gestionar»: crear y borrar recetas FAVORITAS (los demás solo las usan).
-- TRANSICIÓN (02-oct-2026): mientras el usuario valida los cambios, lo tienen todos los roles que HOY pueden guardar
-- favoritas (los que tienen hc.registrar), para que nadie note el cambio. Al aprobarse se deja solo en admin y
-- medico_auditor (script aparte).
UPDATE roles SET permisos = array_append(permisos, 'receta.favoritas.gestionar'), "actualizadoEn" = now()
WHERE ('hc.registrar' = ANY(permisos) OR nombre = 'admin') AND NOT ('receta.favoritas.gestionar' = ANY(permisos));

-- Rol «Médico auditor»: todo lo del médico + estandariza las recetas favoritas (Dr. Adrián Rojas Gálvez).
INSERT INTO roles (id, nombre, label, descripcion, permisos, "esSistema", "creadoEn", "actualizadoEn")
SELECT gen_random_uuid(), 'medico_auditor', 'Médico auditor',
       'Médico colegiado que además estandariza las recetas favoritas',
       ARRAY['citas.ver','pacientes.ver','membresias.ver','hc.ver','hc.registrar','receta.ver',
             'receta_medica.ver','receta.emitir','medico.autoasignar','receta.favoritas.gestionar'],
       false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE nombre = 'medico_auditor');
