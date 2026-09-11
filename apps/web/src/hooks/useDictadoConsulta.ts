// Dictado de TODA la consulta con un solo micrófono (idea del doctor): el reconocedor es el
// mismo de useDictado; aquí solo se decide, frase por frase, a qué campo va cada parte según
// las palabras clave (utils/dictadoEstructurado.ts). Los destinos son los setters del
// formulario de evolución, el detalle del procedimiento y el buscador de diagnósticos.
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { anexarDictado, type Dictado } from './useDictado';
import { enrutarDictado, interpretarDiagnostico, interpretarLesion, type DiagnosticoDictado, type LesionDictada, type SeccionDictado } from '../utils/dictadoEstructurado';

/** Id de "campo" que ocupa el reconocedor mientras dicta la consulta (bloquea los mics por campo). */
export const CAMPO_CONSULTA = 'consulta';

type Setter = Dispatch<SetStateAction<string>>;
export interface DestinosDictado {
  setSubjetivo: Setter; setObjetivo: Setter; setApreciacion: Setter; setPlan: Setter; setObservacion: Setter;
  onProcedimiento: (texto: string) => void;
  onDiagnostico: (d: DiagnosticoDictado) => void;
  onLesion: (l: LesionDictada) => void;
}

export function useDictadoConsulta(dictado: Dictado, destinos: DestinosDictado) {
  const [seccion, setSeccion] = useState<SeccionDictado>('subjetivo');
  const seccionRef = useRef<SeccionDictado>('subjetivo');
  const ultimaEntregadaRef = useRef<SeccionDictado | null>(null);
  const destinosRef = useRef(destinos);
  destinosRef.current = destinos;
  // Cuántas frases fueron a cada sección en esta sesión de dictado (feedback visual).
  const [entregas, setEntregas] = useState<Partial<Record<SeccionDictado, number>>>({});
  // Última frase enrutada: a qué sección fue y por qué (palabra clave, frase natural o sección vigente).
  const [ultima, setUltima] = useState<{ seccion: SeccionDictado; texto: string; pista: string | null } | null>(null);

  const activo = dictado.activo === CAMPO_CONSULTA;

  const cambiarSeccion = useCallback((s: SeccionDictado) => { seccionRef.current = s; setSeccion(s); }, []);

  const entregar = useCallback((s: SeccionDictado, texto: string) => {
    const d = destinosRef.current;
    switch (s) {
      case 'subjetivo': d.setSubjetivo((prev) => anexarDictado(prev, texto)); break;
      case 'objetivo': d.setObjetivo((prev) => anexarDictado(prev, texto)); break;
      case 'apreciacion': d.setApreciacion((prev) => anexarDictado(prev, texto)); break;
      case 'plan': d.setPlan((prev) => anexarDictado(prev, texto)); break;
      case 'indicaciones': {
        // Van al Plan; la primera frase tras entrar a la sección va en línea aparte y con rótulo.
        const nueva = ultimaEntregadaRef.current !== 'indicaciones';
        d.setPlan((prev) => anexarDictado(nueva && prev.trim() ? `${prev.replace(/\s+$/, '')}\n` : prev, nueva ? `Indicaciones: ${texto}` : texto));
        break;
      }
      case 'observacion': d.setObservacion((prev) => anexarDictado(prev, texto)); break;
      case 'procedimiento': d.onProcedimiento(texto); break;
      case 'diagnostico': d.onDiagnostico(interpretarDiagnostico(texto)); break;
      case 'lesion': d.onLesion(interpretarLesion(texto)); break;
    }
    ultimaEntregadaRef.current = s;
    setEntregas((e) => ({ ...e, [s]: (e[s] ?? 0) + 1 }));
  }, []);

  // Recibe cada frase FINAL del reconocedor.
  const procesar = useCallback((textoFinal: string) => {
    const { partes, seccion: nueva } = enrutarDictado(textoFinal, seccionRef.current);
    for (const p of partes) entregar(p.seccion, p.texto);
    const fin = partes[partes.length - 1];
    if (fin) setUltima({ seccion: fin.seccion, texto: fin.texto, pista: fin.pista ?? null });
    if (nueva !== seccionRef.current) cambiarSeccion(nueva);
  }, [entregar, cambiarSeccion]);

  const alternar = useCallback(() => {
    if (!activo) { cambiarSeccion('subjetivo'); ultimaEntregadaRef.current = null; setEntregas({}); setUltima(null); }
    dictado.alternar(CAMPO_CONSULTA, procesar);
  }, [activo, dictado, procesar, cambiarSeccion]);

  return {
    soportado: dictado.soportado, contextoSeguro: dictado.contextoSeguro,
    activo, seccion, cambiarSeccion, alternar, detener: dictado.detener,
    parcial: activo ? dictado.parcial : '', entregas, ultima,
  };
}

export type DictadoConsulta = ReturnType<typeof useDictadoConsulta>;
