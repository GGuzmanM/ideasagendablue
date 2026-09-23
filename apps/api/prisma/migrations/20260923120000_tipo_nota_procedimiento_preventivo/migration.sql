-- Tipo de nota «Procedimiento preventivo» en la historia clínica (23-sep-2026, pedido de la clínica).
-- Solo agrega un valor al enum; las notas existentes no cambian.
ALTER TYPE "TipoNota" ADD VALUE IF NOT EXISTS 'procedimiento_preventivo';
