import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { historiaClinicaApi, type AtencionCompleta } from '../../api/historiaClinica';
import type { MarcaCorporal } from './cuerpo3dModelo';
import type { EscalaAnterior } from './EscalaPunto';
import { useGuardadoSolo } from './useGuardadoSolo';

/** Capa del mapa corporal dentro de `dibujosSilueta` (vista «cuerpo3d»; ver bloque3Service.guardarMapaCorporal). */
export function marcasCorporalesDe(a: Pick<AtencionCompleta, 'dibujosSilueta'> | null | undefined): MarcaCorporal[] {
  const capa = (a?.dibujosSilueta ?? []).find((d) => (d.vista as string) === 'cuerpo3d');
  return Array.isArray(capa?.anotaciones) ? (capa!.anotaciones as unknown as MarcaCorporal[]) : [];
}

/**
 * Los hallazgos del mapa corporal de una atención y su guardado automático (ver `useGuardadoSolo`). Lo usan la pestaña
 * «Cuerpo 3D» y el resumen de escalas por punto de la atención: las dos pantallas editan la MISMA lista.
 */
export function useMapaCorporal(a: AtencionCompleta, puedeRegistrar: boolean) {
  const g = useGuardadoSolo<MarcaCorporal[]>(a, puedeRegistrar, {
    leer: marcasCorporalesDe,
    fuente: a.dibujosSilueta,
    guardar: (id, m) => historiaClinicaApi.guardarMapaCorporal(id, m),
    queNoSeGuardo: 'No se guardó el mapa corporal',
  });
  return { marcas: g.valor, cambiar: g.cambiar, estado: g.estado, textoEstado: g.textoEstado, editable: g.editable };
}

/**
 * Escala del MISMO punto (zona + hallazgo) en la sesión anterior del paciente, para decir si mejoró. Se busca en la atención
 * más reciente, anterior a esta, donde ese punto tuvo escala; primero en la misma capa (piel / músculos) y si no, en la otra.
 */
export function useEscalaAnterior(a: AtencionCompleta): (m: MarcaCorporal) => EscalaAnterior | null {
  const { data: historial = [] } = useQuery({
    queryKey: ['mapa-corporal-historial', a.pacienteId],
    queryFn: () => historiaClinicaApi.historialMapaCorporal(a.pacienteId),
    staleTime: 60_000,
  });
  return useMemo(() => {
    // Vienen de la más antigua a la más nueva: se recorren al revés y se descarta esta atención y las posteriores.
    const previas = [...historial].reverse().filter((x) => x.atencionId !== a.id && x.fecha <= a.fecha);
    return (m: MarcaCorporal) => {
      for (const x of previas) {
        const iguales = x.marcas.filter((p) => p.zona === m.zona && p.tipo === m.tipo && p.intensidad != null);
        const p = iguales.find((q) => (q.capa ?? null) === (m.capa ?? null)) ?? iguales[0];
        if (p) return { valor: p.intensidad as number, fecha: x.fecha };
      }
      return null;
    };
  }, [historial, a.id, a.fecha]);
}
