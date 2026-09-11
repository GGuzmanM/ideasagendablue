// Lienzo de anotaciones sobre la imagen del podograma (Baro). Vista PURA: recibe la capa de
// anotaciones (coordenadas 0..1) y emite eventos; el estado vive en usePodograma.
// Funciona con mouse, dedo y lápiz (pointer events + touch-action none). La imagen original
// nunca se modifica: solo se pinta encima en el lienzo.
import { useEffect, useRef, useState } from 'react';
import type { AnotacionPodograma } from '../../api/historiaClinica';
import type { HerramientaPodograma } from '../../services/historiaClinicaService';

interface Props {
  url: string;
  anotaciones: AnotacionPodograma[];
  herramienta: HerramientaPodograma;
  color: string;
  grosor: number;
  editable: boolean;
  onTrazo: (t: AnotacionPodograma) => void;
  onTexto: (x: number, y: number, texto: string) => void;
  onBorrar: (x: number, y: number) => void;
  /** Herramienta "Etiquetar": toca un trazo para elegirlo y decir qué es. */
  onSeleccionar?: (x: number, y: number) => void;
  seleccion?: number | null;
  /** Capas ocultas: esos trazos no se dibujan. */
  oculto?: (a: AnotacionPodograma) => boolean;
}

type Punto = [number, number];

function pintar(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number, lista: AnotacionPodograma[], enCurso: Punto[] | null, color: string, grosor: number, sel: number | null = null, oculto?: (a: AnotacionPodograma) => boolean) {
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const trazar = (puntos: Punto[], c: string, g: number) => {
    if (!puntos.length) return;
    ctx.strokeStyle = c;
    ctx.lineWidth = Math.max(1, (g * W) / 1000);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    puntos.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * W, y * H) : ctx.lineTo(x * W, y * H)));
    if (puntos.length === 1) ctx.lineTo(puntos[0][0] * W + 0.1, puntos[0][1] * H);
    ctx.stroke();
  };
  for (const a of lista) {
    if (oculto?.(a)) continue;
    if (a.tipo === 'trazo') trazar(a.puntos, a.color, a.grosor);
    else {
      ctx.font = `600 ${Math.max(12, W / 42)}px system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, W / 300);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(a.texto, a.x * W, a.y * H);
      ctx.fillStyle = a.color;
      ctx.fillText(a.texto, a.x * W, a.y * H);
    }
  }
  if (enCurso) trazar(enCurso, color, grosor);
  // Trazo elegido con "Etiquetar": contorno punteado encima para que se vea cuál es.
  const s = sel != null ? lista[sel] : null;
  if (s && s.tipo === 'trazo') {
    ctx.save();
    ctx.setLineDash([Math.max(6, W / 90), Math.max(4, W / 140)]);
    trazar(s.puntos, '#111827', s.grosor + 6);
    ctx.restore();
  }
}

export function PodogramaEditor({ url, anotaciones, herramienta, color, grosor, editable, onTrazo, onTexto, onBorrar, onSeleccionar, seleccion = null, oculto }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [tam, setTam] = useState({ w: 0, h: 0 });
  const enCursoRef = useRef<Punto[] | null>(null);
  const [textoPendiente, setTextoPendiente] = useState<{ x: number; y: number } | null>(null);
  const [textoValor, setTextoValor] = useState('');

  // Carga de la imagen (object URL ya autenticado).
  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
    return () => { setImg(null); };
  }, [url]);

  // Tamaño del lienzo = tamaño CSS del contenedor × devicePixelRatio (nítido en pantallas densas).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const medir = () => setTam({ w: c.clientWidth, h: c.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(c);
    return () => ro.disconnect();
  }, [img]);

  const redibujar = () => {
    const c = canvasRef.current;
    if (!c || !img || !tam.w) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(tam.w * dpr);
    const H = Math.round(tam.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    if (ctx) pintar(ctx, img, W, H, anotaciones, enCursoRef.current, color, grosor, seleccion, oculto);
  };
  useEffect(redibujar, [img, tam, anotaciones, color, grosor, seleccion, oculto]); // eslint-disable-line react-hooks/exhaustive-deps

  const coords = (e: React.PointerEvent<HTMLCanvasElement>): Punto => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  // Texto: se "arma" en pointerdown y se coloca recién en pointerup. Si el input se montara en
  // pointerdown, el mousedown del mismo clic sobre el lienzo le robaría el foco al instante
  // (onBlur → confirmación vacía) y desaparecería antes de poder escribir.
  const textoArmadoRef = useRef<Punto | null>(null);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!editable || !img || herramienta === 'mover') return;
    const [x, y] = coords(e);
    if (herramienta === 'lapiz') {
      e.currentTarget.setPointerCapture(e.pointerId);
      enCursoRef.current = [[x, y]];
      redibujar();
    } else if (herramienta === 'borrador') {
      onBorrar(x, y);
    } else if (herramienta === 'texto') {
      textoArmadoRef.current = [x, y];
    } else if (herramienta === 'etiquetar') {
      onSeleccionar?.(x, y);
    }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const t = enCursoRef.current;
    if (!t) return;
    const [x, y] = coords(e);
    const [ux, uy] = t[t.length - 1];
    if (Math.hypot(x - ux, y - uy) < 0.002) return;
    t.push([x, y]);
    redibujar();
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const armado = textoArmadoRef.current;
    if (armado) {
      textoArmadoRef.current = null;
      setTextoPendiente({ x: armado[0], y: armado[1] });
      setTextoValor('');
      return;
    }
    const t = enCursoRef.current;
    if (!t) return;
    enCursoRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }
    onTrazo({ tipo: 'trazo', color, grosor, puntos: t });
  };
  const onSalir = (e: React.PointerEvent<HTMLCanvasElement>) => {
    textoArmadoRef.current = null; // salir del lienzo sin soltar: no se coloca texto
    if (enCursoRef.current) onUp(e);
  };

  const confirmarTexto = () => {
    const v = textoValor.trim();
    if (textoPendiente && v) onTexto(textoPendiente.x, textoPendiente.y, v);
    setTextoPendiente(null);
    setTextoValor('');
  };

  // "Pasivo" = el dedo/mouse NO dibuja: modo solo lectura o herramienta "mover". En ese caso el
  // lienzo deja pasar el gesto para que la página se desplace (touch-action pan-y); si no, lo
  // captura (none) para que el trazo no mueva la pantalla.
  const pasivo = !editable || herramienta === 'mover';
  const cursor = pasivo ? 'grab' : herramienta === 'borrador' || herramienta === 'etiquetar' ? 'pointer' : herramienta === 'texto' ? 'text' : 'crosshair';
  const ratio = img ? img.naturalWidth / img.naturalHeight : 4 / 3;

  return (
    // Ancho = 100% del contenedor, pero nunca más alto que ~62 % de la pantalla: en tablet vertical
    // una imagen alta dejaría el lienzo ocupando todo y no habría dónde tocar para desplazarse.
    <div className="relative bg-surface-container-low mx-auto rounded-xl overflow-hidden border border-outline-variant/30"
      style={{ aspectRatio: `${ratio}`, width: '100%', maxWidth: `calc(62vh * ${ratio})` }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full select-none"
        style={{ touchAction: pasivo ? 'pan-y' : 'none', cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onSalir}
        onPointerLeave={onSalir}
      />
      {!img && <div className="absolute inset-0 flex items-center justify-center text-sm text-on-surface-variant">Cargando imagen…</div>}
      {textoPendiente && (
        <input
          autoFocus
          value={textoValor}
          onChange={(e) => setTextoValor(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirmarTexto(); if (e.key === 'Escape') { setTextoPendiente(null); setTextoValor(''); } }}
          onBlur={confirmarTexto}
          maxLength={200}
          placeholder="Escribe y Enter"
          className="absolute -translate-y-full bg-white/95 border border-primary rounded-md px-2 py-1 text-sm shadow"
          style={{ left: `${textoPendiente.x * 100}%`, top: `${textoPendiente.y * 100}%`, color, minWidth: 140 }}
        />
      )}
    </div>
  );
}
