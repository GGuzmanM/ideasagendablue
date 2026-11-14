// Decoración del modo navideño (ver stores/navidadStore.ts): switch, guirnalda del menú y gorrito del logo;
// la nieve y la cuenta regresiva viven en Nieve.tsx y CuentaRegresiva.tsx.
// Todo es visual: no toca datos ni bloquea clics. Con «reducir animaciones» del sistema no hay nieve ni titileo.
import { useEffect } from 'react';
import { cn } from '../../utils/cn';
import { useEnTemporadaNavidad, useNavidadStore, useNavidadVisible } from '../../stores/navidadStore';

/** Switch «Modo navideño». Solo aparece en temporada (o a las cuentas anticipadas). `compacto` = menú plegado (solo el árbol). */
export function NavidadSwitch({ compacto = false }: { compacto?: boolean }) {
  const activo = useNavidadStore((s) => s.activo);
  const alternar = useNavidadStore((s) => s.alternar);
  const enTemporada = useEnTemporadaNavidad();
  if (!enTemporada) return null;

  const pista = (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        activo ? 'bg-red-500' : 'bg-white/25',
      )}
    >
      <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200', activo && 'translate-x-4')} />
    </span>
  );

  if (compacto) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        onClick={alternar}
        data-testid="navidad-switch"
        title={activo ? 'Apagar modo navideño' : 'Prender modo navideño'}
        className={cn('w-10 h-10 mx-auto rounded-xl grid place-items-center text-lg transition-colors', activo ? 'bg-white/20' : 'opacity-60 hover:opacity-100 hover:bg-white/10')}
      >
        🎄
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      onClick={alternar}
      data-testid="navidad-switch"
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium text-blue-100/85 hover:bg-white/10 hover:text-white transition-colors"
    >
      <span className="flex items-center gap-2 truncate"><span className="text-base leading-none">🎄</span>Modo navideño</span>
      {pista}
    </button>
  );
}

const COLORES_FOCO = ['#ef4444', '#facc15', '#22c55e', '#60a5fa'];

/** Guirnalda de luces sobre el borde de arriba del menú (va en el padding superior). */
export function Guirnalda() {
  const focos = Array.from({ length: 12 }, (_, i) => i);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-6 overflow-hidden">
      <svg width="100%" height="24" viewBox="0 0 264 24" preserveAspectRatio="xMinYMin slice">
        <path
          d={`M0,2 ${focos.map((i) => `Q${i * 22 + 11},12 ${i * 22 + 22},2`).join(' ')}`}
          fill="none" stroke="#14532d" strokeWidth="1.5" opacity="0.9"
        />
        {focos.map((i) => (
          <g key={i} transform={`translate(${i * 22 + 11},7)`}>
            <rect x="-1.6" y="0" width="3.2" height="2.4" rx="0.6" fill="#a3a3a3" />
            <ellipse
              className="navidad-foco"
              style={{ animationDelay: `${(i % 4) * 0.45}s` }}
              cx="0" cy="6.5" rx="2.8" ry="4.2"
              fill={COLORES_FOCO[i % COLORES_FOCO.length]}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Gorrito de Papá Noel encima del logo (el contenedor del logo debe ser `relative`). */
export function Gorrito({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 40 34" className={cn('pointer-events-none absolute', className)}>
      <path d="M6 26 C9 12 18 3 29 6 C33 7 35 12 36 17 C32 13 28 12 25 14 C30 18 32 22 32 26 Z" fill="#dc2626" />
      <path d="M25 14 C28 12 32 13 36 17" fill="none" stroke="#991b1b" strokeWidth="1" opacity="0.5" />
      <rect x="3" y="24" width="32" height="8" rx="4" fill="#ffffff" />
      <circle cx="36.5" cy="18.5" r="3.5" fill="#ffffff" />
    </svg>
  );
}

/** Con el modo prendido, la pestaña del navegador dice «🎄 Limablue Agenda». */
export function useTituloNavideno(activo: boolean) {
  useEffect(() => {
    if (!activo) return;
    const antes = document.title;
    document.title = '🎄 ' + antes;
    return () => { document.title = antes; };
  }, [activo]);
}

export { Acebo, AceboTitulo, AceboEsquina, SaludoNavideno, LucesEncabezado } from './Adornos';

/** Gorrito sobre un ícono de pantalla, solo con el modo navideño prendido (el contenedor debe ser «relative»). */
export function GorritoNavideno({ className }: { className?: string }) {
  const navidad = useNavidadVisible();
  return navidad ? <Gorrito className={className} /> : null;
}
export { Nieve } from './Nieve';
export { CuentaRegresiva } from './CuentaRegresiva';
