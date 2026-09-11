// Dictado por voz (1.6 de la lista "plus" del doctor): reconocimiento de voz del NAVEGADOR
// (Web Speech API) en español peruano, sin servidor propio ni clave de API.
//
//  · Soporte: Chrome y Edge (escritorio y Android) y Safari (iPad/iPhone). Firefox no.
//  · Requiere contexto seguro: funciona en localhost y en HTTPS; por http://IP-de-la-red el
//    navegador NO deja usar el micrófono. En producción hace falta HTTPS.
//  · Privacidad: en Chrome/Edge el audio lo procesan los servidores de Google/Microsoft; en
//    Safari, Apple. No se envía nombre ni DNI, solo lo que se dicta, pero es dato clínico →
//    la clínica debe aceptar ese tratamiento (Ley 29733). Es opt-in: solo cuando se toca el mic.
//  · Un solo reconocedor a la vez: `activo` = id del campo que está dictando. El texto FINAL
//    de cada frase se entrega por `onTexto`; el parcial (lo que va oyendo) se expone en `parcial`.
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

type ResultadoVoz = { isFinal: boolean; 0: { transcript: string } };
type EventoVoz = { resultIndex: number; results: ArrayLike<ResultadoVoz> };
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

/** Comandos de voz mínimos: "nueva línea" / "punto y aparte" → salto de línea. */
function aplicarComandos(t: string): string {
  return t.replace(/\s*\b(nueva l[ií]nea|punto y aparte)\b\s*/gi, '\n');
}

/** Anexa lo dictado al texto existente: espacio o salto según corresponda, mayúscula inicial de frase. */
export function anexarDictado(previo: string, dictado: string): string {
  let t = aplicarComandos(dictado.trim());
  if (!t) return previo;
  const base = previo.replace(/[ \t]+$/, '');
  const finDeFrase = !base || /[.!?\n]$/.test(base);
  if (finDeFrase) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!base) return t;
  return base + (base.endsWith('\n') || t.startsWith('\n') ? '' : ' ') + t;
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
    rec.onresult = (e) => {
      let parcialAcum = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const texto = r[0]?.transcript ?? '';
        if (r.isFinal) onTextoRef.current?.(texto);
        else parcialAcum += texto;
      }
      setParcial(parcialAcum.trim());
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
      } else toast.error(`Dictado interrumpido (${e.error}).`);
      detener();
    };
    rec.onend = () => {
      // Chrome corta el modo continuo tras unos segundos de silencio: si el usuario no lo
      // detuvo, se vuelve a arrancar en silencio para que el dictado sea "hasta que lo apague".
      if (!detenidoManualRef.current && recRef.current === rec) {
        try { rec.start(); } catch { detener(); }
      }
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

  return { soportado, contextoSeguro, activo, parcial, alternar, detener };
}

export type Dictado = ReturnType<typeof useDictado>;
