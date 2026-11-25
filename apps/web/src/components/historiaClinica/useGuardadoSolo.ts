import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { atencionKey, type AtencionCompleta } from '../../api/historiaClinica';

export type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando' | 'error';
const TEXTO: Record<EstadoGuardado, string> = { guardado: 'Guardado', pendiente: 'Cambios sin guardar…', guardando: 'Guardando…', error: 'No se guardó: revisa la conexión' };

/**
 * Una parte de la atención que se guarda SOLA (al segundo de dejar de tocar), sin botón: así no se pierde nada si se corta el
 * wifi de la tablet, y si se sale con algo pendiente, se manda al salir. Lo usan el mapa corporal y el tratamiento de fisio.
 *
 *  · `leer`: saca el valor de la atención que llega del servidor.
 *  · `fuente`: la parte de la atención de la que sale (cuando cambia, se vuelve a leer…).
 *  · …salvo que aquí haya un cambio sin mandar o viajando, o que el cambio sea la respuesta a NUESTRO guardado: lo que la
 *    persona está escribiendo no se pisa con lo que devuelve el servidor (que recorta espacios).
 */
export function useGuardadoSolo<T>(a: AtencionCompleta, puedeRegistrar: boolean, o: {
  leer: (a: AtencionCompleta) => T;
  fuente: unknown;
  guardar: (atencionId: string, valor: T) => Promise<AtencionCompleta>;
  queNoSeGuardo: string;
}) {
  const qc = useQueryClient();
  const leerRef = useRef(o.leer); leerRef.current = o.leer;
  const [valor, setValor] = useState<T>(() => o.leer(a));
  const [estado, setEstado] = useState<EstadoGuardado>('guardado');
  const pendienteRef = useRef<{ v: T } | null>(null);
  const enVuelo = useRef(0);
  const propia = useRef<AtencionCompleta | null>(null); // la atención que devolvió nuestro último guardado
  const timer = useRef<number | undefined>(undefined);
  const editable = puedeRegistrar && a.estado === 'abierta';

  // Otra atención → se carga lo suyo.
  useEffect(() => { setValor(leerRef.current(a)); setEstado('guardado'); pendienteRef.current = null; }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // La misma atención llega de nuevo del servidor (se editó desde otra pantalla, o esta se abrió antes de que terminara de guardar).
  useEffect(() => {
    if (pendienteRef.current || enVuelo.current > 0 || a === propia.current) return;
    setValor(leerRef.current(a));
  }, [o.fuente]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardarMut = useMutation({
    mutationFn: (v: T) => { enVuelo.current++; return o.guardar(a.id, v); },
    onSettled: () => { enVuelo.current = Math.max(0, enVuelo.current - 1); },
    onSuccess: (at) => {
      propia.current = at;
      qc.setQueryData(atencionKey(a.id), at);
      if (!pendienteRef.current) setEstado('guardado');
    },
    onError: (e: Error) => { setEstado('error'); toast.error(`${o.queNoSeGuardo}: ${e.message}`); },
  });
  const guardarRef = useRef(guardarMut.mutate);
  guardarRef.current = guardarMut.mutate;

  const cambiar = useCallback((v: T) => {
    setValor(v);
    setEstado('pendiente');
    pendienteRef.current = { v };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const porGuardar = pendienteRef.current;
      pendienteRef.current = null;
      if (porGuardar) { setEstado('guardando'); guardarRef.current(porGuardar.v); }
    }, 900);
  }, []);
  // Al salir de la pantalla con un cambio sin mandar, se manda ya.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (pendienteRef.current) guardarRef.current(pendienteRef.current.v);
  }, []);

  return { valor, cambiar, estado, textoEstado: TEXTO[estado], editable };
}
