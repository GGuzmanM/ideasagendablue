// Página de inicio según el rol y los PERMISOS (25-sep-2026): los médicos entran directo al «Visor de Pacientes»; quien
// puede ver la agenda, a la agenda; si no, a la primera sección que su rol sí permite. Nunca devuelve una página que el
// usuario no pueda ver (si no, el guard de permisos redirigiría en bucle).
import { esRolMedico } from './rolesMedico';

interface UsuarioInicio { rol?: string | null; permisos?: string[] | null }

const ORDEN: { ruta: string; permisos: string[] }[] = [
  { ruta: '/AgendaPrincipal', permisos: ['citas.ver'] },
  { ruta: '/pacientes-del-dia', permisos: ['medico.autoasignar', 'medico.asignar'] },
  { ruta: '/pacientes', permisos: ['pacientes.ver'] },
  { ruta: '/historia-clinica/bandeja', permisos: ['hc.ver'] },
  { ruta: '/horarios', permisos: ['horarios.ver'] },
  { ruta: '/movimientos', permisos: ['movimientos.ver'] },
  { ruta: '/analytics', permisos: ['analytics.ver'] },
];

export function rutaInicio(usuario?: UsuarioInicio | null): string {
  const perms = usuario?.permisos ?? [];
  const tiene = (ps: string[]) => ps.some((p) => perms.includes(p));
  if (esRolMedico(usuario?.rol) && tiene(['medico.autoasignar', 'medico.asignar'])) return '/pacientes-del-dia';
  // Sin usuario cargado todavía (arranque): la agenda, como siempre; el guard vuelve a decidir al cargar.
  if (!usuario) return '/AgendaPrincipal';
  return ORDEN.find((o) => tiene(o.permisos))?.ruta ?? '/sin-permisos';
}
