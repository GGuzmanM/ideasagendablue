// Roles que se comportan como MÉDICO (02-oct-2026): el médico y el médico auditor (copia de apps/api/src/utils/rolesMedico.ts).
export const ROLES_MEDICO = ['medico', 'medico_auditor'] as const;

export function esRolMedico(rol: string | null | undefined): boolean {
  return !!rol && (ROLES_MEDICO as readonly string[]).includes(rol);
}
