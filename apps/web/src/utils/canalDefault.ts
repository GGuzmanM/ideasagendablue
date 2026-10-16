// Canal (origen de la reserva) que se PRE-MARCA automáticamente según el ROL de quien agenda.
// Es solo un valor por defecto: el desplegable sigue siendo editable, no se bloquea.
//   recepcionista            → "recepcion" (Recepción)
//   contact_center / especial_contact → "" (15-oct-2026: NADA pre-marcado; tienen que elegir el canal sí o sí
//                                          para poder registrar la cita. Antes quedaba WhatsApp por defecto)
//   cualquier otro (admin/coordinadora) → "recepcion" por defecto
const CANAL_POR_ROL: Record<string, string> = {
  recepcionista: 'recepcion',
  contact_center: '',
  especial_contact: '',
};

export function canalDefaultPorRol(rol?: string | null): string {
  return rol && rol in CANAL_POR_ROL ? CANAL_POR_ROL[rol]! : 'recepcion';
}
