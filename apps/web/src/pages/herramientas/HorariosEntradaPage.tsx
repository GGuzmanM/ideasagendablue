// Ajustes por fecha (antes "Horarios de entrada"). CAPA 2 del modelo de horarios:
// overrides de turno de días CONCRETOS — entrada 8/9 de Lun-Vie y presencia en días
// especiales (domingo/feriado habilitado). A diferencia del modelo viejo, el override
// afecta la agenda Y los horarios reservables (una sola verdad: `turnosDelDia`).
// Se muestra dentro de la herramienta unificada HorariosPage.

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { format, addDays, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { sedesApi, profesionalesApi, type PodologaSemana, type DiaEntrada } from '../../api';
import { cn } from '../../utils/cn';

const DIA_LABEL = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function hoyISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

// ¿El error es la salvaguarda de citas fuera del nuevo turno? → ofrecer forzar.
function esConflictoCitas(e: Error): boolean {
  return (e as Error & { data?: { error?: string } }).data?.error === 'HORARIO_CONFLICTO_CITAS';
}

// ── Fila de podóloga: 5 días con toggle 8/9 + acción de semana completa ────────
function FilaPodologa({ p, sedeId, semanaRef }: { p: PodologaSemana; sedeId: string; semanaRef: string }) {
  const qc = useQueryClient();
  const iniciales = `${p.nombres[0] ?? ''}${p.apellidos[0] ?? ''}`.toUpperCase();

  const mut = useMutation({
    mutationFn: ({ fechas, hora, forzar }: { fechas: string[]; hora: '08:00' | '09:00'; forzar?: boolean }) =>
      profesionalesApi.setEntrada(p.id, fechas, hora, forzar),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['horarios-entrada', sedeId, semanaRef] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
    },
    onError: (e: Error, vars) => {
      if (esConflictoCitas(e)) {
        if (window.confirm(`${e.message}\n\n¿Aplicar la entrada de todos modos?`)) {
          mut.mutate({ ...vars, forzar: true });
          return;
        }
        return;
      }
      toast.error(e.message);
    },
  });

  const nombreCorto = `${p.nombres.split(' ')[0]} ${p.apellidos.split(' ')[0]}`;
  const diasLaborables = p.dias.filter((d) => d.trabaja);
  const todasIguales = diasLaborables.every((d) => d.horaEntrada === diasLaborables[0]?.horaEntrada);

  const setSemana = (hora: '08:00' | '09:00') => {
    mut.mutate(
      { fechas: diasLaborables.map((d) => d.fecha), hora },
      { onSuccess: () => toast.success(`${nombreCorto}: entrada semanal fijada a las ${hora}`) },
    );
  };
  const toggleDia = (d: DiaEntrada) => {
    const nueva = d.horaEntrada === '08:00' ? '09:00' : '08:00';
    mut.mutate({ fechas: [d.fecha], hora: nueva });
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-2xs"
            style={{ backgroundColor: p.colorAvatar || '#0044ab' }}
          >
            {iniciales}
          </div>
          <div>
            <p className="text-xs font-bold text-on-surface">{nombreCorto}</p>
            <p className="text-[10px] text-on-surface-variant/70 font-mono">
              {diasLaborables.length} días laborables esta semana
            </p>
          </div>
        </div>

        {/* Acción de semana completa */}
        <div className="flex items-center gap-1.5 bg-surface-container-low p-1 rounded-xl border border-outline-variant/30">
          <span className="text-[10px] font-bold text-on-surface-variant px-2">Toda la semana:</span>
          {(['08:00', '09:00'] as const).map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setSemana(h)}
              disabled={mut.isPending || (todasIguales && p.dias[0]?.horaEntrada === h)}
              className="px-3 py-1 text-xs font-bold rounded-lg bg-surface-container-lowest border border-outline-variant/40 text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-all cursor-pointer shadow-2xs"
            >
              {h}
            </button>
          ))}
        </div>
      </div>

      {/* 5 días Lun-Vie */}
      <div className="grid grid-cols-5 gap-2">
        {p.dias.map((d) => {
          if (!d.trabaja) {
            return (
              <div
                key={d.fecha}
                title={`${DIA_LABEL[d.diaSemana]} ${format(parseISO(d.fecha), 'd MMM', { locale: es })} · no trabaja este día`}
                className="flex flex-col items-center justify-center py-2.5 rounded-xl border border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant/40 select-none cursor-not-allowed"
              >
                <span className="text-[10px] font-bold uppercase">{DIA_LABEL[d.diaSemana]}</span>
                <span className="text-[10px] font-semibold">Libre</span>
              </div>
            );
          }
          const es8 = d.horaEntrada === '08:00';
          return (
            <button
              key={d.fecha}
              type="button"
              onClick={() => toggleDia(d)}
              disabled={mut.isPending}
              title={`${DIA_LABEL[d.diaSemana]} ${format(parseISO(d.fecha), 'd MMM', { locale: es })} · clic para cambiar a ${es8 ? '09:00' : '08:00'}`}
              className={cn(
                'flex flex-col items-center justify-center py-2.5 rounded-xl border transition-all cursor-pointer shadow-2xs disabled:opacity-50',
                es8
                  ? 'bg-[#0044ab]/10 border-[#0044ab]/40 text-[#0044ab]'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-800'
              )}
            >
              <span className="text-[10px] font-bold uppercase">{DIA_LABEL[d.diaSemana]}</span>
              <span className="text-xs font-bold font-mono">{d.horaEntrada}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Panel "Día especial": marcar qué podólogas vienen un domingo/feriado habilitado ──
function PanelDiaEspecial({ sedeId }: { sedeId: string }) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState('');

  const { data, isFetching } = useQuery({
    queryKey: ['personal-excepcion', sedeId, fecha],
    queryFn: () => profesionalesApi.personalExcepcion(sedeId, fecha),
    enabled: !!sedeId && !!fecha,
  });

  const mut = useMutation({
    mutationFn: ({ id, presente, hora }: { id: string; presente: boolean; hora?: '08:00' | '09:00' }) =>
      profesionalesApi.setPresenciaExcepcion(id, sedeId, fecha, presente, hora),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal-excepcion', sedeId, fecha] });
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['disponibilidad'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-5 shadow-xs space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-800 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-lg">event_available</span>
        </div>
        <div>
          <h3 className="text-xs font-bold text-on-surface uppercase tracking-wider">
            Día especial (domingo o feriado habilitado)
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Define qué podólogas asistirán a laborar en un domingo o feriado que habilitaste como excepción de sede.
          </p>
        </div>
      </div>

      <input
        type="date"
        className="w-full p-3 bg-surface-container-lowest border border-outline-variant/60 rounded-xl text-xs font-semibold text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-2xs"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
      />

      {!fecha ? null : isFetching && !data ? (
        <p className="text-xs text-on-surface-variant italic">Cargando disponibilidad…</p>
      ) : !data?.abierto ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 font-medium">
          Ese día la sede <strong>no está habilitada</strong>. Ábrelo primero en las Excepciones de la Sede.
        </div>
      ) : (
        <div className="space-y-2 pt-2 border-t border-outline-variant/30">
          <p className="text-xs font-bold text-emerald-800">
            La sede atiende ese día de {data.apertura} a {data.cierre}. Marca al personal presente:
          </p>
          {data.podologas.length === 0 ? (
            <p className="text-xs text-on-surface-variant italic">No hay podólogas asignadas a esta sede.</p>
          ) : (
            data.podologas.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-surface-container-low/50 border border-outline-variant/40 rounded-xl">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => mut.mutate({ id: p.id, presente: !p.presente, hora: p.horaEntrada as '08:00' | '09:00' })}
                    disabled={mut.isPending}
                    className={cn(
                      'w-5 h-5 rounded-md border flex items-center justify-center text-xs shrink-0 transition-colors cursor-pointer',
                      p.presente ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-surface-container-lowest border-outline-variant text-transparent'
                    )}
                  >
                    ✓
                  </button>
                  <span className="text-xs font-bold text-on-surface">{p.nombres} {p.apellidos}</span>
                </div>
                {p.presente && (
                  <div className="flex gap-1.5">
                    {(['08:00', '09:00'] as const).map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => mut.mutate({ id: p.id, presente: true, hora: h })}
                        disabled={mut.isPending || p.horaEntrada === h}
                        className={cn(
                          'px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer',
                          p.horaEntrada === h
                            ? 'bg-primary text-white border-primary shadow-2xs'
                            : 'bg-surface-container-lowest border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high'
                        )}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Contenido de la pestaña "Ajustes por fecha" ────────────────────────────────
export function AjustesFechaContent({
  overrideSedeId,
  hideSedeTabs = false,
}: {
  overrideSedeId?: string;
  hideSedeTabs?: boolean;
}) {
  const [sedeSelId, setSedeSelId] = useState('');
  const [semanaRef, setSemanaRef] = useState<string>(hoyISO());

  const { data: sedes = [] } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const sedeId = overrideSedeId || sedeSelId || sedes[0]?.id || '';

  const { data, isLoading } = useQuery({
    queryKey: ['horarios-entrada', sedeId, semanaRef],
    queryFn: () => profesionalesApi.listarHorariosEntrada(sedeId, semanaRef),
    enabled: !!sedeId,
  });

  const rangoSemana = data
    ? `${format(parseISO(data.semana.lunes), "d 'de' MMM", { locale: es })} – ${format(parseISO(data.semana.viernes), "d 'de' MMM yyyy", { locale: es })}`
    : '';
  const esSemanaActual = data ? parseISO(data.semana.lunes) <= new Date() && new Date() <= addDays(parseISO(data.semana.viernes), 3) : false;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Tabs de sede (Si no están ocultos) */}
      {!hideSedeTabs && (
        <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-1.5 shadow-xs overflow-x-auto">
          <div className="flex items-center min-w-max gap-1">
            {sedes.map((s) => {
              const act = sedeId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSedeSelId(s.id)}
                  className={cn(
                    'px-5 py-2 rounded-lg font-label-caps text-label-caps transition-all cursor-pointer relative',
                    act
                      ? 'bg-surface-container-high text-on-surface font-bold shadow-xs'
                      : 'hover:bg-surface-container-low text-on-surface-variant'
                  )}
                >
                  {s.nombre}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Banner Informativo */}
      <div className="bg-[#0044ab]/5 border border-[#0044ab]/20 rounded-2xl p-4 flex items-start gap-3 shadow-2xs">
        <div className="w-8 h-8 rounded-xl bg-[#0044ab]/10 text-[#0044ab] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-lg">schedule</span>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Define la hora de entrada de cada podóloga (Lun–Vie). Usa <strong className="text-on-surface">“Toda la semana”</strong> para fijar los 5 días de una vez, o haz <strong className="text-on-surface">clic en un día</strong> para un ajuste puntual (azul = 8:00, ámbar = 9:00).
        </p>
      </div>

      {/* Selector de semana */}
      <div className="bg-surface-container-lowest border border-outline-variant/60 rounded-2xl p-4 flex items-center justify-between shadow-xs">
        <button
          type="button"
          onClick={() => setSemanaRef(format(addDays(parseISO(semanaRef), -7), 'yyyy-MM-dd'))}
          className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
        >
          <span className="material-symbols-outlined text-base">chevron_left</span>
          Anterior
        </button>

        <div className="text-center">
          <p className="text-xs font-bold text-on-surface capitalize font-mono">{rangoSemana || '—'}</p>
          {esSemanaActual && (
            <span className="text-[10px] font-bold text-primary px-2 py-0.5 bg-primary/10 rounded-full">
              Semana actual
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!esSemanaActual && (
            <button
              type="button"
              onClick={() => setSemanaRef(hoyISO())}
              className="px-3 py-1.5 text-xs font-bold text-primary bg-primary/10 rounded-xl hover:bg-primary/20 transition-colors cursor-pointer"
            >
              Hoy
            </button>
          )}
          <button
            type="button"
            onClick={() => setSemanaRef(format(addDays(parseISO(semanaRef), 7), 'yyyy-MM-dd'))}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
          >
            Siguiente
            <span className="material-symbols-outlined text-base">chevron_right</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs font-semibold text-on-surface-variant/70">
          Cargando horarios de entrada…
        </div>
      ) : !data || data.podologas.length === 0 ? (
        <div className="p-12 text-center text-xs font-semibold text-on-surface-variant/70 bg-surface-container-lowest rounded-2xl border border-outline-variant/40">
          No hay podólogas registradas en esta sede.
        </div>
      ) : (
        <div className="space-y-3">
          {data.podologas.map((p) => (
            <FilaPodologa key={p.id} p={p} sedeId={sedeId} semanaRef={semanaRef} />
          ))}
        </div>
      )}

      {sedeId && <PanelDiaEspecial sedeId={sedeId} />}
    </div>
  );
}
