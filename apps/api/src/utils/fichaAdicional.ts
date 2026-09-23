/**
 * Ficha «Adicional <sede>»: columna extra de la sede (capacidad de emergencia), no una persona. Se detecta por el
 * nombre; tolera el error de tipeo con que se creó alguna («Adiconal Paz Soldan 2»). Reglas en todo el sistema:
 *  · NUNCA entra a la asignación automática («sin preferencia») ni cuenta como disponibilidad: solo se le agenda
 *    cuando recepción la ELIGE expresamente.
 *  · Es fija de su sede (Movimientos la rechaza); su sede se pone desde la ficha.
 *  · En la agenda va al final, antes de las de vacaciones; en Movimientos se ve como tarjeta fija.
 * El front tiene su copia (`esFichaAdicional` en movimientosService / `esColumnaAdicional` en idea1AgendaService).
 */
export function esFichaAdicional(nombres: string | null | undefined): boolean {
  return /^adici?onal\b|^adiconal\b/i.test((nombres ?? '').trim());
}
