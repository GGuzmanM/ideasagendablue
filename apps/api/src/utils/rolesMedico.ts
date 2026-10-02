// Roles que se comportan como MÉDICO (02-oct-2026): el médico y el médico auditor (que además estandariza las recetas
// favoritas). Toda regla que antes preguntaba `rol === 'medico'` (leer todas las historias, sedes derivadas de su
// ficha, solo escribir en sus atenciones, ficha con CMP…) debe usar esto para que el auditor no pierda nada.
export const ROLES_MEDICO = ['medico', 'medico_auditor'] as const;

export function esRolMedico(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_MEDICO as readonly string[]).includes(rol);
}
