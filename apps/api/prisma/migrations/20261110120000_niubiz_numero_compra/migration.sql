-- Pago en línea con Niubiz (10-nov-2026): número de pedido (purchaseNumber) de cada intento de pago.
-- Niubiz exige un valor de máximo 12 caracteres, único por intento de autorización: sale de esta secuencia y se guarda en
-- reservas_web."pagoReferencia". El índice único parcial es la red de seguridad (y acelera buscar un pago por su número).
-- Ninguno de los dos está en schema.prisma (Prisma no representa secuencias ni índices parciales).
CREATE SEQUENCE IF NOT EXISTS reservas_web_numero_compra_seq START 1000000;
CREATE UNIQUE INDEX IF NOT EXISTS reservas_web_numero_compra_unico ON reservas_web ("pagoReferencia") WHERE "pasarela" = 'niubiz';
