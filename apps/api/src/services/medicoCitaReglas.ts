/**
 * Médico de la cita — reglas PURAS (sin base de datos), probadas en el banco.
 *
 * En podología cada cita tiene, además de la podóloga, un médico. Los médicos se reparten las
 * citas entre ellos (recepción no los asigna: en la práctica era un caos). Quién puede qué:
 *  · El médico (`medico.autoasignar`) se TOMA una cita libre y SUELTA la suya. No puede quitarle
 *    una cita a otro médico ni soltar una cita en la que ya emitió receta.
 *  · Admin y coordinación (`medico.asignar`) asignan, cambian o quitan a cualquiera.
 * Una cita cancelada, reprogramada o no asistida ya no admite cambios de médico.
 */
export type AccionMedico = { accion: 'tomar' } | { accion: 'soltar' } | { accion: 'asignar'; medicoId: string | null };

export interface ActorMedico {
  /** Ficha de profesional del usuario (si es médico persona, activo). */
  profesionalId: string | null;
  esMedico: boolean;
  puedeAsignar: boolean;
  puedeAutoasignar: boolean;
}

export interface EstadoCitaMedico {
  medicoId: string | null;
  estado: string;
  /** Hay una receta médica VIGENTE (no anulada) en la atención de esta cita. */
  tieneRecetaVigente: boolean;
}

export type DecisionMedico =
  | { ok: true; medicoId: string | null; sinCambio: boolean }
  | { ok: false; status: number; code: string; mensaje: string };

export const ESTADOS_SIN_CAMBIO_MEDICO = ['cancelada', 'reprogramada', 'no_show'];

const no = (status: number, code: string, mensaje: string): DecisionMedico => ({ ok: false, status, code, mensaje });
const si = (actual: string | null, nuevo: string | null): DecisionMedico => ({ ok: true, medicoId: nuevo, sinCambio: actual === nuevo });

export function decidirCambioMedico(actor: ActorMedico, cita: EstadoCitaMedico, a: AccionMedico): DecisionMedico {
  if (ESTADOS_SIN_CAMBIO_MEDICO.includes(cita.estado)) {
    return no(409, 'CITA_NO_ACTIVA', 'La cita está cancelada, reprogramada o el paciente no asistió: ya no se le asigna médico');
  }
  switch (a.accion) {
    case 'tomar': {
      if (!actor.puedeAutoasignar || !actor.esMedico || !actor.profesionalId) {
        return no(403, 'SOLO_MEDICO', 'Solo un médico puede tomar una cita para sí mismo');
      }
      if (cita.medicoId === actor.profesionalId) return si(cita.medicoId, cita.medicoId);
      if (cita.medicoId && !actor.puedeAsignar) {
        return no(409, 'CITA_TOMADA', 'Esta cita ya la tomó otro médico');
      }
      return si(cita.medicoId, actor.profesionalId);
    }
    case 'soltar': {
      if (!cita.medicoId) return si(null, null);
      const esSuya = !!actor.profesionalId && cita.medicoId === actor.profesionalId;
      if (!actor.puedeAsignar) {
        if (!esSuya || !actor.puedeAutoasignar) return no(403, 'NO_ES_TU_CITA', 'Solo puedes soltar una cita que tomaste tú');
        if (cita.tieneRecetaVigente) {
          return no(409, 'TIENE_RECETA', 'Ya hay una receta médica emitida en esta cita: para cambiar de médico pide a coordinación');
        }
      }
      return si(cita.medicoId, null);
    }
    case 'asignar': {
      if (!actor.puedeAsignar) return no(403, 'SIN_PERMISO', 'Solo administración o coordinación asignan el médico de otra persona');
      return si(cita.medicoId, a.medicoId);
    }
  }
}

/**
 * ¿Quién firma la receta médica de esta atención?
 *  · Si quien emite es médico: él mismo. Si la cita no tenía médico, se le asigna al emitir. Si
 *    era de otro médico, no puede (la receta sería de un paciente que atiende otro).
 *  · Si no es médico (admin/coordinación con receta.emitir): el médico de la cita, obligatorio.
 */
export type FirmanteReceta =
  | { ok: true; medicoId: string; autoasignar: boolean }
  | { ok: false; status: number; code: string; mensaje: string };

export function firmanteReceta(p: { actorMedicoId: string | null; medicoCitaId: string | null }): FirmanteReceta {
  if (p.actorMedicoId) {
    if (!p.medicoCitaId) return { ok: true, medicoId: p.actorMedicoId, autoasignar: true };
    if (p.medicoCitaId === p.actorMedicoId) return { ok: true, medicoId: p.actorMedicoId, autoasignar: false };
    return { ok: false, status: 409, code: 'CITA_DE_OTRO_MEDICO', mensaje: 'Esta cita la tiene otro médico: la receta debe salir a su nombre. Pide a coordinación que te la asigne si la atiendes tú' };
  }
  if (!p.medicoCitaId) {
    return { ok: false, status: 409, code: 'SIN_MEDICO_ASIGNADO', mensaje: 'La cita no tiene médico asignado: asígnalo primero (la receta sale a su nombre y con su CMP)' };
  }
  return { ok: true, medicoId: p.medicoCitaId, autoasignar: false };
}
