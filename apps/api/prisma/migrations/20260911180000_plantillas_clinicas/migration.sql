-- CreateTable
CREATE TABLE "plantillas_clinicas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tipo" TEXT NOT NULL,
    "clave" TEXT,
    "nombre" TEXT NOT NULL,
    "contenido" JSONB NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorUsuarioId" UUID,
    "creadoEtiqueta" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plantillas_clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plantillas_clinicas_tipo_clave_idx" ON "plantillas_clinicas"("tipo", "clave");


-- Plantillas de MUESTRA (el doctor las edita o las quita desde la historia clínica). Datos, no estructura:
-- se insertan una sola vez con esta migración; si se borran (deletedAt) no vuelven a aparecer.
INSERT INTO "plantillas_clinicas" ("tipo", "clave", "nombre", "contenido", "creadoEtiqueta", "actualizadoEn") VALUES
('nota', 'L60.0', 'Onicocriptosis (muestra)', jsonb_build_object(
  'subjetivo', $t$Paciente refiere dolor en el borde de la uña del primer dedo, que aumenta con el calzado cerrado.$t$,
  'objetivo', $t$Uña del hallux con borde encarnado, eritema y edema periungueal. Sin secreción purulenta. Pulsos pedios presentes.$t$,
  'apreciacion', $t$Onicocriptosis estadio 1–2, sin signos de infección sistémica.$t$,
  'plan', $t$Espiculectomía y curación. Control en 7 días.
Indicaciones: lavado diario con agua y jabón, calzado amplio, no manipular la uña.$t$), 'Plantilla de muestra', now()),
('nota', 'B35.1', 'Onicomicosis (muestra)', jsonb_build_object(
  'subjetivo', $t$Paciente refiere engrosamiento y cambio de color de las uñas de varios meses de evolución, sin dolor.$t$,
  'objetivo', $t$Uñas engrosadas, amarillentas, con hiperqueratosis subungueal. Lecho ungueal íntegro.$t$,
  'apreciacion', $t$Onicomicosis distal subungueal.$t$,
  'plan', $t$Fresado ungueal y antifúngico tópico según indicación médica. Control mensual hasta crecimiento sano.
Indicaciones: secar bien entre los dedos, no compartir calzado ni cortaúñas.$t$), 'Plantilla de muestra', now()),
('nota', 'L84', 'Hiperqueratosis / heloma (muestra)', jsonb_build_object(
  'subjetivo', $t$Paciente refiere dolor al caminar en zona de apoyo del antepié.$t$,
  'objetivo', $t$Hiperqueratosis plantar en cabeza de metatarsianos, con núcleo central (heloma). Sin fisuras ni sangrado.$t$,
  'apreciacion', $t$Heloma por sobrecarga mecánica.$t$,
  'plan', $t$Deslaminación y enucleación del heloma. Evaluar plantilla de descarga. Control en 30 días.
Indicaciones: calzado con suela amortiguada, hidratación diaria de la planta.$t$), 'Plantilla de muestra', now()),
('nota', 'L97', 'Úlcera de pie diabético (muestra)', jsonb_build_object(
  'subjetivo', $t$Paciente diabético refiere lesión plantar de varias semanas, sin dolor (hipoestesia).$t$,
  'objetivo', $t$Úlcera plantar de bordes hiperqueratósicos, fondo granulante, sin exposición ósea. Monofilamento alterado. Pulsos presentes.$t$,
  'apreciacion', $t$Úlcera neuropática, Wagner 1. Riesgo IWGDF alto.$t$,
  'plan', $t$Debridamiento, curación y descarga. Medición de la úlcera en cada visita. Control en 7 días.
Indicaciones: no apoyar la zona, revisar los pies a diario, control glicémico con su médico.$t$), 'Plantilla de muestra', now()),
('autotexto', '.oc', 'onicocriptosis', jsonb_build_object('texto', 'onicocriptosis'), 'Autotexto de muestra', now()),
('autotexto', '.om', 'onicomicosis', jsonb_build_object('texto', 'onicomicosis'), 'Autotexto de muestra', now()),
('autotexto', '.hq', 'hiperqueratosis', jsonb_build_object('texto', 'hiperqueratosis'), 'Autotexto de muestra', now()),
('autotexto', '.pd', 'pie diabético', jsonb_build_object('texto', 'pie diabético'), 'Autotexto de muestra', now()),
('autotexto', '.izq', 'pie izquierdo', jsonb_build_object('texto', 'pie izquierdo'), 'Autotexto de muestra', now()),
('autotexto', '.der', 'pie derecho', jsonb_build_object('texto', 'pie derecho'), 'Autotexto de muestra', now()),
('autotexto', '.ap', 'ambos pies', jsonb_build_object('texto', 'ambos pies'), 'Autotexto de muestra', now()),
('autotexto', '.bm', 'borde medial', jsonb_build_object('texto', 'borde medial'), 'Autotexto de muestra', now()),
('autotexto', '.bl', 'borde lateral', jsonb_build_object('texto', 'borde lateral'), 'Autotexto de muestra', now()),
('autotexto', '.pp', 'pulsos presentes', jsonb_build_object('texto', 'pulsos pedio y tibial posterior presentes'), 'Autotexto de muestra', now()),
('autotexto', '.sp', 'sin particularidades', jsonb_build_object('texto', 'sin particularidades'), 'Autotexto de muestra', now()),
('autotexto', '.c7', 'control en 7 días', jsonb_build_object('texto', 'Control en 7 días.'), 'Autotexto de muestra', now()),
('autotexto', '.c30', 'control en 30 días', jsonb_build_object('texto', 'Control en 30 días.'), 'Autotexto de muestra', now()),
('autotexto', '.cur', 'curación estándar', jsonb_build_object('texto', 'Curación con solución salina, antiséptico y apósito estéril.'), 'Autotexto de muestra', now());
