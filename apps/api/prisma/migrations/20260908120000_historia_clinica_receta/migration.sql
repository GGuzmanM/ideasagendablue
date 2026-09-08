-- CreateEnum
CREATE TYPE "EstadoHC" AS ENUM ('activa', 'pasiva');

-- CreateEnum
CREATE TYPE "EstadoAtencion" AS ENUM ('abierta', 'cerrada');

-- CreateEnum
CREATE TYPE "TipoNota" AS ENUM ('evolucion', 'procedimiento', 'indicacion', 'observacion');

-- CreateEnum
CREATE TYPE "TipoDiagnostico" AS ENUM ('presuntivo', 'definitivo');

-- CreateEnum
CREATE TYPE "TipoAntecedente" AS ENUM ('patologico', 'quirurgico', 'familiar', 'farmacologico', 'habito', 'otro');

-- CreateEnum
CREATE TYPE "SeveridadAlergia" AS ENUM ('leve', 'moderada', 'severa');

-- CreateEnum
CREATE TYPE "EstadoReceta" AS ENUM ('emitida', 'anulada');

-- CreateEnum
CREATE TYPE "TipoDocumentoReceta" AS ENUM ('RECETA_MEDICA', 'INDICACIONES_PODOLOGICAS');

-- CreateEnum
CREATE TYPE "TipoItemReceta" AS ENUM ('MEDICAMENTO_RX', 'MEDICAMENTO_OTC', 'PRODUCTO', 'SERVICIO');

-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "esEquipo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "profesionalId" UUID;

-- AlterTable
ALTER TABLE "medicamentos" ADD COLUMN     "esProducto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "posologiaSugerida" TEXT,
ADD COLUMN     "requiereReceta" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "historias_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero" SERIAL NOT NULL,
    "pacienteId" UUID NOT NULL,
    "fechaApertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sedeAperturaId" UUID,
    "estado" "EstadoHC" NOT NULL DEFAULT 'activa',
    "creadoPorUsuarioId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historias_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atenciones_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "historiaClinicaId" UUID NOT NULL,
    "citaId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "profesionalId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "servicioId" UUID NOT NULL,
    "subcategoriaId" UUID,
    "fecha" DATE NOT NULL,
    "motivoConsulta" TEXT NOT NULL,
    "estado" "EstadoAtencion" NOT NULL DEFAULT 'abierta',
    "abiertaPorUsuarioId" UUID,
    "abiertaEtiqueta" TEXT,
    "cerradaEn" TIMESTAMP(3),
    "cerradaPorUsuarioId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "atenciones_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_evolucion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "tipo" "TipoNota" NOT NULL DEFAULT 'evolucion',
    "subjetivo" TEXT,
    "objetivo" TEXT,
    "apreciacion" TEXT,
    "plan" TEXT,
    "texto" TEXT,
    "profesionalId" UUID,
    "autorUsuarioId" UUID,
    "autorEtiqueta" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editadaEn" TIMESTAMP(3),
    "editadaPorUsuarioId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedPorUsuarioId" UUID,

    CONSTRAINT "notas_evolucion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_evolucion_versiones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notaId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "contenido" JSONB NOT NULL,
    "guardadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guardadoPorUsuarioId" UUID,
    "guardadoEtiqueta" TEXT,

    CONSTRAINT "notas_evolucion_versiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosticos_atencion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "atencionId" UUID NOT NULL,
    "cie10Codigo" TEXT NOT NULL,
    "tipo" "TipoDiagnostico" NOT NULL DEFAULT 'presuntivo',
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "observacion" TEXT,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "diagnosticos_atencion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "antecedentes_paciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "historiaClinicaId" UUID NOT NULL,
    "tipo" "TipoAntecedente" NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "antecedentes_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alergias_paciente" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "historiaClinicaId" UUID NOT NULL,
    "sustancia" TEXT NOT NULL,
    "reaccion" TEXT,
    "severidad" "SeveridadAlergia" NOT NULL DEFAULT 'moderada',
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "registradoPorUsuarioId" UUID,
    "registradoEtiqueta" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "alergias_paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recetas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "numero" SERIAL NOT NULL,
    "tipoDocumento" "TipoDocumentoReceta" NOT NULL DEFAULT 'RECETA_MEDICA',
    "atencionId" UUID NOT NULL,
    "historiaClinicaId" UUID NOT NULL,
    "pacienteId" UUID NOT NULL,
    "sedeId" UUID NOT NULL,
    "emisorProfesionalId" UUID NOT NULL,
    "emisorUsuarioId" UUID,
    "emisorNombre" TEXT NOT NULL,
    "emisorRegistro" TEXT,
    "indicacionesGenerales" TEXT,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigenciaDias" INTEGER,
    "estado" "EstadoReceta" NOT NULL DEFAULT 'emitida',
    "codigoVerificacion" TEXT NOT NULL,
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorUsuarioId" UUID,
    "motivoAnulacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receta_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recetaId" UUID NOT NULL,
    "tipo" "TipoItemReceta" NOT NULL DEFAULT 'MEDICAMENTO_OTC',
    "diagnosticoCie10Codigo" TEXT,
    "medicamentoId" TEXT,
    "servicioId" UUID,
    "nombre" TEXT NOT NULL,
    "marcaImpresa" TEXT,
    "concentracionSnapshot" TEXT,
    "formaSnapshot" TEXT,
    "dosis" TEXT,
    "via" TEXT,
    "frecuencia" TEXT,
    "duracion" TEXT,
    "cantidad" TEXT,
    "indicaciones" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receta_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "historias_clinicas_numero_key" ON "historias_clinicas"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "historias_clinicas_pacienteId_key" ON "historias_clinicas"("pacienteId");

-- CreateIndex
CREATE UNIQUE INDEX "atenciones_clinicas_citaId_key" ON "atenciones_clinicas"("citaId");

-- CreateIndex
CREATE INDEX "atenciones_clinicas_historiaClinicaId_fecha_idx" ON "atenciones_clinicas"("historiaClinicaId", "fecha");

-- CreateIndex
CREATE INDEX "atenciones_clinicas_pacienteId_idx" ON "atenciones_clinicas"("pacienteId");

-- CreateIndex
CREATE INDEX "atenciones_clinicas_profesionalId_fecha_idx" ON "atenciones_clinicas"("profesionalId", "fecha");

-- CreateIndex
CREATE INDEX "notas_evolucion_atencionId_creadoEn_idx" ON "notas_evolucion"("atencionId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "notas_evolucion_versiones_notaId_version_key" ON "notas_evolucion_versiones"("notaId", "version");

-- CreateIndex
CREATE INDEX "diagnosticos_atencion_atencionId_idx" ON "diagnosticos_atencion"("atencionId");

-- CreateIndex
CREATE INDEX "antecedentes_paciente_historiaClinicaId_idx" ON "antecedentes_paciente"("historiaClinicaId");

-- CreateIndex
CREATE INDEX "alergias_paciente_historiaClinicaId_idx" ON "alergias_paciente"("historiaClinicaId");

-- CreateIndex
CREATE UNIQUE INDEX "recetas_numero_key" ON "recetas"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "recetas_codigoVerificacion_key" ON "recetas"("codigoVerificacion");

-- CreateIndex
CREATE INDEX "recetas_pacienteId_fechaEmision_idx" ON "recetas"("pacienteId", "fechaEmision");

-- CreateIndex
CREATE INDEX "recetas_atencionId_idx" ON "recetas"("atencionId");

-- CreateIndex
CREATE INDEX "receta_items_recetaId_idx" ON "receta_items"("recetaId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_profesionalId_key" ON "usuarios"("profesionalId");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historias_clinicas" ADD CONSTRAINT "historias_clinicas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "citas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atenciones_clinicas" ADD CONSTRAINT "atenciones_clinicas_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_evolucion" ADD CONSTRAINT "notas_evolucion_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_evolucion" ADD CONSTRAINT "notas_evolucion_profesionalId_fkey" FOREIGN KEY ("profesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_evolucion_versiones" ADD CONSTRAINT "notas_evolucion_versiones_notaId_fkey" FOREIGN KEY ("notaId") REFERENCES "notas_evolucion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosticos_atencion" ADD CONSTRAINT "diagnosticos_atencion_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosticos_atencion" ADD CONSTRAINT "diagnosticos_atencion_cie10Codigo_fkey" FOREIGN KEY ("cie10Codigo") REFERENCES "cie10"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "antecedentes_paciente" ADD CONSTRAINT "antecedentes_paciente_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alergias_paciente" ADD CONSTRAINT "alergias_paciente_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_atencionId_fkey" FOREIGN KEY ("atencionId") REFERENCES "atenciones_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_historiaClinicaId_fkey" FOREIGN KEY ("historiaClinicaId") REFERENCES "historias_clinicas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recetas" ADD CONSTRAINT "recetas_emisorProfesionalId_fkey" FOREIGN KEY ("emisorProfesionalId") REFERENCES "profesionales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_items" ADD CONSTRAINT "receta_items_recetaId_fkey" FOREIGN KEY ("recetaId") REFERENCES "recetas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_items" ADD CONSTRAINT "receta_items_diagnosticoCie10Codigo_fkey" FOREIGN KEY ("diagnosticoCie10Codigo") REFERENCES "cie10"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_items" ADD CONSTRAINT "receta_items_medicamentoId_fkey" FOREIGN KEY ("medicamentoId") REFERENCES "medicamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receta_items" ADD CONSTRAINT "receta_items_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "servicios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Máx 1 diagnóstico PRINCIPAL vigente por atención: índice único PARCIAL (no representable en
-- schema.prisma; inventariado en CLAUDE.md junto a los demás índices crudos).
CREATE UNIQUE INDEX IF NOT EXISTS "diagnosticos_principal_unico"
  ON "diagnosticos_atencion" ("atencionId")
  WHERE principal = true AND "deletedAt" IS NULL;
