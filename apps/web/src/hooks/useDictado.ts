// Dictado por voz (1.6 de la lista "plus" del doctor): reconocimiento de voz del NAVEGADOR
// (Web Speech API) en español peruano, sin servidor propio ni clave de API.
//
//  · Soporte: Chrome y Edge (escritorio y Android) y Safari (iPad/iPhone). Firefox no.
//  · Requiere contexto seguro: funciona en localhost y en HTTPS; por http://IP-de-la-red el
//    navegador NO deja usar el micrófono. En producción hace falta HTTPS.
//  · Privacidad: en Chrome/Edge el audio lo procesan los servidores de Google/Microsoft; en
//    Safari, Apple. No se envía nombre ni DNI, solo lo que se dicta, pero es dato clínico →
//    la clínica debe aceptar ese tratamiento (Ley 29733). Es opt-in: solo cuando se toca el mic.
//  · Un solo reconocedor a la vez: `activo` = id del campo que está dictando.
//  · CÓMO SE ENTREGA EL TEXTO (importante): `onTexto` recibe SIEMPRE todo lo dicho desde que se
//    encendió el micrófono, no la última frase. Quien lo recibe REEMPLAZA su texto, no lo suma.
//    Es como trabaja el cuadro de dictado del teclado o el de YouTube, y es la única forma de que
//    el navegador no acabe escribiendo la misma frase varias veces: la Web Speech API reenvía en
//    cada aviso toda la lista de lo dicho, y en Android da por terminado cada pedacito de frase.
//    Lo que se está oyendo y aún no es definitivo se expone aparte, en `parcial`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { anexarDictado, fusionarDictado } from '../utils/dictadoEstructurado';
import { leerEspejo, type EventoVoz } from '../utils/vozResultados';

// Vive en utils (pura, sin React) porque el reparto de toda la transcripción también la usa.
export { anexarDictado };
import toast from 'react-hot-toast';

interface Reconocedor {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: EventoVoz) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type CtorVoz = new () => Reconocedor;

function ctorDisponible(): CtorVoz | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: CtorVoz; webkitSpeechRecognition?: CtorVoz };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}


export function useDictado() {
  const soportado = ctorDisponible() !== null;
  // Sin HTTPS (salvo localhost) el navegador bloquea el micrófono.
  const contextoSeguro = typeof window === 'undefined' || window.isSecureContext;
  const [activo, setActivo] = useState<string | null>(null);
  const [parcial, setParcial] = useState('');
  const recRef = useRef<Reconocedor | null>(null);
  const onTextoRef = useRef<((t: string) => void) | null>(null);
  const detenidoManualRef = useRef(false);
/** TODO lo dictado desde que se encendió el micrófono (es lo que se entrega en cada aviso). */
  const totalRef = useRef('');
  /** Frases oídas hasta ahora, para el panel «Lo que se escuchó» y el diagnóstico de la tablet. */
  const [escuchado, setEscuchado] = useState<string[]>([]);
  /**
   * Últimos eventos CRUDOS del navegador (resumidos). No se puede reproducir un dictado real en
   * pruebas automáticas —el reconocedor es del navegador y su servicio de voz no acepta audio
   * inyectado—, así que si algo se oye raro en la tablet, «Copiar diagnóstico» manda esto y se
   * puede reproducir el caso exacto contra el acumulador. Se mantienen los últimos 80.
   */
  const crudosRef = useRef<{ t: number; resultIndex: number; items: { f: boolean; txt: string }[] }[]>([]);
  const [eventosCrudos, setEventosCrudos] = useState(0);

  const detener = useCallback(() => {
    detenidoManualRef.current = true;
    try { recRef.current?.stop(); } catch { /* ya detenido */ }
    recRef.current = null;
    onTextoRef.current = null;
    setActivo(null);
    setParcial('');
  }, []);

  const iniciar = useCallback((campo: string, onTexto: (t: string) => void) => {
    const Ctor = ctorDisponible();
    if (!Ctor) { toast.error('Tu navegador no soporta dictado por voz. Usa Chrome, Edge o Safari.'); return; }
    if (!contextoSeguro) { toast.error('El micrófono solo funciona por HTTPS (o en localhost).'); return; }
    // Brave expone la API pero bloquea el servicio de voz de Google → siempre falla con "network".
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    if (nav.brave?.isBrave) { toast.error('Brave bloquea el servicio de voz. Usa Google Chrome o Microsoft Edge, o dicta con Win + H.'); return; }
    if (recRef.current) detener();
    const rec = new Ctor();
    rec.lang = 'es-PE';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    onTextoRef.current = onTexto;
    detenidoManualRef.current = false;
    setEscuchado([]);
    crudosRef.current = [];
    setEventosCrudos(0);
    totalRef.current = '';
    rec.onresult = (e: EventoVoz) => {
      crudosRef.current = [...crudosRef.current, {
        t: Math.round(performance.now()),
        resultIndex: e.resultIndex ?? -1,
        items: Array.from({ length: e.results?.length ?? 0 }, (_, i) => ({ f: !!e.results[i]?.isFinal, txt: e.results[i]?.[0]?.transcript ?? '' })),
      }].slice(-80);
      setEventosCrudos(crudosRef.current.length);
      // Espejo de la lista del navegador, fusionado con lo que ya se llevaba dictado.
      const { texto, parcial: p } = leerEspejo(e);
      const total = fusionarDictado(totalRef.current, texto);
      totalRef.current = total;
      onTextoRef.current?.(total);
      setEscuchado(total ? total.split('\n').filter(Boolean).slice(-40) : []);
      setParcial(p);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // silencio: se reintenta solo
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast.error('Permiso de micrófono denegado. Actívalo en el navegador para dictar.');
      else if (e.error === 'audio-capture') toast.error('No se encontró micrófono. Revisa que esté conectado y permitido.');
      else if (e.error === 'network') {
        // "network" lo devuelve el servicio de voz del navegador (Google en Chrome, Microsoft en Edge),
        // no nuestro sistema: sin internet, servicio bloqueado por firewall/antivirus, navegadores sin
        // ese servicio (Brave, Chromium) o el dictado en línea de Windows desactivado.
        toast.error(
          'El servicio de voz del navegador no respondió. Revisa: internet, que sea Google Chrome o Microsoft Edge (no Brave), ' +
          'y en Windows que esté activado "Reconocimiento de voz en línea" (Configuración → Privacidad → Voz). ' +
          'Alternativa inmediata: dicta con el sistema (Windows: tecla Win + H con el cursor en el campo; iPad: micrófono del teclado).',
          { duration: 12000 },
        );
      } else toast.error('El dictado se cortó. Toca el micrófono para seguir.');
      detener();
    };
    rec.onend = () => {
      // Chrome corta el modo continuo tras unos segundos de silencio: si el usuario no lo detuvo,
      // se vuelve a arrancar en silencio para que el dictado sea «hasta que lo apague». El primer
      // `start()` puede fallar porque el reconocedor todavía se está cerrando (InvalidStateError):
      // se reintenta un par de veces con un respiro antes de darse por vencido.
      if (detenidoManualRef.current || recRef.current !== rec) return;
      const reintentar = (queda: number) => {
        if (detenidoManualRef.current || recRef.current !== rec) return;
        try { rec.start(); } catch {
          if (queda > 0) setTimeout(() => reintentar(queda - 1), 400);
          else { toast.error('El dictado se cortó. Toca el micrófono para seguir.'); detener(); }
        }
      };
      reintentar(3);
    };
    recRef.current = rec;
    setActivo(campo);
    setParcial('');
    try { rec.start(); } catch { toast.error('No se pudo iniciar el dictado.'); detener(); }
  }, [contextoSeguro, detener]);

  const alternar = useCallback((campo: string, onTexto: (t: string) => void) => {
    if (activo === campo) detener(); else iniciar(campo, onTexto);
  }, [activo, detener, iniciar]);

  // Al desmontar (cambiar de pestaña/atención) se apaga el micrófono.
  useEffect(() => () => { detenidoManualRef.current = true; try { recRef.current?.stop(); } catch { /* nada */ } }, []);

  /** Texto para pegar en el chat cuando algo se oiga raro: navegador + eventos crudos + frases. */
  const diagnostico = useCallback(() => JSON.stringify({
    fecha: new Date().toISOString(),
    navegador: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    idioma: 'es-PE',
    frasesOidas: escuchado,
    eventosDelNavegador: crudosRef.current,
  }, null, 1), [escuchado]);

  return { soportado, contextoSeguro, activo, parcial, alternar, detener, escuchado, eventosCrudos, diagnostico };
}

export type Dictado = ReturnType<typeof useDictado>;
