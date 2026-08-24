-- Motivo obligatorio cuando una cita se registra retroactivamente (fecha de la cita anterior al
-- día de creación). El flag "retroactiva" se deriva (fecha < día de creadoEn en hora Lima); esta
-- columna solo guarda el texto del motivo. Aditiva y nullable → no toca citas existentes.
ALTER TABLE "citas" ADD COLUMN "motivoRetroactivo" TEXT;
