// Semana tipo (antes "Horarios del personal"). Define el horario semanal PERMANENTE
// de cada trabajador: qué días y en qué rango horario trabaja, vigente hasta editarlo.
// Es la CAPA 1 del modelo de horarios; se muestra dentro de la herramienta unificada
// HorariosPage. Distinto de Permisos/Bloqueos (ausencias puntuales) y de los ajustes
// por fecha (capa 2: entrada 8/9 y días especiales).
// Usa PUT /profesionales/:id/horario (horarioService: audit + caché + tiempo real).

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { profesionalesApi } from '../../api';
import { cn } from '../../utils/cn';

// Orden de días: Lun..Dom (diaSemana: 0=Dom..6=Sáb).
const DIAS = [
  { n: 1, label: 'Lunes' }, { n: 2, label: 'Martes' }, { n: 3, label: 'Miércoles' },
  { n: 4, label: 'Jueves' }, { n: 5, label: 'Viernes' }, { n: 6, label: 'Sábado' }, { n: 0, label: 'Domingo' },
];
const TIPO_LABEL: Record<string, string> = { podologa: 'Podólogas', medico: 'Médicos', fisioterapeuta: 'Fisioterapeutas' };

export function SemanaTipoContent() {
  const [q, setQ] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  const { data: personal = [], isLoading } = useQuery({
    queryKey: ['personal-todos'],
    queryFn: () => profesionalesApi.listar({ activo: true }),
  });

  // Las "máquinas" de baropodometría (Baro 1 / Baro 2) son pseudo-personas: NO tienen
  // horario de trabajo propio, así que se excluyen de este módulo (solo personal real).
  const esMaquinaBaro = (p: { nombres: string; apellidos: string }) =>
    /^baro(\s*\d+)?$/i.test(`${p.nombres} ${p.apellidos}`.trim());

  const grupos = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtrados = personal.filter((p) => !esMaquinaBaro(p) && (!term || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(term)));
    const porTipo = new Map<string, typeof filtrados>();
    for (const p of filtrados) {
      const k = p.tipo ?? 'otro';
      const arr = porTipo.get(k) ?? [];
      arr.push(p);
      porTipo.set(k, arr);
    }
    return [...porTipo.entries()].sort((a, b) => (TIPO_LABEL[a[0]] ?? a[0]).localeCompare(TIPO_LABEL[b[0]] ?? b[0]));
  }, [personal, q]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Banner Informativo */}
      <div className="bg-[#0044ab]/5 border border-[#0044ab]/20 rounded-2xl p-4 flex items-start gap-3 shadow-2xs">
        <div className="w-8 h-8 rounded-xl bg-[#0044ab]/10 text-[#0044ab] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-lg">lightbulb</span>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Este es el horario <strong className="text-on-surface">permanente</strong> de cada trabajador (vigente hasta volver a editarlo) y define las franjas <strong className="text-on-surface">reservables</strong> en la agenda. Para cambiar la hora de entrada de un día concreto usa <strong className="text-on-surface">Ajustes por fecha</strong>; para ausencias puntuales usa <strong className="text-on-surface">Restricciones/Ausencias</strong>.
        </p>
      </div>

      {/* Buscador */}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
          search
        </span>
        <input
          type="text"
          className="w-full pl-10 pr-4 py-3 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs placeholder:text-on-surface-variant/50"
          placeholder="Buscar profesional por nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs font-semibold text-on-surface-variant/70">
          Cargando horarios del personal…
        </div>
      ) : grupos.length === 0 ? (
        <div className="p-12 text-center text-xs font-semibold text-on-surface-variant/70 bg-surface-container-lowest rounded-2xl border border-outline-variant/40">
          No se encontró ningún profesional que coincida.
        </div>
      ) : (
        grupos.map(([tipo, lista]) => (
          <div key={tipo} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="font-label-caps text-label-caps text-on-surface-variant font-bold uppercase tracking-wider">
                {TIPO_LABEL[tipo] ?? tipo} ({lista.length})
              </span>
            </div>
            <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/60 divide-y divide-outline-variant/30 overflow-hidden shadow-xs">
              {lista.map((p) => (
                <div key={p.id} className="transition-colors">
                  <button
                    onClick={() => setAbierto(abierto === p.id ? null : p.id)}
                    className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-surface-container-low/60 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-2xs"
                        style={{ backgroundColor: p.colorAvatar || '#0044ab' }}
                      >
                        {`${p.nombres} ${p.apellidos}`.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                      </span>
                      <span className="text-xs font-bold text-on-surface">
                        {p.nombres} {p.apellidos}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-on-surface-variant/70">
                        {abierto === p.id ? 'Ocultar horarios' : 'Editar horario'}
                      </span>
                      <span className="material-symbols-outlined text-base text-on-surface-variant">
                        {abierto === p.id ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                  </button>
                  {abierto === p.id && (
                    <EditorHorario profesionalId={p.id} nombre={`${p.nombres} ${p.apellidos}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

interface DiaEstado { activo: boolean; horaInicio: string; horaFin: string }

function EditorHorario({ profesionalId, nombre }: { profesionalId: string; nombre: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['horario-semanal', profesionalId],
    queryFn: () => profesionalesApi.horarioSemanal(profesionalId),
  });

  // Estado editable por día (0..6). Se inicializa una vez con lo que trae el servidor.
  const [estado, setEstado] = useState<Record<number, DiaEstado> | null>(null);
  const base = useMemo(() => {
    const m: Record<number, DiaEstado> = {};
    for (const d of DIAS) m[d.n] = { activo: false, horaInicio: '08:00', horaFin: '20:00' };
    for (const h of data?.horarios ?? []) m[h.diaSemana] = { activo: true, horaInicio: h.horaInicio, horaFin: h.horaFin };
    return m;
  }, [data]);
  const ed = estado ?? base;

  const guardar = useMutation({
    mutationFn: ({ forzar }: { forzar?: boolean }) => {
      const dias = DIAS.filter((d) => ed[d.n].activo).map((d) => ({ diaSemana: d.n, horaInicio: ed[d.n].horaInicio, horaFin: ed[d.n].horaFin }));
      return profesionalesApi.setHorarioSemanal(profesionalId, dias, forzar);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['horario-semanal', profesionalId] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
      toast.success(`Horario de ${nombre.split(' ')[0]} guardado correctamente`);
    },
    onError: (e: Error) => {
      if ((e as Error & { data?: { error?: string } }).data?.error === 'HORARIO_CONFLICTO_CITAS') {
        if (window.confirm(`${e.message}\n\n¿Aplicar el horario de todos modos?`)) {
          guardar.mutate({ forzar: true });
          return;
        }
      }
      toast.error(e.message);
    },
  });

  const set = (n: number, patch: Partial<DiaEstado>) => setEstado((prev) => ({ ...(prev ?? base), [n]: { ...(prev ?? base)[n], ...patch } }));

  const invalido = DIAS.some((d) => ed[d.n].activo && ed[d.n].horaFin <= ed[d.n].horaInicio);
  const sinDias = DIAS.every((d) => !ed[d.n].activo);

  if (isLoading) {
    return (
      <div className="px-5 py-4 text-xs font-medium text-on-surface-variant/60 italic bg-surface-container-low/40 border-t border-outline-variant/30">
        Cargando horario semanal…
      </div>
    );
  }

  return (
    <div className="px-5 py-4 bg-surface-container-low/40 border-t border-outline-variant/30 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {DIAS.map((d) => {
          const st = ed[d.n];
          const malRango = st.activo && st.horaFin <= st.horaInicio;
          return (
            <div
              key={d.n}
              className={cn(
                'flex items-center justify-between p-2.5 rounded-xl border transition-colors',
                st.activo
                  ? 'bg-surface-container-lowest border-outline-variant/60 shadow-2xs'
                  : 'bg-transparent border-transparent opacity-60'
              )}
            >
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={st.activo}
                  onChange={(e) => set(d.n, { activo: e.target.checked })}
                  className="w-4 h-4 rounded text-primary border-outline-variant focus:ring-primary/20 cursor-pointer"
                />
                <span className={cn('text-xs font-bold', st.activo ? 'text-on-surface' : 'text-on-surface-variant')}>
                  {d.label}
                </span>
              </label>

              {st.activo ? (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    step={1800}
                    value={st.horaInicio}
                    onChange={(e) => set(d.n, { horaInicio: e.target.value })}
                    className={cn(
                      'px-2 py-1 bg-surface-container-lowest border rounded-lg text-xs font-mono font-semibold text-on-surface outline-none focus:border-primary',
                      malRango ? 'border-error text-error' : 'border-outline-variant/60'
                    )}
                  />
                  <span className="text-xs text-on-surface-variant/60 font-bold">a</span>
                  <input
                    type="time"
                    step={1800}
                    value={st.horaFin}
                    onChange={(e) => set(d.n, { horaFin: e.target.value })}
                    className={cn(
                      'px-2 py-1 bg-surface-container-lowest border rounded-lg text-xs font-mono font-semibold text-on-surface outline-none focus:border-primary',
                      malRango ? 'border-error text-error' : 'border-outline-variant/60'
                    )}
                  />
                </div>
              ) : (
                <span className="text-[11px] font-semibold text-on-surface-variant/50 uppercase">
                  Libre
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-outline-variant/30 flex-wrap gap-2">
        <span className="text-[11px] text-on-surface-variant/70 font-medium">
          * Los cambios actualizan la agenda y disponibilidad hacia adelante.
        </span>

        <div className="flex items-center gap-2">
          {sinDias && (
            <span className="text-[11px] text-amber-700 font-semibold">
              Marca al menos un día laboral.
            </span>
          )}
          <button
            type="button"
            onClick={() => guardar.mutate({})}
            disabled={guardar.isPending || invalido || sinDias}
            className="px-4 py-2 bg-[#0044ab] text-white rounded-xl text-xs font-bold hover:bg-[#003380] transition-colors shadow-xs disabled:opacity-40 cursor-pointer"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      </div>
    </div>
  );
}
