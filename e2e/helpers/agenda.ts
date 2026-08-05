import { Page, expect } from '@playwright/test';
import { Catalogo } from '../fixtures/api';

/**
 * Navega a la Agenda y fija sede + unidad + fecha deterministas.
 * `fecha` en formato yyyy-MM-dd (usar una fecha RELATIVA a hoy, no hardcodeada).
 */
export async function irAAgenda(page: Page, cat: Catalogo, fecha: string) {
  await page.goto('/');
  // Seleccionar la sede del catálogo (abriendo el desplegable si no está visible).
  const sedeBtn = page.getByTestId(`sede-btn-${cat.sede.id}`);
  if (!(await sedeBtn.isVisible().catch(() => false))) {
    const trigger = page.getByTestId('sede-dropdown-trigger');
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
    }
  }
  if (await sedeBtn.isVisible().catch(() => false)) {
    await sedeBtn.click();
  }
  // Fijar la fecha del día del test.
  await page.getByTestId('agenda-fecha-input').fill(fecha);
  // Esperar a que la grilla renderice.
  await expect(page.getByTestId('agenda-grid')).toBeVisible({ timeout: 15000 });
}

/**
 * Arrastra la tarjeta de una cita a un slot destino, respetando dnd-kit:
 * el PointerSensor tiene activationConstraint distance:8 (hay que mover >8px para iniciar el
 * arrastre) y la collisionDetection es pointerWithin (el puntero debe quedar DENTRO del destino).
 */
export async function dragCitaASlot(page: Page, citaId: string, slotTestId: string) {
  const cita = page.getByTestId(`cita-${citaId}`);
  const slot = page.getByTestId(slotTestId);
  await expect(cita).toBeVisible();
  await expect(slot).toBeVisible();

  try {
    await cita.dragTo(slot, { timeout: 3000 });
  } catch {
    // Dispatch HTML5 DragEvents directly in DOM
    await page.evaluate(({ citaTestId, targetSlotTestId }) => {
      const source = document.querySelector(`[data-testid="${citaTestId}"]`);
      const target = document.querySelector(`[data-testid="${targetSlotTestId}"]`);
      if (!source || !target) throw new Error('elementos DnD no encontrados');

      const dataTransfer = new DataTransfer();

      const dragStartEvent = new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      source.dispatchEvent(dragStartEvent);

      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dragOverEvent);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(dropEvent);
    }, { citaTestId: `cita-${citaId}`, targetSlotTestId: slotTestId });
  }
}
