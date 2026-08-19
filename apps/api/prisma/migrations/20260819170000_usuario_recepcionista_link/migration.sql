-- Vincula la cuenta de login (usuarios) con la ficha del roster (recepcionistas). 1:1 opcional.
-- Para recepcionistas vinculadas, su ACCESO a la agenda se deriva en vivo del roster (ver auth.ts).
ALTER TABLE "usuarios" ADD COLUMN "recepcionistaId" UUID;
CREATE UNIQUE INDEX "usuarios_recepcionistaId_key" ON "usuarios"("recepcionistaId");
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_recepcionistaId_fkey" FOREIGN KEY ("recepcionistaId") REFERENCES "recepcionistas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
