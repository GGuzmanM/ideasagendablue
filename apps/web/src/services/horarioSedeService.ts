import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import toast from 'react-hot-toast';
import { horariosApi, type HorarioDia, type HorarioSede, type Excepcion } from '../api';

// ── Constantes de dominio ────────────────────────────────────────────────────
export const DIAS_ABREV = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const DIAS_FULL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
export const HORAS_SLOT = [
  '07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30',
  '17:00','17:30','18:00','18:30','19:00','19:30','20:00',
];
export const PRESETS_CIERRE = ['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

// Próximas 4 semanas para selector rápido de fecha de excepción.
export function proximasFechas(dias = 28): Date[] {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Array.from({ length: dias }, (_, i) => addDays(hoy, i));
}

// ── Hook principal: agrupa data + mutations del horario de una sede ──────────
export function useHorarioSede(sedeId: string) {
  const qc = useQueryClient();
  const hoyStr = format(new Date().setHours(0, 0, 0, 0), 'yyyy-MM-dd');
  const desdeStr = hoyStr;
  const hastaStr = format(addDays(new Date().setHours(0, 0, 0, 0), 60), 'yyyy-MM-dd');

  const { data: horarioData } = useQuery({
    queryKey: ['horario', sedeId, hoyStr],
    queryFn: () => horariosApi.efectivo(sedeId, hoyStr),
    enabled: !!sedeId,
  });

  const { data: excepciones = [] } = useQuery({
    queryKey: ['excepciones', sedeId, desdeStr],
    queryFn: () => horariosApi.excepciones(sedeId, desdeStr, hastaStr),
    enabled: !!sedeId,
  });

  // Invalidaciones compartidas: horario, excepciones y turnos de profesionales
  // (una excepción cambia el fin de turno; sin refrescar, la agenda muestra
  // "Fin de turno" viejo y bloquea horas extra).
  const invalidarTodo = () => {
    qc.invalidateQueries({ queryKey: ['horario', sedeId] });
    qc.invalidateQueries({ queryKey: ['excepciones', sedeId] });
    qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
  };

  const guardarMut = useMutation({
    mutationFn: (data: {
      fecha: string;
      abierto: boolean;
      horaApertura: string | null;
      horaCierre: string | null;
      nota: string | null;
    }) => horariosApi.guardarExcepcion(sedeId, data),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Excepción guardada');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: (fecha: string) => horariosApi.eliminarExcepcion(sedeId, fecha),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Excepción eliminada — vuelve al horario normal');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Guarda el HORARIO BASE semanal (apertura/cierre por día). Cambia las franjas reservables de
  // TODOS los días de ese tipo desde ya (a diferencia de una excepción, que es de una fecha puntual).
  const guardarBaseMut = useMutation({
    mutationFn: (horario: HorarioSede) => horariosApi.guardarBase(sedeId, horario),
    onSuccess: () => {
      invalidarTodo();
      toast.success('Horario base actualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    horarioEfectivo: horarioData?.efectivo,
    horarioDefault: (horarioData?.horarioDefault ?? {}) as Record<string, HorarioDia>,
    excepciones: (excepciones ?? []) as Excepcion[],
    guardarExcepcion: guardarMut.mutate,
    eliminarExcepcion: eliminarMut.mutate,
    guardarBase: guardarBaseMut.mutate,
    isGuardando: guardarMut.isPending,
    isEliminando: eliminarMut.isPending,
    isGuardandoBase: guardarBaseMut.isPending,
  };
}

// ── Form state para el modal de excepciones ───────────────────────────────────
// Se separa del hook de data para que su ciclo de vida siga al modal (no a la
// sede): abrir y cerrar el modal reinicia el form.
export function useFormExcepcion() {
  const hoyStr = format(new Date().setHours(0, 0, 0, 0), 'yyyy-MM-dd');
  const [fecha, setFecha] = useState(hoyStr);
  const [abierto, setAbierto] = useState(true);
  const [apertura, setApertura] = useState('08:00');
  const [cierre, setCierre] = useState('18:00');
  const [nota, setNota] = useState('');

  const reset = () => {
    setFecha(hoyStr);
    setAbierto(true);
    setApertura('08:00');
    setCierre('18:00');
    setNota('');
  };

  // Regla: si está abierto, la apertura debe ser menor a la de cierre. Guardar
  // apertura ≥ cierre dejaría la agenda en blanco ese día.
  const rangoInvalido = abierto && apertura >= cierre;

  return {
    fecha, setFecha,
    abierto, setAbierto,
    apertura, setApertura,
    cierre, setCierre,
    nota, setNota,
    reset,
    rangoInvalido,
    toPayload: () => ({
      fecha,
      abierto,
      horaApertura: abierto ? apertura : null,
      horaCierre: abierto ? cierre : null,
      nota: nota.trim() || null,
    }),
  };
}
