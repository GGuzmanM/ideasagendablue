// Ocultar / mostrar una sección de la historia clínica (09-oct-2026: puntos 1, 2 y 3). Solo la ESCONDE (marca la
// <section> con data-plegada y el CSS de SeccionUnica oculta su contenido): lo que se está escribiendo no se pierde.
// La preferencia queda en este navegador, por sección.
import { useEffect, useRef, useState } from 'react';

export function BotonPlegarSeccion({ id }: { id: string }) {
  const clave = `limablue-hc-plegada-${id}`;
  const [plegada, setPlegada] = useState(() => { try { return localStorage.getItem(clave) === '1'; } catch { return false; } });
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const seccion = ref.current?.closest('section');
    if (seccion) seccion.dataset.plegada = plegada ? 'si' : 'no';
    try { localStorage.setItem(clave, plegada ? '1' : '0'); } catch { /* sin almacenamiento: solo esta vista */ }
  }, [plegada, clave]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setPlegada((p) => !p)}
      aria-expanded={!plegada}
      data-testid={`plegar-${id}`}
      className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition-colors"
      title={plegada ? 'Mostrar esta sección' : 'Ocultar esta sección'}
    >
      {plegada ? 'Mostrar' : 'Ocultar'}
      <span className="material-symbols-outlined text-lg">{plegada ? 'expand_more' : 'expand_less'}</span>
    </button>
  );
}
