// Estado de pago de la cita (29-sep-2026): Pendiente de pago / Pago incompleto / Pago completo.
// Mismos textos y colores en Nueva Cita, detalle, popover y panel antiguo.
export type EstadoPago = 'pendiente' | 'incompleto' | 'completo';

export const ESTADOS_PAGO: { value: EstadoPago; label: string; icono: string; activo: string; texto: string }[] = [
  { value: 'pendiente', label: 'Pendiente de pago', icono: 'schedule', activo: 'bg-rose-50 border-rose-400 ring-1 ring-rose-400 text-rose-800', texto: 'text-rose-700' },
  { value: 'incompleto', label: 'Pago incompleto', icono: 'hourglass_bottom', activo: 'bg-amber-50 border-amber-400 ring-1 ring-amber-400 text-amber-800', texto: 'text-amber-700' },
  { value: 'completo', label: 'Pago completo', icono: 'paid', activo: 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500 text-emerald-800', texto: 'text-emerald-700' },
];

/** Estado de pago de una cita (las anteriores solo traían `pagada`). */
export const estadoPagoDe = (c: { estadoPago?: EstadoPago | null; pagada?: boolean | null }): EstadoPago =>
  c.estadoPago ?? (c.pagada ? 'completo' : 'pendiente');

export const infoEstadoPago = (e: EstadoPago) => ESTADOS_PAGO.find((x) => x.value === e) ?? ESTADOS_PAGO[0]!;
