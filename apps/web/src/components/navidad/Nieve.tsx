// Nieve del modo navideño. Tres capas con profundidad: al fondo puntitos difusos y lentos; en medio
// cristales pequeños; adelante pocos cristales grandes que giran. Los cristales (6 brazos con ramitas,
// en 4 diseños) se dibujan UNA vez en lienzos chicos y luego solo se copian: así ~85 copos no pesan.
// Son blancos con borde celeste, para que se lean sobre el fondo claro de la agenda y sobre el azul del menú.
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type Capa = 0 | 1 | 2; // 0 fondo, 1 medio, 2 adelante
interface Copo { capa: Capa; x: number; y: number; tam: number; vy: number; fase: number; amp: number; alfa: number; giro: number; vgiro: number; sprite: number; brillo: number }

const LADO_SPRITE = 64;
// Por diseño: [posición en el brazo, largo] de las dos ramitas.
const RAMITAS: Array<Array<[number, number]>> = [
  [[0.45, 0.32], [0.72, 0.2]],
  [[0.6, 0.28], [0.82, 0.16]],
  [[0.35, 0.4], [0.68, 0.24]],
  [[0.5, 0.22], [0.78, 0.3]],
];

/** Dibuja un cristal de 6 brazos; `variante` cambia las ramitas para que no salgan todos iguales. */
function crearCristal(variante: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = LADO_SPRITE;
  const g = c.getContext('2d');
  if (!g) return c;
  const m = LADO_SPRITE / 2, largo = m - 7;
  g.translate(m, m);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const brazo = () => {
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(0, -largo);
    for (const [pos, abre] of RAMITAS[variante]) {
      const y = -largo * pos, l = largo * abre;
      g.moveTo(0, y); g.lineTo(-l * 0.8, y - l);
      g.moveTo(0, y); g.lineTo(l * 0.8, y - l);
    }
    if (variante === 2) { g.moveTo(-3, -largo + 3); g.lineTo(0, -largo - 1); g.lineTo(3, -largo + 3); }
    g.stroke();
  };
  const trazar = (color: string, ancho: number) => {
    g.strokeStyle = color; g.lineWidth = ancho;
    for (let i = 0; i < 6; i++) { brazo(); g.rotate(Math.PI / 3); }
  };
  g.shadowColor = 'rgba(60, 110, 185, 0.55)';
  g.shadowBlur = 4;
  trazar('rgba(120, 160, 215, 0.9)', 5); // borde celeste (se ve sobre blanco)
  g.shadowBlur = 0;
  trazar('#ffffff', 2.6);                 // cuerpo blanco
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, variante === 3 ? 4.5 : 3, 0, Math.PI * 2); g.fill();
  return c;
}

/** Puntito difuso (copo lejano). */
function crearPunto(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  if (!g) return c;
  const d = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  d.addColorStop(0, 'rgba(255,255,255,1)');
  d.addColorStop(0.45, 'rgba(170,200,240,0.9)');
  d.addColorStop(1, 'rgba(140,180,230,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 16, 16);
  return c;
}

/** Nieve sobre la pantalla (la monta el menú lateral, presente en todas las páginas con sesión): no recibe clics, queda DEBAJO de los modales y se pausa con la pestaña oculta. */
export function Nieve() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const cristales = [0, 1, 2, 3].map(crearCristal);
    const punto = crearPunto();
    let ancho = 0, alto = 0, frame = 0, ultimo = 0, tiempo = 0;
    const copos: Copo[] = [];
    const azar = (a: number, b: number) => a + Math.random() * (b - a);

    const nuevo = (capa: Capa, arriba: boolean): Copo => {
      const tam = capa === 0 ? azar(3, 6) : capa === 1 ? azar(8, 13) : azar(15, 24);
      return {
        capa, tam,
        x: Math.random() * ancho,
        y: arriba ? -tam - Math.random() * 40 : Math.random() * alto,
        vy: capa === 0 ? azar(12, 22) : capa === 1 ? azar(24, 40) : azar(42, 62), // px/s: lo cercano cae más rápido
        fase: Math.random() * Math.PI * 2,
        amp: capa === 0 ? azar(4, 10) : azar(10, 26),
        alfa: capa === 0 ? azar(0.35, 0.6) : capa === 1 ? azar(0.6, 0.85) : azar(0.8, 0.95),
        giro: Math.random() * Math.PI * 2,
        vgiro: azar(-0.7, 0.7),
        sprite: Math.floor(Math.random() * cristales.length),
        brillo: Math.random() * Math.PI * 2,
      };
    };

    const medir = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ancho = window.innerWidth; alto = window.innerHeight;
      canvas.width = ancho * dpr; canvas.height = alto * dpr;
      canvas.style.width = `${ancho}px`; canvas.style.height = `${alto}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const base = Math.min(1, ancho / 1400);
      const meta: Record<Capa, number> = { 0: Math.round(45 * base), 1: Math.round(32 * base), 2: Math.max(3, Math.round(9 * base)) };
      copos.length = 0;
      ([0, 1, 2] as Capa[]).forEach((capa) => { for (let i = 0; i < meta[capa]; i++) copos.push(nuevo(capa, false)); });
    };

    const dibujar = (t: number) => {
      const dt = ultimo ? Math.min((t - ultimo) / 1000, 0.05) : 0;
      ultimo = t; tiempo += dt;
      // Viento: una brisa que va y viene (lo cercano la siente más).
      const viento = Math.sin(tiempo * 0.23) * 14 + Math.sin(tiempo * 0.61) * 6;
      ctx.clearRect(0, 0, ancho, alto);
      for (const c of copos) { // ya vienen ordenados: el fondo se dibuja primero
        c.y += c.vy * dt;
        c.x += viento * (0.4 + c.capa * 0.45) * dt;
        c.fase += dt * (0.6 + c.capa * 0.2);
        c.giro += c.vgiro * dt;
        c.brillo += dt * 2.2;
        if (c.y > alto + c.tam) Object.assign(c, nuevo(c.capa, true));
        if (c.x < -40) c.x += ancho + 80; else if (c.x > ancho + 40) c.x -= ancho + 80;
        const x = c.x + Math.sin(c.fase) * c.amp;
        if (c.capa === 0) {
          ctx.globalAlpha = c.alfa;
          ctx.drawImage(punto, x - c.tam / 2, c.y - c.tam / 2, c.tam, c.tam);
          continue;
        }
        // Los cristales destellan un poquito al girar.
        ctx.globalAlpha = Math.min(1, c.alfa + Math.max(0, Math.sin(c.brillo)) * 0.12);
        ctx.save();
        ctx.translate(x, c.y);
        ctx.rotate(c.giro);
        ctx.drawImage(cristales[c.sprite], -c.tam / 2, -c.tam / 2, c.tam, c.tam);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(dibujar);
    };

    const alCambiarVisibilidad = () => {
      cancelAnimationFrame(frame);
      ultimo = 0;
      if (!document.hidden) frame = requestAnimationFrame(dibujar);
    };

    medir();
    frame = requestAnimationFrame(dibujar);
    window.addEventListener('resize', medir);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', medir);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, []);

  // Al body: así queda fuera del menú (que es sticky con z-index) y siempre bajo los modales (z-50+).
  return createPortal(<canvas ref={ref} aria-hidden data-testid="navidad-nieve" className="pointer-events-none fixed inset-0 z-[45]" />, document.body);
}
