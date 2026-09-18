// Dictado de TODA la consulta con un solo micrófono (idea del doctor): el reconocedor es el
// mismo de useDictado; aquí se decide a qué campo va cada frase según las palabras clave y cómo
// empieza la frase (utils/dictadoEstructurado.ts). Los destinos son los setters del formulario de
// evolución, el detalle del procedimiento y el buscador de diagnósticos.
//
// CÓMO SE ESCRIBE (y por qué así). `useDictado` entrega SIEMPRE todo lo dictado desde que se
// encendió el micrófono, no la última frase, porque el navegador reenvía su lista una y otra vez
// (y en Android da por terminado cada pedacito de frase). Así que aquí no se SUMA nada: en cada
// aviso se vuelve a repartir todo el texto y se ESCRIBE ENCIMA de los campos, sobre lo que había
// antes de encender el micrófono. Es como trabaja el cuadro de dictado del teclado o de YouTube.
// Consecuencia: por más que el navegador repita, la nota no puede quedar con una frase dos veces.
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Dictado } from './useDictado';
import {
  lineasDeTranscripcion, repartirSegmentos, unirFrase,
  type DiagnosticoDictado, type LesionDictada, type ParteDictado, type PropuestaDictado, type SeccionDictado,
} from '../utils/dictadoEstructurado';

/** Id de "campo" que ocupa el reconocedor mientras dicta la consulta (bloquea los mics por campo). */
export const CAMPO_CONSULTA = 'consulta';

type Setter = Dispatch<SetStateAction<string>>;
/** Campos de texto que llena el dictado (el resto son acciones: diagnóstico y lesión). */
export type CampoDestino = 'subjetivo' | 'objetivo' | 'apreciacion' | 'plan' | 'observacion' | 'procedimiento';
export interface DestinosDictado {
  setSubjetivo: Setter; setObjetivo: Setter; setApreciacion: Setter; setPlan: Setter; setObservacion: Setter;
  setProcedimiento: Setter;
  /** Se llama con el texto del procedimiento para adivinar el tipo (láser, espiculectomía…). */
  onTextoProcedimiento?: (texto: string) => void;
  onDiagnostico: (d: DiagnosticoDictado) => void;
  onLesion: (l: LesionDictada) => void;
}

/**
 * `transcripcionInicial` = lo que ya estaba guardado de esta atención (se sigue dictando encima).
 * `onTranscripcion` se llama con el texto COMPLETO cada vez que cambia; quien lo recibe decide
 * cuándo guardarlo (el servicio lo hace con un pequeño retardo, para no escribir en cada frase).
 */
export function useDictadoConsulta(
  dictado: Dictado,
  destinos: DestinosDictado,
  persistencia: { clave?: string | null; transcripcionInicial?: string; onTranscripcion?: (texto: string) => void } = {},
) {
  // Transcripción cruda: UNA LÍNEA POR FRASE (así se vuelve a repartir igual que en vivo).
  const [transcripcion, setTranscripcion] = useState(persistencia.transcripcionInicial ?? '');
  const transcripcionRef = useRef(transcripcion);
  const onTranscripcionRef = useRef(persistencia.onTranscripcion);
  onTranscripcionRef.current = persistencia.onTranscripcion;
  const inicial = persistencia.transcripcionInicial ?? '';
  const inicialRef = useRef(inicial);
  inicialRef.current = inicial;
  /** Lo que había dictado ANTES de encender el micrófono: lo nuevo se escribe a continuación. */
  const baseTranscripcionRef = useRef('');

  const adoptar = useCallback((texto: string) => {
    transcripcionRef.current = texto;
    baseTranscripcionRef.current = texto;
    setTranscripcion(texto);
  }, []);
  // Al cambiar de ATENCIÓN se parte de lo que esa atención tenga guardado.
  const clave = persistencia.clave ?? null;
  useEffect(() => { adoptar(inicialRef.current); }, [clave, adoptar]);
  // Lo guardado en el servidor solo se adopta si en pantalla no hay nada dictado (p. ej. al entrar o
  // tras recargar). NUNCA pisa lo que se está dictando: la respuesta del autoguardado llega con el
  // texto de hace un instante y borraría las frases dichas mientras se guardaba.
  useEffect(() => { if (inicial && !transcripcionRef.current.trim()) adoptar(inicial); }, [inicial, adoptar]);

  const [seccion, setSeccion] = useState<SeccionDictado>('subjetivo');
  const seccionRef = useRef<SeccionDictado>('subjetivo');
  const destinosRef = useRef(destinos);
  destinosRef.current = destinos;
  // Cuántas frases fueron a cada sección y a dónde fue cada una (se ve mientras se dicta).
  const [entregas, setEntregas] = useState<Partial<Record<SeccionDictado, number>>>({});
  const [ultimas, setUltimas] = useState<ParteDictado[]>([]);

  const activo = dictado.activo === CAMPO_CONSULTA;

  // ── Estado del reparto en vivo ──────────────────────────────────────────────────────────────
  /**
   * Texto de cada campo cuando se encendió el micrófono: lo dictado se escribe SIEMPRE a
   * continuación de eso. Al ser una función de (base + lo dictado), el campo se arregla solo si
   * algo lo pisa (p. ej. la pantalla recarga la atención mientras se dicta).
   */
  const baseCamposRef = useRef<Partial<Record<CampoDestino, string>>>({});
  /** Diagnósticos y lesiones ya avisados (son acciones: no se pueden reescribir). */
  const emitidosRef = useRef({ diagnosticos: 0, lesiones: 0 });
  /**
   * Cambios de sección hechos a mano con los chips: desde esa línea en adelante manda la sección
   * elegida. Se guardan como cortes para que el reparto siga siendo una función del texto.
   */
  const cortesRef = useRef<{ linea: number; seccion: SeccionDictado }[]>([]);

  /** Toma nota de lo que hay en cada campo justo antes de empezar a dictar. */
  const prepararTanda = useCallback(() => {
    baseCamposRef.current = {};
    emitidosRef.current = { diagnosticos: 0, lesiones: 0 };
    cortesRef.current = [];
    const d = destinosRef.current;
    const anotar = (campo: CampoDestino, setter: Setter) => setter((prev) => { baseCamposRef.current[campo] = prev; return prev; });
    anotar('subjetivo', d.setSubjetivo); anotar('objetivo', d.setObjetivo); anotar('apreciacion', d.setApreciacion);
    anotar('plan', d.setPlan); anotar('observacion', d.setObservacion); anotar('procedimiento', d.setProcedimiento);
  }, []);

  const cambiarSeccion = useCallback((s: SeccionDictado) => {
    seccionRef.current = s;
    setSeccion(s);
    if (dictado.activo === CAMPO_CONSULTA) {
      // Lo que se dicte a partir de ahora va a esa sección, sin tocar lo ya repartido.
      const dichas = lineasDeTranscripcion(transcripcionRef.current).length - lineasDeTranscripcion(baseTranscripcionRef.current).length;
      cortesRef.current = [...cortesRef.current.filter((c) => c.linea < dichas), { linea: Math.max(0, dichas), seccion: s }];
    }
  }, [dictado.activo]);

  /**
   * Escribe en el campo lo que había antes de dictar MÁS lo que le toca de lo dictado. No mira lo
   * que hay ahora a propósito: escribir siempre lo mismo es lo que hace imposible que una frase
   * entre dos veces. Mientras el micrófono está encendido, el campo lo maneja el dictado; para
   * corregir a mano, primero se apaga (o se corrige después, que es lo normal).
   */
  const escribirCampo = useCallback((campo: CampoDestino, setter: Setter, propuesto: string) => {
    setter((prev) => unirFrase(baseCamposRef.current[campo] ?? prev, propuesto));
  }, []);

  /** Reparte TODO lo dictado y lo escribe encima de los campos. Es idempotente: se puede repetir. */
  const proyectar = useCallback((dictadoNuevo: string) => {
    const d = destinosRef.current;
    const lineas = lineasDeTranscripcion(dictadoNuevo);
    // Segmentos separados por los cambios de sección hechos a mano con los chips.
    const cortes = [{ linea: 0, seccion: 'subjetivo' as SeccionDictado }, ...cortesRef.current].filter((c, i, a) => i === 0 || c.linea > a[i - 1]!.linea);
    const segmentos = cortes.map((c, i) => ({
      texto: lineas.slice(c.linea, cortes[i + 1]?.linea ?? lineas.length).join('\n'),
      inicial: c.seccion,
    }));
    const propuesta: PropuestaDictado = repartirSegmentos(segmentos);

    escribirCampo('subjetivo', d.setSubjetivo, propuesta.campos.subjetivo);
    escribirCampo('objetivo', d.setObjetivo, propuesta.campos.objetivo);
    escribirCampo('apreciacion', d.setApreciacion, propuesta.campos.apreciacion);
    escribirCampo('plan', d.setPlan, propuesta.campos.plan);
    escribirCampo('observacion', d.setObservacion, propuesta.campos.observacion);
    escribirCampo('procedimiento', d.setProcedimiento, propuesta.campos.procedimiento);
    if (propuesta.campos.procedimiento.trim()) d.onTextoProcedimiento?.(propuesta.campos.procedimiento);

    // Diagnósticos y lesiones son acciones (abren el buscador, marcan el podograma): solo los nuevos.
    for (const dx of propuesta.diagnosticos.slice(emitidosRef.current.diagnosticos)) d.onDiagnostico(dx);
    emitidosRef.current.diagnosticos = propuesta.diagnosticos.length;
    for (const l of propuesta.lesiones.slice(emitidosRef.current.lesiones)) d.onLesion(l);
    emitidosRef.current.lesiones = propuesta.lesiones.length;

    setEntregas(propuesta.frases);
    setUltimas(propuesta.partes.slice(-12));
    if (propuesta.seccion !== seccionRef.current) { seccionRef.current = propuesta.seccion; setSeccion(propuesta.seccion); }
  }, [escribirCampo]);

  /** Recibe TODO lo dictado desde que se encendió el micrófono (no la última frase). */
  const recibir = useCallback((todoLoDictado: string) => {
    const base = baseTranscripcionRef.current;
    const texto = base.trim() ? `${base.replace(/\s+$/, '')}\n${todoLoDictado}` : todoLoDictado;
    transcripcionRef.current = texto;
    setTranscripcion(texto);
    onTranscripcionRef.current?.(texto);
    proyectar(todoLoDictado);
  }, [proyectar]);

  /** Editar o limpiar a mano la transcripción (el profesional corrige lo que el micrófono entendió mal). */
  const cambiarTranscripcion = useCallback((texto: string) => {
    // Con el micrófono encendido el texto se redibuja solo: se apaga para no pisar la corrección.
    if (dictado.activo === CAMPO_CONSULTA) dictado.detener();
    transcripcionRef.current = texto;
    baseTranscripcionRef.current = texto;
    setTranscripcion(texto);
    onTranscripcionRef.current?.(texto);
  }, [dictado]);

  const alternar = useCallback(() => {
    if (!activo) {
      // Empieza una tanda nueva: lo dictado se escribirá a continuación de lo que haya ahora.
      baseTranscripcionRef.current = transcripcionRef.current;
      seccionRef.current = 'subjetivo';
      setSeccion('subjetivo');
      prepararTanda();
      setEntregas({});
      setUltimas([]);
    }
    dictado.alternar(CAMPO_CONSULTA, recibir);
  }, [activo, dictado, recibir, prepararTanda]);

  // Al apagar el micrófono, lo dictado queda como base: si se vuelve a encender, se sigue debajo.
  useEffect(() => { if (!activo) baseTranscripcionRef.current = transcripcionRef.current; }, [activo]);

  return {
    soportado: dictado.soportado, contextoSeguro: dictado.contextoSeguro,
    activo, seccion, cambiarSeccion, alternar, detener: dictado.detener,
    parcial: activo ? dictado.parcial : '', entregas,
    ultimas, ultima: ultimas[ultimas.length - 1] ?? null,
    // Diagnóstico del navegador + a qué sección fue cada frase (para revisar un caso raro).
    diagnostico: () => {
      const base = JSON.parse(dictado.diagnostico()) as Record<string, unknown>;
      return JSON.stringify({ ...base, repartoPorSeccion: ultimas }, null, 1);
    },
    transcripcion, cambiarTranscripcion,
  };
}

export type DictadoConsulta = ReturnType<typeof useDictadoConsulta>;
