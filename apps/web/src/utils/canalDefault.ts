// Canal (origen de la reserva) que se PRE-MARCA automáticamente según el ROL de quien agenda.
// Es solo un valor por defecto: el desplegable sigue siendo editable, no se bloquea.
//   recepcionista  → "recepcion"          (Recepción)
//   contact_center → "central_telefonica" (Central Telefónica)
//   cualquier otro (admin/coordinadora)   → "recepcion" por defecto
const CANAL_POR_ROL: Record<string, string> = {
  recepcionista: 'recepcion',
  contact_center: 'central_telefonica',
};

export function canalDefaultPorRol(rol?: string | null): string {
  return (rol && CANAL_POR_ROL[rol]) || 'recepcion';
}
