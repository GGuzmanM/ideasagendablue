/**
 * Dónde se ofrece un servicio en la reserva web (30-oct-2026). Función pura, sin base de datos: la usan el catálogo
 * público/chat y la pantalla de administración, para que los dos muestren las mismas sedes.
 *
 * Un servicio se ofrece en una sede cuando se cumplen TODAS:
 *   1. la sede está activa y marcada «visible en la web»  (sedes.reservaWeb)
 *   2. la sede atiende el área del servicio                (sede_unidad_negocio)
 *   3. la sede no está en la lista de ocultas del servicio (servicio_sede_web_oculto)
 */
export interface SedeWeb { id: string; reservaWeb: boolean }

/** Ids de las sedes (de `sedesDelArea`, en su orden) donde el servicio se ofrece. */
export function sedesQueOfrecen(sedesDelArea: SedeWeb[], ocultasDelServicio: ReadonlySet<string>): string[] {
  return sedesDelArea.filter((s) => s.reservaWeb && !ocultasDelServicio.has(s.id)).map((s) => s.id);
}

/** Clave `${servicioId}|${sedeId}` de la lista de ocultas. */
export const claveOculta = (servicioId: string, sedeId: string) => `${servicioId}|${sedeId}`;
