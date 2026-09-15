// Cámara en vivo del navegador (getUserMedia) para la foto «fantasma». Necesita HTTPS (o localhost) y el
// permiso de cámara. Por defecto usa la cámara trasera (tablet); se puede cambiar a la frontal. La
// captura sale en la orientación real (sin espejo) como JPEG a la resolución de la cámara.
import { useEffect, useRef, useState } from 'react';

export function useCamaraEnVivo(activa: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [frontal, setFrontal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    if (!activa) return;
    setLista(false);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('La cámara en vivo necesita que la página se abra con HTTPS (o este navegador no la permite). Usa «Tomar foto».');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelado = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: frontal ? 'user' : { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelado) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const v = videoRef.current;
        if (v) { v.srcObject = s; void v.play().catch(() => { /* autoplay bloqueado: el usuario toca */ }); }
      })
      .catch((e: DOMException) => {
        if (!cancelado) setError(e?.name === 'NotAllowedError' ? 'Permiso de cámara denegado: habilítalo en el candado de la barra de direcciones.' : 'No se pudo abrir la cámara de este equipo.');
      });
    return () => { cancelado = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [activa, frontal]);

  /** Foto del cuadro actual como archivo JPEG (null si la cámara aún no está lista). */
  const capturar = async (): Promise<File | null> => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    const ahora = Date.now();
    return blob ? new File([blob], `foto-${ahora}.jpg`, { type: 'image/jpeg', lastModified: ahora }) : null;
  };

  return { videoRef, frontal, setFrontal, error, lista, setLista, capturar };
}
