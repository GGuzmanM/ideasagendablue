// ─── Deduplicación global de toasts ───────────────────────────────────────────
// Antes, al hacer varios clics, el MISMO mensaje (ej. "Selecciona un servicio") se APILABA
// en varias copias. Aquí parcheamos `toast.error/success/loading` UNA sola vez (importado en
// main.tsx) para asignarles un `id` derivado del mensaje: si ese texto ya está en pantalla,
// react-hot-toast ACTUALIZA ese toast (refresca su duración y su color/ícono) en vez de crear
// otro. Comportamiento resultante:
//   • Mismo mensaje repetido → 1 solo toast, se actualiza (no se apila).
//   • Mensajes distintos → se muestran a la vez (no hacen cola).
//   • Un success (verde) sigue la misma regla; si reemitís el mismo texto, refresca el existente.
// Ventaja: no hay que tocar los ~44 archivos que ya usan `toast`. Los mensajes que no son texto
// (JSX/función) conservan su comportamiento normal.
import toast from 'react-hot-toast';

const idDeMensaje = (msg: unknown): string =>
  'auto:' + String(msg).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);

type MetodoToast = 'error' | 'success' | 'loading';

(['error', 'success', 'loading'] as MetodoToast[]).forEach((metodo) => {
  const original = toast[metodo].bind(toast) as (mensaje: unknown, opciones?: Record<string, unknown>) => string;
  (toast as unknown as Record<string, unknown>)[metodo] = (mensaje: unknown, opciones?: Record<string, unknown>) => {
    // Respeta un `id` explícito si el llamador lo pasó; si no, deduplica por el texto del mensaje.
    const id = (opciones?.id as string | undefined) ?? (typeof mensaje === 'string' ? idDeMensaje(mensaje) : undefined);
    return original(mensaje, id ? { id, ...opciones } : opciones);
  };
});
