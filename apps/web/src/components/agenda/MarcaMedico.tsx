import type { CitaResumen } from '../../api/citas';
import { nombreMedico } from '../../api/medicoCita';
import { citaLlevaMedico } from '../../services/medicoCitaService';
import { useAuthStore } from '../../stores/authStore';

const INACTIVAS = ['cancelada', 'reprogramada', 'no_show'];

/**
 * Marca del médico en la tarjeta de la agenda: iniciales del médico que tomó la cita (azul; más
 * fuerte si es la del propio médico que mira). A un médico también le marca las citas de
 * podología que aún nadie tomó, para que se las repartan sin preguntar a recepción.
 */
export function MarcaMedico({ cita }: { cita: CitaResumen }) {
  const usuario = useAuthStore((s) => s.usuario);
  const soyMedico = usuario?.profesional?.tipo === 'medico' && !!usuario.permisos?.includes('medico.autoasignar');
  if (!citaLlevaMedico(cita) || INACTIVAS.includes((cita.estado || '').toLowerCase())) return null;

  if (cita.medico) {
    const mia = !!usuario?.profesionalId && cita.medicoId === usuario.profesionalId;
    const ini = `${cita.medico.nombres[0] ?? ''}${cita.medico.apellidos[0] ?? ''}`.toUpperCase();
    return (
      <span
        title={`Médico: ${nombreMedico(cita.medico)}${mia ? ' (tú)' : ''}`}
        data-testid="marca-medico"
        className={`inline-flex items-center gap-0.5 rounded px-1 font-sans text-[9px] font-bold ${mia ? 'bg-sky-700 text-white' : 'bg-sky-100 text-sky-800'}`}
      >
        <span className="material-symbols-outlined text-[11px] leading-none">stethoscope</span>{ini}
      </span>
    );
  }
  if (!soyMedico) return null;
  return (
    <span title="Sin médico: ábrela y toca «Tomar esta cita»" data-testid="marca-sin-medico"
      className="inline-flex items-center rounded px-1 font-sans text-[9px] font-bold border border-dashed border-sky-400 text-sky-700">
      <span className="material-symbols-outlined text-[11px] leading-none">stethoscope</span>?
    </span>
  );
}
