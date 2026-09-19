/**
 * Reglas PURAS de la agenda (sin base de datos), compartidas por las rutas de citas y probadas en
 * Jest: qué estado queda al mover una cita y qué se guarda en la auditoría al agendarla.
 */
import { fechaAStr } from '../utils/fechaLima';

// ─── Estado de una cita al MOVERLA ─────────────────────────────────────────────
// Misma fecha: se conserva el estado (una paciente que ya LLEGÓ y se pasa a otra podóloga sigue
// "Llegó"; antes volvía a "Agendada" y se perdía la marca de llegada y su hora). Otro día: vuelve a
// "Agendada", salvo confirmada/completada (la reprogramación de una atendida es acción de coordinación).
export function estadoAlMover(c: { estado: string; fecha: Date }, nuevaFecha: string): string {
  if (['completada', 'confirmada'].includes(c.estado)) return c.estado;
  if (['llego', 'en_atencion'].includes(c.estado) && fechaAStr(c.fecha) === nuevaFecha) return c.estado;
  return 'agendada';
}

// ─── Auditoría del alta de una cita ───────────────────────────────────────────
// Solo lo que un humano necesita leer (quién, qué servicio, cuándo, con quién, cómo se pagó),
// no la fila completa de la tabla (claves técnicas, nulos, comprobantes, marcas internas).
export function citaParaAuditoria(c: {
  pacienteId: string; profesionalId: string | null; solicitadoProfesionalId?: string | null; medicoId?: string | null;
  sedeId: string; unidadNegocioId: string; servicioId: string; subcategoriaId?: string | null;
  fecha: Date; horaInicio: string; duracionMinutos: number; estado: string; canal: string;
  origenAsignacion?: string | null; promocionId?: string | null; paquetePacienteId?: string | null;
  sesionNumero?: number | null; slotGrupoId?: string | null; slotRol?: string | null; consultorioNumero?: number | null;
}) {
  return {
    pacienteId: c.pacienteId,
    servicioId: c.servicioId,
    ...(c.subcategoriaId ? { subcategoriaId: c.subcategoriaId } : {}),
    fecha: fechaAStr(c.fecha),
    horaInicio: c.horaInicio,
    duracionMinutos: c.duracionMinutos,
    profesionalId: c.profesionalId,
    ...(c.solicitadoProfesionalId ? { solicitadoProfesionalId: c.solicitadoProfesionalId } : {}),
    ...(c.medicoId ? { medicoId: c.medicoId } : {}),
    sedeId: c.sedeId,
    unidadNegocioId: c.unidadNegocioId,
    estado: c.estado,
    canal: c.canal,
    ...(c.origenAsignacion ? { origenAsignacion: c.origenAsignacion } : {}),
    ...(c.promocionId ? { promocionId: c.promocionId } : {}),
    ...(c.paquetePacienteId ? { paquetePacienteId: c.paquetePacienteId, sesionNumero: c.sesionNumero ?? null } : {}),
    ...(c.slotGrupoId ? { slotGrupoId: c.slotGrupoId, slotRol: c.slotRol } : {}),
    ...(c.consultorioNumero ? { consultorioNumero: c.consultorioNumero } : {}),
  };
}
