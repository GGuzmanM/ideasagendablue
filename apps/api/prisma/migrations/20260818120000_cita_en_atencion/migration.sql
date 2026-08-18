-- Ancla "En atención" para el auto-completado (la cita pasa sola a 'completada' tras duración+15).
ALTER TABLE "citas" ADD COLUMN     "enAtencionEn" TIMESTAMP(3);
