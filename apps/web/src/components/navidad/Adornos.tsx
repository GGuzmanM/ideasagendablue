// Adornos chicos del modo navideño: acebo (esquinas y títulos) y la guirnalda de luces que cuelga bajo el encabezado de
// cada pantalla. Todo es visual (pointer-events-none): no tapa clics ni cambia el tamaño de nada.
import { cn } from '../../utils/cn';
import { useNavidadVisible } from '../../stores/navidadStore';

/** Ramita de acebo (dos hojas y tres bayas) para una esquina (el contenedor debe ser «relative»). */
export function Acebo({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 32 24" className={cn('pointer-events-none absolute drop-shadow-[0_1px_1px_rgba(0,0,0,0.3)]', className)}>
      <path d="M16 13 C12 9 8 10 5 6 C4 9 2 10 1 12 C4 12 5 15 4 17 C8 15 12 16 16 13 Z" fill="#15803d" />
      <path d="M16 13 C20 9 24 10 27 6 C28 9 30 10 31 12 C28 12 27 15 28 17 C24 15 20 16 16 13 Z" fill="#16a34a" />
      <path d="M16 13 C11 12 7 11 4 9 M16 13 C21 12 25 11 28 9" stroke="#0f5132" strokeWidth="0.7" fill="none" />
      <circle cx="13.5" cy="15" r="2.6" fill="#dc2626" />
      <circle cx="18.5" cy="15" r="2.6" fill="#ef4444" />
      <circle cx="16" cy="11.5" r="2.6" fill="#b91c1c" />
      <circle cx="15.3" cy="10.7" r="0.7" fill="#fff" opacity="0.7" />
    </svg>
  );
}

/** Acebo pequeño junto a un título (en línea con el texto). Solo con el modo navideño prendido. */
export function AceboTitulo({ className }: { className?: string }) {
  const navidad = useNavidadVisible();
  if (!navidad) return null;
  return (
    <span aria-hidden className={cn('relative inline-block w-7 h-5 shrink-0 align-middle', className)} data-testid="navidad-acebo-titulo">
      <Acebo className="inset-0 w-7 h-5" />
    </span>
  );
}

/** Acebo en la esquina de arriba a la derecha de una tarjeta (la tarjeta debe ser «relative»). Solo con el modo prendido. */
export function AceboEsquina({ className }: { className?: string }) {
  const navidad = useNavidadVisible();
  if (!navidad) return null;
  return <Acebo className={cn('-top-2.5 -right-2 w-10 rotate-[14deg] z-10', className)} />;
}

/** Saludo chico «¡Felices fiestas!» (píldora roja y verde). Solo con el modo prendido. */
export function SaludoNavideno({ className }: { className?: string }) {
  const navidad = useNavidadVisible();
  if (!navidad) return null;
  return (
    <span
      className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-red-200 bg-gradient-to-r from-red-50 to-emerald-50 text-[11px] font-bold text-red-700 whitespace-nowrap', className)}
      data-testid="navidad-saludo"
    >
      <span aria-hidden>🎄</span>¡Felices fiestas!
    </span>
  );
}

const COLORES = ['#ef4444', '#facc15', '#22c55e', '#60a5fa'];
const PASO = 46; // px entre foco y foco
const FOCOS = 48; // alcanza para pantallas de ~2200 px; lo que sobra se recorta

/**
 * Guirnalda de luces que CUELGA bajo el encabezado de una pantalla (el encabezado debe ser «relative»).
 * Va por fuera del encabezado, sobre el contenido (unos 12 px), sin tapar clics. Solo con el modo navideño prendido.
 */
export function LucesEncabezado({ className }: { className?: string }) {
  const navidad = useNavidadVisible();
  if (!navidad) return null;
  const ancho = FOCOS * PASO;
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-x-0 top-full z-30 h-3.5 overflow-hidden', className)} data-testid="navidad-luces">
      <svg width={ancho} height="14" viewBox={`0 0 ${ancho} 14`}>
        <path
          d={`M0,1 ${Array.from({ length: FOCOS }, (_, i) => `Q${i * PASO + PASO / 2},7 ${(i + 1) * PASO},1`).join(' ')}`}
          fill="none" stroke="#166534" strokeWidth="1.2" opacity="0.75"
        />
        {Array.from({ length: FOCOS }, (_, i) => (
          <g key={i} transform={`translate(${i * PASO + PASO / 2},4.2)`}>
            <rect x="-1.3" y="0" width="2.6" height="1.8" rx="0.5" fill="#9ca3af" />
            <ellipse
              className="navidad-foco"
              style={{ animationDelay: `${(i % 4) * 0.45}s` }}
              cx="0" cy="5" rx="2.2" ry="3.3"
              fill={COLORES[i % COLORES.length]}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
