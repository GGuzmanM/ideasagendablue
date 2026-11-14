// Cuenta regresiva del modo navideño (tarjeta en el menú lateral). Cuenta hacia Navidad (25-dic) y,
// pasada Navidad, hacia Año Nuevo; el 25-dic y del 1 al 6 de enero muestra el saludo.
// Hora de Lima (UTC−5 fijo, sin horario de verano); se refresca cada 30 s.
import { useEffect, useState } from 'react';
import { Acebo } from './Adornos';

export interface MomentoNavideno { titulo: string; emoji: string; dias?: number; horas?: number; minutos?: number }

export function momentoNavideno(ahora: Date = new Date()): MomentoNavideno {
  const l = new Date(ahora.getTime() - 5 * 3_600_000); // «reloj de pared» de Lima, leído con getUTC*
  const anio = l.getUTCFullYear(), mes = l.getUTCMonth() + 1, dia = l.getUTCDate();
  if (mes === 12 && dia === 25) return { titulo: '¡Feliz Navidad!', emoji: '🎅' };
  if (mes === 1 && dia === 1) return { titulo: `¡Feliz Año Nuevo ${anio}!`, emoji: '🎆' };
  if (mes === 1) return { titulo: `¡Feliz ${anio}!`, emoji: '✨' };
  const haciaNavidad = !(mes === 12 && dia > 25);
  const meta = haciaNavidad ? Date.UTC(anio, 11, 25) : Date.UTC(anio + 1, 0, 1);
  const resto = Math.max(0, meta - l.getTime());
  return {
    titulo: haciaNavidad ? 'para Navidad' : 'para Año Nuevo',
    emoji: haciaNavidad ? '🎄' : '🥂',
    dias: Math.floor(resto / 86_400_000),
    horas: Math.floor((resto % 86_400_000) / 3_600_000),
    minutos: Math.floor((resto % 3_600_000) / 60_000),
  };
}

function useMomentoNavideno(): MomentoNavideno {
  const [m, setM] = useState(() => momentoNavideno());
  useEffect(() => {
    const id = window.setInterval(() => setM(momentoNavideno()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return m;
}

const dos = (n = 0) => String(n).padStart(2, '0');

/** «43 días · 07 h · 12 min para Navidad». `compacto` (menú plegado) = emoji + número. */
export function CuentaRegresiva({ compacto = false }: { compacto?: boolean }) {
  const m = useMomentoNavideno();
  const saludo = m.dias === undefined;
  const detalle = saludo ? m.titulo : `Faltan ${m.dias} día${m.dias === 1 ? '' : 's'}, ${m.horas} h y ${m.minutos} min ${m.titulo}`;

  if (compacto) {
    return (
      <div data-testid="cuenta-regresiva" title={detalle}
        className="mx-auto mb-4 w-11 rounded-xl bg-white/10 border border-amber-200/30 py-1 text-center">
        <div className="text-sm leading-none">{m.emoji}</div>
        {!saludo && <div className="text-amber-200 font-bold text-sm leading-tight tabular-nums">{m.dias}</div>}
      </div>
    );
  }

  return (
    <div data-testid="cuenta-regresiva" title={detalle}
      className="relative mx-1 mt-1 mb-3 rounded-xl border border-amber-200/30 bg-gradient-to-br from-white/15 to-white/5 px-2.5 py-1.5">
      <Acebo className="-top-2.5 -right-2 w-7 rotate-12" />
      {saludo ? (
        <div className="flex items-center gap-2.5">
          <span className="text-lg leading-none">{m.emoji}</span>
          <span className="text-white font-bold text-xs leading-tight">{m.titulo}</span>
        </div>
      ) : m.dias === 0 ? (
        <div className="flex items-center gap-2.5">
          <span className="text-lg leading-none">{m.emoji}</span>
          <div className="min-w-0">
            <div className="text-white font-bold text-xs leading-tight">{m.titulo === 'para Navidad' ? '¡Esta noche es Nochebuena!' : '¡Esta noche se recibe el Año Nuevo!'}</div>
            <div className="text-amber-100/85 text-[10px] leading-tight tabular-nums">Faltan {dos(m.horas)} h · {dos(m.minutos)} min</div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <div className="flex items-baseline gap-1 shrink-0">
            <span className="text-amber-200 font-extrabold text-xl leading-none tabular-nums drop-shadow">{m.dias}</span>
            <span className="text-[9px] uppercase tracking-wider text-amber-100/80">{m.dias === 1 ? 'día' : 'días'}</span>
          </div>
          <div className="min-w-0 border-l border-white/15 pl-2.5">
            <div className="text-white text-[11px] font-semibold leading-tight truncate">{m.emoji} {m.titulo}</div>
            <div className="text-blue-100/75 text-[10px] leading-tight tabular-nums">{dos(m.horas)} h · {dos(m.minutos)} min</div>
          </div>
        </div>
      )}
    </div>
  );
}
