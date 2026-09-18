-- La foto de la PLANTA (public/Silueta.jpg) se volvió a girar 180° (17-sep-2026, a pedido del doctor): la
-- planta se mira ahora «a través» del pie, con los dedos arriba, igual que el dorso. La foto dorsal no se
-- toca. Las marcas y los dibujos guardados llevan coordenadas normalizadas 0..1 dentro de la caja de cada
-- pie; como cada caja queda girada 180° (y el pie pasa a la otra mitad del archivo, lo que ya resuelve el
-- recorte), los puntos y trazos de la vista PLANTAR se giran igual: x → 1 − x, y → 1 − y. Así cada marca
-- sigue sobre la misma zona anatómica. Las marcas antiguas sin vista son de la planta.
UPDATE "marcas_podograma"
SET "x" = round((1 - "x")::numeric, 4)::double precision,
    "y" = round((1 - "y")::numeric, 4)::double precision
WHERE COALESCE("vista", 'plantar') = 'plantar';

UPDATE "dibujos_silueta" d
SET "anotaciones" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN a ? 'puntos' THEN jsonb_set(a, '{puntos}', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(
          to_jsonb(round(1 - (p ->> 0)::numeric, 4)),
          to_jsonb(round(1 - (p ->> 1)::numeric, 4))
        ) ORDER BY po)
        FROM jsonb_array_elements(a -> 'puntos') WITH ORDINALITY q(p, po)
      ), '[]'::jsonb))
      WHEN a ? 'y' THEN jsonb_set(jsonb_set(a, '{y}', to_jsonb(round(1 - (a ->> 'y')::numeric, 4))),
                                  '{x}', to_jsonb(round(1 - (a ->> 'x')::numeric, 4)))
      ELSE a
    END ORDER BY ao), '[]'::jsonb)
  FROM jsonb_array_elements(d."anotaciones") WITH ORDINALITY t(a, ao)
)
WHERE COALESCE(d."vista", 'plantar') = 'plantar'
  AND jsonb_typeof(d."anotaciones") = 'array' AND jsonb_array_length(d."anotaciones") > 0;
