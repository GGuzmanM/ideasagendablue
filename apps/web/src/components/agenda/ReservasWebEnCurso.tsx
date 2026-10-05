// Aviso de la agenda (05-oct-2026): horarios que la RESERVA WEB tiene apartados mientras el paciente paga
// (10 min), y reservas pagadas que no pudieron volverse cita. Así recepción no agenda encima de un cupo apartado.
// No muestra nada si no hay reservas web en curso para la sede y el día.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reservasWebApi, type ReservaWebEnCurso } from '../../api/reservasWeb';

function minutosRestantes(iso: string, ahora: number) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - ahora) / 60000));
}

function etiquetaEstado(r: ReservaWebEnCurso, ahora: number) {
  if (r.estado === 'esperando_pago') {
    const m = minutosRestantes(r.expiraEn, ahora);
    return { texto: m > 0 ? `Pagando · el apartado vence en ${m} min` : 'Pagando · por vencer', clase: 'bg-amber-100 text-amber-800' };
  }
  if (r.estado === 'pagada') return { texto: 'Pagó · creando la cita', clase: 'bg-sky-100 text-sky-800' };
  return { texto: `Pagó S/ ${r.monto.toFixed(2)} pero ya no había cupo: reubicar o devolver`, clase: 'bg-rose-100 text-rose-800' };
}

export function ReservasWebEnCurso({ sedeId, fecha }: { sedeId: string | null | undefined; fecha: string }) {
  const [abierto, setAbierto] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);
  const { data = [] } = useQuery({
    queryKey: ['reservas-web-en-curso', sedeId, fecha],
    queryFn: () => reservasWebApi.enCurso(sedeId!, fecha),
    enabled: !!sedeId && !!fecha,
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: false,
  });

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!abierto) return;
    const cerrar = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);

  // Las que vencieron entre una consulta y otra ya no ocupan el horario.
  const visibles = data.filter((r) => r.estado !== 'esperando_pago' || minutosRestantes(r.expiraEn, ahora) > 0);
  if (!visibles.length) return null;
  const hayProblema = visibles.some((r) => r.estado === 'reembolsar');

  return (
    <div className="relative" ref={ref} data-testid="reservas-web-en-curso">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 shadow-sm border text-xs font-semibold transition-colors ${hayProblema ? 'bg-rose-50 border-rose-300 text-rose-800 hover:bg-rose-100' : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'}`}
        title="Reservas hechas desde la página web que todavía no son cita"
      >
        <span className="material-symbols-outlined text-base">language</span>
        Reserva web · {visibles.length}
      </button>
      {abierto && (
        <div className="absolute z-50 mt-2 w-[min(380px,90vw)] right-0 lg:left-0 lg:right-auto rounded-xl border border-outline-variant/40 bg-surface-container-lowest shadow-xl p-3 space-y-2">
          <p className="text-xs text-on-surface-variant">
            Horarios apartados desde la web mientras el paciente paga. No agendes otro paciente en esas horas hasta que se libere o se confirme.
          </p>
          {visibles.map((r) => {
            const e = etiquetaEstado(r, ahora);
            return (
              <div key={r.id} className="rounded-lg border border-outline-variant/30 p-2.5 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-on-surface tabular-nums">{r.horaInicio}</span>
                  <span className="text-[11px] font-mono text-on-surface-variant">{r.codigo}</span>
                </div>
                <p className="text-sm text-on-surface">{r.servicio}{r.variante ? ` · ${r.variante}` : ''}</p>
                <p className="text-xs text-on-surface-variant">{r.paciente} · DNI {r.numeroDocumento} · {r.telefono}</p>
                <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${e.clase}`}>{e.texto}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
