-- Carga la historia clínica del ERP en `historia_clinica_erp` (28-sep-2026). Requiere la migración
-- 20260928120000_historia_clinica_erp. IDEMPOTENTE: una atención ya cargada (sede + id) no se duplica.
--
-- Se corre DESDE LA CARPETA donde está `hc-erp-limpio.csv` (el CSV que sale de limpiar-hc-erp.py):
--   cd <carpeta del csv>
--   psql -h localhost -p 5433 -U postgres -d <base> -f "<ruta>\cargar-hc-erp.sql"
--
-- Todo va en UNA transacción: si algo falla, no queda nada a medias.
\set ON_ERROR_STOP on
\timing on
BEGIN;

CREATE TEMP TABLE _hc_erp (
  "tipoDocumento" text, "numeroDocumento" text, "pacienteNombre" text, "sedeCodigo" text, sede text, "idAtencion" text,
  fecha date, hora text, "profesionalCodigo" text, "profesionalDni" text, profesional text, "servicioCodigo" text, servicio text,
  anamnesis text, diagnostico text, "planTratamiento" text, "notaMedico" text, "examenFisico" text, "estadoErp" text
) ON COMMIT DROP;

\echo '== 1. Lectura del CSV =='
\copy _hc_erp FROM 'hc-erp-limpio.csv' WITH (FORMAT csv, ENCODING 'UTF8')

\echo '== 2. Inserción (las ya cargadas se omiten) =='
INSERT INTO historia_clinica_erp ("tipoDocumento","numeroDocumento","pacienteNombre","sedeCodigo",sede,"idAtencion",fecha,hora,
  "profesionalCodigo","profesionalDni",profesional,"servicioCodigo",servicio,anamnesis,diagnostico,"planTratamiento","notaMedico",
  "examenFisico","estadoErp")
SELECT "tipoDocumento", "numeroDocumento", NULLIF("pacienteNombre",''), "sedeCodigo", NULLIF(sede,''), "idAtencion", fecha, NULLIF(hora,''),
  NULLIF("profesionalCodigo",''), NULLIF("profesionalDni",''), NULLIF(profesional,''), NULLIF("servicioCodigo",''), NULLIF(servicio,''),
  NULLIF(anamnesis,''), NULLIF(diagnostico,''), NULLIF("planTratamiento",''), NULLIF("notaMedico",''), NULLIF("examenFisico",''),
  NULLIF("estadoErp",'')
FROM _hc_erp
ON CONFLICT ("sedeCodigo", "idAtencion") DO NOTHING;

\echo '== 3. Enlace con el paciente: documento que calza con UN solo paciente (exacto o sin ceros a la izquierda) =='
WITH unicos AS (
  SELECT ltrim("numeroDocumento", '0') doc, min(id::text)::uuid id
  FROM pacientes WHERE "deletedAt" IS NULL AND "numeroDocumento" <> ''
  GROUP BY 1 HAVING count(*) = 1
)
UPDATE historia_clinica_erp h SET "pacienteId" = u.id
FROM unicos u
WHERE h."pacienteId" IS NULL AND u.doc = ltrim(h."numeroDocumento", '0');

\echo '== 4. Enlace con la visita de Genexis: mismo paciente y día; misma hora si hay varias =='
UPDATE historia_clinica_erp h SET "historialGenexisId" = (
  SELECT g.id FROM historial_genexis g
  WHERE g."pacienteId" = h."pacienteId" AND g."fechaCita" = to_char(h.fecha, 'YYYY-MM-DD') AND g."deletedAt" IS NULL
  ORDER BY (ltrim(substring(g."horaCita" FROM '^\d+'), '0') IS NOT DISTINCT FROM ltrim(substring(h.hora FROM '^\d+'), '0')) DESC,
           (g."llegoPaciente" = 'Sí') DESC, g.id
  LIMIT 1
)
WHERE h."historialGenexisId" IS NULL AND h."pacienteId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM historial_genexis g WHERE g."pacienteId" = h."pacienteId" AND g."fechaCita" = to_char(h.fecha, 'YYYY-MM-DD') AND g."deletedAt" IS NULL);

COMMIT;
ANALYZE historia_clinica_erp;

\echo '== Resumen =='
SELECT count(*) AS atenciones, count("pacienteId") AS con_paciente, count(DISTINCT "pacienteId") AS pacientes,
       count("historialGenexisId") AS en_visita_genexis, count(*) - count("pacienteId") AS sin_paciente
FROM historia_clinica_erp;
\timing off
