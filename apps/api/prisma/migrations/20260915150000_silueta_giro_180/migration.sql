-- Las fotos de la silueta del pie (plantar y dorsal) se giraron 180° para que el pie de la izquierda sea
-- de verdad el izquierdo del paciente. Las marcas y los dibujos guardados llevan coordenadas normalizadas
-- 0..1 dentro de la caja de cada pie: con el giro, la caja de cada pie queda volteada verticalmente
-- (y → 1 − y; el espejo horizontal lo absorbe el intercambio de mitades de la foto), así que los puntos
-- y trazos se voltean igual para seguir sobre la misma zona anatómica.
UPDATE "marcas_podograma" SET "y" = round((1 - "y")::numeric, 4)::double precision;

UPDATE "dibujos_silueta" d
SET "anotaciones" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN a ? 'puntos' THEN jsonb_set(a, '{puntos}', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(p -> 0, to_jsonb(round(1 - (p ->> 1)::numeric, 4))) ORDER BY po)
        FROM jsonb_array_elements(a -> 'puntos') WITH ORDINALITY q(p, po)
      ), '[]'::jsonb))
      WHEN a ? 'y' THEN jsonb_set(a, '{y}', to_jsonb(round(1 - (a ->> 'y')::numeric, 4)))
      ELSE a
    END ORDER BY ao), '[]'::jsonb)
  FROM jsonb_array_elements(d."anotaciones") WITH ORDINALITY t(a, ao)
)
WHERE jsonb_typeof(d."anotaciones") = 'array' AND jsonb_array_length(d."anotaciones") > 0;
