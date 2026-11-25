import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { cargarCuerpo, geometriaCuerpo, indiceVertices, type CuerpoDatos, type IndiceVertices } from './cuerpo3dMalla';
import {
  TIPOS_MARCA, COLOR_TIPO, LABEL_TIPO, LABEL_ZONA, ZONAS_ORDENADAS, GROSORES, MAX_TOQUES, MAX_ESTRUCTURAS, capaDe,
  type MarcaCorporal, type TipoMarcaCorporal, type GrosorPincel, type CapaCuerpo,
} from './cuerpo3dModelo';
import { EscalaPunto, type EscalaAnterior } from './EscalaPunto';

/**
 * Mapa corporal 3D (Fisioterapia). Un cuerpo humano que se gira arrastrando y se acerca con pellizco / Ctrl + rueda, con dos
 * maneras de marcar hallazgos (dolor, inflamación, edema…):
 *  · «Pincel» (25-nov-2026, como el podograma): se pinta con el dedo EXACTAMENTE donde está el hallazgo, con tres grosores y
 *    borrador. Lo pintado queda como un hallazgo de esa zona (con su intensidad y su nota), pero solo se colorea lo pintado.
 *  · «Zona completa»: un toque elige la zona y se le ponen uno o varios hallazgos a toda ella.
 * Dos CAPAS (26-nov-2026), cada una con su modelo y sus propios hallazgos: «Piel» (el cuerpo de siempre) y «Músculos»
 * (músculos y huesos de BodyParts3D: al pasar el dedo dice qué músculo es y el hallazgo anota los que tocó el pincel).
 * La lista de abajo es la versión accesible (sin 3D) de lo mismo. No guarda nada: avisa cada cambio con `onCambiar`.
 */
const COLOR_PIEL = new THREE.Color('#c99c80');
/** Capa de músculos: color de cada tejido (m músculo · t tendón, fascia, ligamento · h hueso · c cartílago y discos). */
const COLOR_TEJIDO = { m: new THREE.Color('#a8443f'), t: new THREE.Color('#d9c3b4'), h: new THREE.Color('#e4dac6'), c: new THREE.Color('#bfd0d6') };
const CAPAS: { id: CapaCuerpo; label: string; icono: string }[] = [
  { id: 'piel', label: 'Piel', icono: 'accessibility_new' },
  { id: 'musculos', label: 'Músculos', icono: 'fitness_center' },
];
const COLOR_OJO = [new THREE.Color('#000000'), new THREE.Color('#e9e2da'), new THREE.Color('#5a3a26'), new THREE.Color('#16100c')]; // –, esclera, iris, pupila
const COLOR_SEL = new THREE.Color('#3b82f6');
const COLOR_HOVER = new THREE.Color('#ffffff');
const OBJETIVO = new THREE.Vector3(0, 0.83, 0.02);
const DISTANCIA = 3.45;
const RADIO_MM: Record<GrosorPincel, number> = Object.fromEntries(GROSORES.map((g) => [g.id, g.mm])) as Record<GrosorPincel, number>;
const VISTAS = [
  { id: 'frente', label: 'Frente', ang: 0, titulo: 'De frente' },
  { id: 'espalda', label: 'Espalda', ang: Math.PI, titulo: 'De espalda' },
  { id: 'izq', label: 'Izq.', ang: Math.PI / 2, titulo: 'Lado izquierdo del paciente' },
  { id: 'der', label: 'Der.', ang: -Math.PI / 2, titulo: 'Lado derecho del paciente' },
] as const;

type Modo = 'pincel' | 'zona';
type Herramienta = TipoMarcaCorporal | 'borrar';

interface Props {
  marcas: MarcaCorporal[];
  editable: boolean;
  onCambiar: (marcas: MarcaCorporal[]) => void;
  /** Escala del mismo punto en la sesión anterior (para decir si mejoró). */
  anteriorDe?: (m: MarcaCorporal) => EscalaAnterior | null;
}

interface Cuerpo {
  color: THREE.BufferAttribute; pos: Float32Array; nor: Int8Array; zonaV: string[]; ao: Uint8Array; indice: IndiceVertices;
  /** Color propio de cada vértice sin nada marcado: piel y ojos, o el tejido (músculo, tendón, hueso). */
  base: Float32Array;
  /** No se pinta encima (los ojos). */
  fijo: Uint8Array;
  /** Cuánto oscurecen los pliegues. */
  sombra: number;
  /** Nombre del músculo / hueso de un vértice (solo en la capa de músculos). */
  parteDe: (v: number) => string | null;
}

function cuerpoDe(d: CuerpoDatos, color: THREE.BufferAttribute): Cuerpo {
  const n = d.zonaV.length;
  const base = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const c = d.partes && d.parteV ? COLOR_TEJIDO[d.partes[d.parteV[v]]?.t ?? 'm'] : d.ojo[v] ? COLOR_OJO[d.ojo[v]] : COLOR_PIEL;
    base[v * 3] = c.r; base[v * 3 + 1] = c.g; base[v * 3 + 2] = c.b;
  }
  return {
    color, pos: d.pos, nor: d.nor, zonaV: d.zonaV, ao: d.ao, indice: indiceVertices(d.pos), base, fijo: d.ojo,
    sombra: d.partes ? 0.78 : 0.85,
    parteDe: (v) => (d.partes && d.parteV ? d.partes[d.parteV[v]]?.n ?? null : null),
  };
}

/** Lo pintado con el pincel, llevado a los vértices: cuánto cubre cada uno (0–1, con borde suave) y de qué color. */
function capaPintura(c: Cuerpo, marcas: MarcaCorporal[]) {
  const n = c.zonaV.length;
  const peso = new Float32Array(n); const rgb = new Float32Array(n * 3);
  for (const m of marcas) {
    const p = m.puntos;
    if (!p?.length) continue;
    const col = new THREE.Color(COLOR_TIPO[m.tipo]);
    for (let k = 0; k + 3 < p.length; k += 4) {
      const x = p[k] / 1000, y = p[k + 1] / 1000, z = p[k + 2] / 1000, r = p[k + 3] / 1000;
      // Solo la piel que mira hacia el mismo lado que el toque: sin esto, pintar el dorso de la mano teñiría la palma.
      const ref = c.indice.masCercano(x, y, z, 0.02);
      const nx = ref < 0 ? 0 : c.nor[ref * 3], ny = ref < 0 ? 0 : c.nor[ref * 3 + 1], nz = ref < 0 ? 0 : c.nor[ref * 3 + 2];
      const firme = r * 0.7, borde = r * 0.42;
      c.indice.cerca(x, y, z, firme + borde, (v, d2) => {
        if (ref >= 0 && c.nor[v * 3] * nx + c.nor[v * 3 + 1] * ny + c.nor[v * 3 + 2] * nz < 1600) return;
        const d = Math.sqrt(d2);
        const w = d <= firme ? 1 : 1 - (d - firme) / borde;
        if (w > peso[v]) { peso[v] = w; rgb[v * 3] = col.r; rgb[v * 3 + 1] = col.g; rgb[v * 3 + 2] = col.b; }
      });
    }
  }
  return { peso, rgb };
}

export function MapaCorporal3D({ marcas, editable, onCambiar, anteriorDe }: Props) {
  const contRef = useRef<HTMLDivElement>(null);
  const [modo, setModo] = useState<Modo>('pincel');
  const [herramienta, setHerramienta] = useState<Herramienta>('dolor');
  const [grosor, setGrosor] = useState<GrosorPincel>('medio');
  const [capa, setCapa] = useState<CapaCuerpo>('piel');
  const [cargandoCapa, setCargandoCapa] = useState(false);
  const [avisoCapa, setAvisoCapa] = useState<string | null>(null);
  const [credito, setCredito] = useState<string | null>(null);
  const [zonaSel, setZonaSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverParte, setHoverParte] = useState<string | null>(null);
  const [sin3d, setSin3d] = useState(false);
  const [listo, setListo] = useState(0); // la malla ya existe → pintar sus colores

  // Lo último, para los manejadores del lienzo (se crean una sola vez).
  const estado = useRef({ marcas, editable, modo, herramienta, grosor, capa, onCambiar });
  estado.current = { marcas, editable, modo, herramienta, grosor, capa, onCambiar };
  const capaRef = useRef<((c: CapaCuerpo) => void) | null>(null);
  const cuerpoRef = useRef<Cuerpo | null>(null);
  const pinturaRef = useRef<{ de: MarcaCorporal[]; cuerpo: Cuerpo; capa: ReturnType<typeof capaPintura> } | null>(null);
  const camaraRef = useRef<{ irA: (ang: number) => void; acercar: (factor: number) => void } | null>(null);

  // ── Escena (una vez) ──
  useEffect(() => {
    const cont = contRef.current;
    if (!cont) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setSin3d(true); // sin WebGL (equipo muy antiguo): queda la lista accesible
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    cont.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.setAttribute('aria-label', 'Cuerpo humano en 3D: arrastra para girarlo; Ctrl + rueda o pellizco para acercar');

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    camara.position.set(0, OBJETIVO.y + 0.15, DISTANCIA);
    // Luz de estudio: un entorno suave (da el modelado de los volúmenes) + una luz principal y un contraluz que siguen a la
    // cámara, para que el lado que se mira siempre esté bien iluminado y con el contorno dibujado.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04);
    escena.environment = entorno.texture;
    escena.environmentIntensity = 0.3;
    const luz = new THREE.DirectionalLight(0xfff1e6, 1.9);
    luz.position.set(2.6, 2.3, 0.8);
    const contraluz = new THREE.DirectionalLight(0xcfe0ff, 2.2);
    contraluz.position.set(-1.8, 1.4, -4.5);
    for (const l of [luz, contraluz]) { camara.add(l); camara.add(l.target); l.target.position.set(0, 0, -3); }
    escena.add(camara);

    const controles = new OrbitControls(camara, renderer.domElement);
    controles.target.copy(OBJETIVO);
    controles.enableDamping = true;
    controles.minDistance = 0.45;
    controles.maxDistance = 4.6;
    controles.maxPolarAngle = Math.PI * 0.9;
    controles.update();

    // Cambios de vista con una transición corta (girando alrededor del cuerpo, por el camino más corto).
    let viaje: { t0: number; de: THREE.Spherical; a: THREE.Spherical; objetivo: THREE.Vector3 } | null = null;
    const esf = () => new THREE.Spherical().setFromVector3(camara.position.clone().sub(controles.target));
    camaraRef.current = {
      irA: (ang) => {
        controles.target.copy(OBJETIVO);
        const de = esf();
        const a = new THREE.Spherical(DISTANCIA, Math.acos(0.15 / DISTANCIA), ang);
        a.theta = de.theta + Math.atan2(Math.sin(a.theta - de.theta), Math.cos(a.theta - de.theta));
        viaje = { t0: performance.now(), de, a, objetivo: controles.target.clone() };
      },
      acercar: (factor) => {
        const de = esf();
        const a = de.clone(); a.radius = Math.min(controles.maxDistance, Math.max(controles.minDistance, de.radius * factor));
        viaje = { t0: performance.now(), de, a, objetivo: controles.target.clone() };
      },
    };

    const matPiel = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.62, metalness: 0,
      sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffd9c4'), // el brillo suave de la piel en los contornos
    });
    // Músculo: algo más húmedo y brillante que la piel.
    const matMusculo = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.55 });
    // Bordes de zona: líneas con grosor en píxeles (las de WebGL siempre miden 1 px y casi no se ven en pantallas densas).
    const matBordes = new LineMaterial({ color: 0x5b473b, linewidth: 1, transparent: true, opacity: 0.3, depthWrite: false });

    // Cada capa es un modelo distinto; se descarga la primera vez que se pide y después solo se muestra u oculta.
    interface CapaLista {
      malla: THREE.Mesh; lineas: LineSegments2 | null; cuerpo: Cuerpo; credito: string | null;
      zonaDeCara: (cara: number) => string | null; parteDeCara: (cara: number) => string | null;
    }
    const capas = new Map<CapaCuerpo, CapaLista>();
    const pidiendo = new Set<CapaCuerpo>();
    let activa: CapaLista | null = null;
    let cuerpo: Cuerpo | null = null;
    let vivo = true;
    const poner = (l: CapaLista) => {
      for (const x of capas.values()) { x.malla.visible = x === l; if (x.lineas) x.lineas.visible = x === l; }
      activa = l; cuerpo = l.cuerpo;
      cuerpoRef.current = l.cuerpo;
      setCredito(l.credito);
      setListo((n) => n + 1);
    };
    capaRef.current = (c) => {
      const ya = capas.get(c);
      if (ya) { poner(ya); return; }
      if (pidiendo.has(c)) return;
      pidiendo.add(c);
      setCargandoCapa(true);
      void cargarCuerpo(c).then((d) => {
        if (!vivo) return;
        const geometria = geometriaCuerpo(d);
        const malla = new THREE.Mesh(geometria, c === 'musculos' ? matMusculo : matPiel);
        malla.visible = false;
        escena.add(malla);
        let lineas: LineSegments2 | null = null;
        if (d.lineas.length) {
          lineas = new LineSegments2(new LineSegmentsGeometry().setPositions(d.lineas), matBordes);
          lineas.visible = false;
          escena.add(lineas);
        }
        const cu = cuerpoDe(d, geometria.getAttribute('color') as THREE.BufferAttribute);
        const lista: CapaLista = {
          malla, lineas, cuerpo: cu, credito: d.credito,
          zonaDeCara: (cara) => d.zonaV[d.indices[cara * 3]] ?? null, // los 3 vértices de un triángulo son de la misma zona (o vecinas)
          parteDeCara: (cara) => cu.parteDe(d.indices[cara * 3]),
        };
        capas.set(c, lista);
        if (estado.current.capa === c) poner(lista);
      }).catch(() => {
        if (!vivo) return;
        if (c === 'piel') { setSin3d(true); return; } // sin el modelo queda la lista de zonas
        setAvisoCapa('No se pudo cargar la capa de músculos. Revisa la conexión e inténtalo otra vez.');
        setCapa('piel');
      }).finally(() => { pidiendo.delete(c); if (vivo) setCargandoCapa(pidiendo.size > 0); });
    };

    // Piso: sombra suave y un aro fino, como una peana de estudio.
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 256;
    const ctx = lienzo.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 104);
      grad.addColorStop(0, 'rgba(2,6,23,0.6)');
      grad.addColorStop(1, 'rgba(2,6,23,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(128, 128, 118, 0, Math.PI * 2); ctx.stroke();
    }
    const texPiso = new THREE.CanvasTexture(lienzo);
    const matPiso = new THREE.MeshBasicMaterial({ map: texPiso, transparent: true, depthWrite: false });
    const piso = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), matPiso);
    piso.rotation.x = -Math.PI / 2;
    piso.position.set(0, -0.002, 0.03);
    escena.add(piso);

    // Cursor del pincel: un aro apoyado sobre la piel, del tamaño real de lo que va a pintar.
    const matAro = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
    const aro = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 56), matAro);
    aro.renderOrder = 10;
    aro.visible = false;
    escena.add(aro);
    const EJE_Z = new THREE.Vector3(0, 0, 1);

    const ajustar = () => {
      const w = cont.clientWidth || 300, h = cont.clientHeight || 420;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
      matBordes.resolution.set(w, h);
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(cont);

    // ── Toques: elegir, pintar y resaltar ──
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    const golpe = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camara);
      if (!activa) return null;
      const hit = ray.intersectObject(activa.malla, false)[0];
      if (!hit || hit.faceIndex == null) return null;
      return { zona: activa.zonaDeCara(hit.faceIndex), parte: activa.parteDeCara(hit.faceIndex), punto: hit.point, normal: hit.face?.normal ?? EJE_Z };
    };

    /** Un toque del pincel (o del borrador) en `p`; rellena el tramo desde el toque anterior para que el trazo no quede a saltos. */
    let ultimoP: THREE.Vector3 | null = null;
    const pincelar = (p: THREE.Vector3) => {
      if (!cuerpo) return;
      const { herramienta: h, grosor: g, capa: capaAct, onCambiar: cb } = estado.current;
      const rmm = RADIO_MM[g]; const r = rmm / 1000;
      const tramo: THREE.Vector3[] = [];
      const salto = ultimoP ? ultimoP.distanceTo(p) : Infinity;
      if (ultimoP && salto < 0.15) {
        const n = Math.max(1, Math.ceil(salto / (r * 0.35)));
        for (let i = 1; i <= n; i++) tramo.push(ultimoP.clone().lerp(p, i / n));
      } else tramo.push(p);
      ultimoP = p.clone();
      let ms = estado.current.marcas; let cambio = false;
      for (const q of tramo) {
        const v = cuerpo.indice.masCercano(q.x, q.y, q.z, 0.03);
        if (v < 0) continue;
        const x = Math.round(cuerpo.pos[v * 3] * 1000), y = Math.round(cuerpo.pos[v * 3 + 1] * 1000), z = Math.round(cuerpo.pos[v * 3 + 2] * 1000);
        if (h === 'borrar') {
          const queda: MarcaCorporal[] = [];
          for (const m of ms) {
            if (!m.puntos?.length || capaDe(m) !== capaAct) { queda.push(m); continue; }
            const pts: number[] = [];
            for (let k = 0; k + 3 < m.puntos.length; k += 4) {
              const lim = rmm + m.puntos[k + 3] * 0.4;
              if ((m.puntos[k] - x) ** 2 + (m.puntos[k + 1] - y) ** 2 + (m.puntos[k + 2] - z) ** 2 > lim * lim) pts.push(m.puntos[k], m.puntos[k + 1], m.puntos[k + 2], m.puntos[k + 3]);
            }
            if (pts.length === m.puntos.length) { queda.push(m); continue; }
            cambio = true;
            if (pts.length) queda.push({ ...m, puntos: pts }); // sin toques, el hallazgo desaparece
          }
          ms = queda;
          continue;
        }
        const zona = cuerpo.zonaV[v];
        const i = ms.findIndex((m) => m.zona === zona && m.tipo === h && capaDe(m) === capaAct);
        if (i >= 0 && !ms[i].puntos?.length) continue; // ese hallazgo ya es de toda la zona
        const previos = i >= 0 ? ms[i].puntos! : [];
        if (previos.length >= MAX_TOQUES * 4) continue;
        let repetido = false; const lim = (rmm * 0.3) ** 2;
        for (let k = 0; k + 3 < previos.length; k += 4) {
          if (previos[k + 3] >= rmm && (previos[k] - x) ** 2 + (previos[k + 1] - y) ** 2 + (previos[k + 2] - z) ** 2 < lim) { repetido = true; break; }
        }
        if (repetido) continue;
        const puntos = [...previos, x, y, z, rmm];
        // En la capa de músculos el hallazgo anota qué músculos / huesos tocó el pincel.
        const parte = cuerpo.parteDe(v);
        const antes = i >= 0 ? ms[i].estructuras ?? [] : [];
        const estructuras = parte && !antes.includes(parte) && antes.length < MAX_ESTRUCTURAS ? [...antes, parte] : antes;
        const extra = capaAct === 'musculos' ? { capa: 'musculos' as const, estructuras } : {};
        ms = i >= 0 ? ms.map((m, j) => (j === i ? { ...m, puntos, ...extra } : m)) : [...ms, { zona, tipo: h, intensidad: null, nota: null, puntos, ...extra }];
        cambio = true;
      }
      if (cambio) { estado.current.marcas = ms; cb(ms); }
    };

    let pintando = false;
    let inicio: { x: number; y: number } | null = null;
    const abajo = (ev: PointerEvent) => {
      // Segundo dedo (pellizco para acercar): se deja de pintar y manda la cámara.
      if (!ev.isPrimary) { if (pintando) cancelar(); return; }
      inicio = { x: ev.clientX, y: ev.clientY };
      viaje = null;
      const { editable: ed, modo: md } = estado.current;
      if (ed && md === 'pincel') {
        const g = golpe(ev);
        if (g) {
          pintando = true; controles.enabled = false; ultimoP = null;
          renderer.domElement.setPointerCapture(ev.pointerId);
          pincelar(g.punto);
        }
      }
    };
    // Buscar qué hay bajo el puntero recorre toda la malla (115 mil triángulos): se hace como mucho una vez por cuadro y
    // nunca mientras se está girando el cuerpo, para que en la tablet el giro siga fluido.
    let ultimo: PointerEvent | null = null;
    let cuadro = 0;
    const mover = (ev: PointerEvent) => {
      if (inicio && !pintando) { aro.visible = false; return; } // girando
      ultimo = ev;
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        if (!ultimo) return;
        const g = golpe(ultimo);
        const z = g?.zona ?? null;
        const { editable: ed, modo: md, herramienta: h, grosor: gr } = estado.current;
        const conPincel = ed && md === 'pincel';
        setHover((prev) => (prev === z ? prev : z));
        const pieza = g?.parte ?? null;
        setHoverParte((prev) => (prev === pieza ? prev : pieza));
        renderer.domElement.style.cursor = g ? (conPincel ? 'none' : 'pointer') : 'grab';
        aro.visible = Boolean(g && conPincel);
        if (g && conPincel) {
          aro.position.copy(g.punto).addScaledVector(g.normal, 0.003);
          aro.quaternion.setFromUnitVectors(EJE_Z, g.normal);
          aro.scale.setScalar(RADIO_MM[gr] / 1000);
          matAro.color.set(h === 'borrar' ? '#ffffff' : COLOR_TIPO[h]);
        }
        if (pintando) { if (g) pincelar(g.punto); else ultimoP = null; }
      });
    };
    const arriba = (ev: PointerEvent) => {
      if (pintando) {
        pintando = false; controles.enabled = true; inicio = null; ultimoP = null;
        if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
        return;
      }
      if (inicio && Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 6) {
        const z = golpe(ev)?.zona;
        if (z) setZonaSel(z);
      }
      inicio = null;
    };
    const fuera = () => { setHover(null); setHoverParte(null); aro.visible = false; };
    function cancelar() { pintando = false; controles.enabled = true; inicio = null; ultimoP = null; aro.visible = false; }
    // La rueda SOLA baja la página; Ctrl + rueda acerca. En captura, sobre el contenedor: así no llega a OrbitControls.
    const rueda = (ev: WheelEvent) => { if (!ev.ctrlKey && !ev.metaKey) ev.stopPropagation(); };
    cont.addEventListener('wheel', rueda, { capture: true });
    const lienzo3d = renderer.domElement;
    lienzo3d.addEventListener('pointerdown', abajo);
    lienzo3d.addEventListener('pointermove', mover);
    lienzo3d.addEventListener('pointerup', arriba);
    lienzo3d.addEventListener('pointerleave', fuera);
    lienzo3d.addEventListener('pointercancel', cancelar);

    const tmp = new THREE.Spherical();
    renderer.setAnimationLoop(() => {
      if (viaje) {
        const k = Math.min(1, (performance.now() - viaje.t0) / 420);
        const s = k * k * (3 - 2 * k);
        tmp.set(viaje.de.radius + (viaje.a.radius - viaje.de.radius) * s, viaje.de.phi + (viaje.a.phi - viaje.de.phi) * s, viaje.de.theta + (viaje.a.theta - viaje.de.theta) * s);
        camara.position.setFromSpherical(tmp).add(viaje.objetivo);
        if (k >= 1) viaje = null;
      }
      controles.update();
      renderer.render(escena, camara);
    });

    return () => {
      renderer.setAnimationLoop(null);
      cancelAnimationFrame(cuadro);
      ro.disconnect();
      cont.removeEventListener('wheel', rueda, { capture: true });
      lienzo3d.removeEventListener('pointerdown', abajo);
      lienzo3d.removeEventListener('pointermove', mover);
      lienzo3d.removeEventListener('pointerup', arriba);
      lienzo3d.removeEventListener('pointerleave', fuera);
      lienzo3d.removeEventListener('pointercancel', cancelar);
      controles.dispose();
      vivo = false;
      for (const l of capas.values()) { l.malla.geometry.dispose(); l.lineas?.geometry.dispose(); }
      matPiel.dispose(); matMusculo.dispose(); matBordes.dispose();
      entorno.dispose(); pmrem.dispose();
      piso.geometry.dispose(); matPiso.dispose(); texPiso.dispose();
      aro.geometry.dispose(); matAro.dispose();
      renderer.dispose();
      lienzo3d.remove();
      camaraRef.current = null;
      capaRef.current = null;
      cuerpoRef.current = null;
      pinturaRef.current = null;
    };
  }, []);

  // Mostrar la capa elegida (la primera vez la descarga).
  useEffect(() => { capaRef.current?.(capa); setZonaSel(null); setHover(null); setHoverParte(null); }, [capa]);

  // ── Colores: tejido, zonas completas, lo pintado, la zona elegida y la que está bajo el puntero ──
  const marcasCapa = useMemo(() => marcas.filter((m) => capaDe(m) === capa), [marcas, capa]); // cada capa tiene sus hallazgos
  const colorDeZona = useMemo(() => {
    const m = new Map<string, THREE.Color>();
    for (const x of marcasCapa) if (!x.puntos?.length) m.set(x.zona, new THREE.Color(COLOR_TIPO[x.tipo])); // la más reciente gana
    return m;
  }, [marcasCapa]);
  useEffect(() => {
    const cuerpo = cuerpoRef.current;
    if (!cuerpo) return;
    if (pinturaRef.current?.de !== marcasCapa || pinturaRef.current.cuerpo !== cuerpo) pinturaRef.current = { de: marcasCapa, cuerpo, capa: capaPintura(cuerpo, marcasCapa) }; // solo si cambió lo marcado
    const { peso, rgb } = pinturaRef.current.capa;
    const arr = cuerpo.color.array as Float32Array;
    const CUBRE = 0.88; // cuánto tapa lo pintado
    for (let v = 0; v < cuerpo.zonaV.length; v++) {
      let r = cuerpo.base[v * 3], g = cuerpo.base[v * 3 + 1], b = cuerpo.base[v * 3 + 2];
      if (!cuerpo.fijo[v]) {
        const zona = cuerpo.zonaV[v];
        const lleno = colorDeZona.get(zona);
        if (lleno) { r += (lleno.r - r) * 0.8; g += (lleno.g - g) * 0.8; b += (lleno.b - b) * 0.8; }
        if (zona === zonaSel) { const k = lleno ? 0.3 : 0.5; r += (COLOR_SEL.r - r) * k; g += (COLOR_SEL.g - g) * k; b += (COLOR_SEL.b - b) * k; }
        else if (zona === hover && modo === 'zona') { r += (COLOR_HOVER.r - r) * 0.3; g += (COLOR_HOVER.g - g) * 0.3; b += (COLOR_HOVER.b - b) * 0.3; }
        const w = peso[v] * CUBRE;
        if (w > 0) { r += (rgb[v * 3] - r) * w; g += (rgb[v * 3 + 1] - g) * w; b += (rgb[v * 3 + 2] - b) * w; }
      }
      const luzV = 1 - cuerpo.sombra * (1 - cuerpo.ao[v] / 255); // pliegues (y la separación entre músculos) más oscuros
      arr[v * 3] = r * luzV; arr[v * 3 + 1] = g * luzV; arr[v * 3 + 2] = b * luzV;
    }
    cuerpo.color.needsUpdate = true;
  }, [marcasCapa, colorDeZona, zonaSel, hover, modo, listo]);

  // ── Edición desde el panel ──
  const misma = (a: MarcaCorporal, b: MarcaCorporal) => a.zona === b.zona && a.tipo === b.tipo && capaDe(a) === capaDe(b);
  const marcasDeZona = zonaSel ? marcasCapa.filter((m) => m.zona === zonaSel) : [];
  const alternarTipo = (tipo: TipoMarcaCorporal) => {
    if (!zonaSel || !editable) return;
    const nueva: MarcaCorporal = { zona: zonaSel, tipo, intensidad: null, nota: null, ...(capa === 'musculos' ? { capa: 'musculos' as const } : {}) };
    onCambiar(marcas.some((m) => misma(m, nueva)) ? marcas.filter((m) => !misma(m, nueva)) : [...marcas, nueva]);
  };
  const editarMarca = (de: MarcaCorporal, cambios: Partial<MarcaCorporal>) => onCambiar(marcas.map((m) => (misma(m, de) ? { ...m, ...cambios } : m)));
  const quitarMarca = (de: MarcaCorporal) => onCambiar(marcas.filter((m) => !misma(m, de)));

  /** La lista: todos los hallazgos, agrupados por capa y zona (de cabeza a pies; primero la piel). */
  const grupos = useMemo(() => {
    const orden = new Map(ZONAS_ORDENADAS.map((z, i) => [z.zona, i]));
    const g = new Map<string, { capa: CapaCuerpo; zona: string; ms: MarcaCorporal[] }>();
    for (const m of marcas) {
      const k = `${capaDe(m)}|${m.zona}`;
      const x = g.get(k) ?? { capa: capaDe(m), zona: m.zona, ms: [] };
      x.ms.push(m);
      g.set(k, x);
    }
    return [...g.values()].sort((a, b) => (a.capa === b.capa ? (orden.get(a.zona) ?? 999) - (orden.get(b.zona) ?? 999) : a.capa === 'piel' ? -1 : 1));
  }, [marcas]);
  const tiposUsados = useMemo(() => TIPOS_MARCA.filter((t) => marcasCapa.some((m) => m.tipo === t.id)), [marcasCapa]);

  const VIDRIO = 'backdrop-blur-md bg-slate-950/45 border border-white/10 text-slate-100 shadow-lg shadow-black/20';
  const BTN_VIDRIO = 'h-9 min-w-9 px-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 active:bg-white/20 transition-colors';
  const TARJETA = 'rounded-2xl border border-outline-variant/30 bg-surface-container-lowest';
  const colorHerramienta = herramienta === 'borrar' ? '#64748b' : COLOR_TIPO[herramienta];

  return (
    <div className="space-y-4" data-testid="mapa-corporal-3d">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Lienzo 3D */}
        <div className="relative rounded-3xl overflow-hidden ring-1 ring-slate-900/10 shadow-xl shadow-slate-900/10"
          style={{ background: 'radial-gradient(115% 80% at 50% 36%, #42536f 0%, #1f2a3d 46%, #0a101c 100%)' }}>
          <div ref={contRef} className="h-[500px] sm:h-[600px] w-full select-none" />
          {sin3d && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-200">
              Este equipo no muestra gráficos 3D. Usa la lista de zonas para marcar.
            </div>
          )}
          {!sin3d && listo === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300 pointer-events-none" data-testid="cuerpo-preparando">
              <span className="material-symbols-outlined animate-spin mr-2 text-base">progress_activity</span>Preparando el cuerpo 3D…
            </div>
          )}
          {!sin3d && (
            <>
              {/* Vistas */}
              <div className={`absolute top-3 left-3 flex rounded-xl overflow-hidden divide-x divide-white/10 ${VIDRIO}`}>
                {VISTAS.map((v) => (
                  <button key={v.id} type="button" className={BTN_VIDRIO} title={v.titulo} onClick={() => camaraRef.current?.irA(v.ang)}>{v.label}</button>
                ))}
              </div>
              {/* Acercar / alejar */}
              <div className={`absolute top-3 right-3 flex flex-col rounded-xl overflow-hidden divide-y divide-white/10 ${VIDRIO}`}>
                <button type="button" className={BTN_VIDRIO} onClick={() => camaraRef.current?.acercar(0.7)} aria-label="Acercar"><span className="material-symbols-outlined text-lg leading-none">add</span></button>
                <button type="button" className={BTN_VIDRIO} onClick={() => camaraRef.current?.acercar(1.4)} aria-label="Alejar"><span className="material-symbols-outlined text-lg leading-none">remove</span></button>
              </div>
              {/* Capa: piel o músculos */}
              <div className="absolute top-14 left-3 pointer-events-none">
                <div className={`pointer-events-auto flex rounded-xl overflow-hidden p-0.5 gap-0.5 ${VIDRIO}`}>
                  {CAPAS.map((c) => (
                    <button key={c.id} type="button" onClick={() => { setAvisoCapa(null); setCapa(c.id); }} aria-pressed={capa === c.id} data-testid={`capa-${c.id}`}
                      className={`h-8 inline-flex items-center gap-1 px-2.5 rounded-lg text-xs font-semibold transition-colors ${capa === c.id ? 'bg-white text-slate-900' : 'text-slate-200 hover:bg-white/10'}`}>
                      <span className="material-symbols-outlined text-base leading-none">{c.icono}</span>{c.label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Lo que hay bajo el puntero: el músculo o hueso (capa de músculos) y la zona */}
              {hover && (
                <div className="absolute top-14 left-52 right-16 flex justify-end pointer-events-none">
                  <span className={`rounded-full px-3 py-1.5 text-xs font-semibold text-center ${VIDRIO}`} data-testid="zona-bajo-puntero">
                    {hoverParte ? <>{hoverParte}<span className="font-normal text-slate-300"> · {LABEL_ZONA[hover]}</span></> : LABEL_ZONA[hover]}
                  </span>
                </div>
              )}
              {(cargandoCapa || avisoCapa) && listo > 0 && (
                <div className="absolute top-28 inset-x-0 flex justify-center pointer-events-none">
                  <span className={`rounded-full px-3 py-1 text-xs ${VIDRIO}`}>{cargandoCapa ? 'Cargando la capa de músculos…' : avisoCapa}</span>
                </div>
              )}
              {/* Pie: leyenda de lo marcado y cómo moverse */}
              <div className="absolute bottom-3 inset-x-3 flex flex-wrap items-end justify-between gap-2 pointer-events-none">
                <div className="flex flex-wrap gap-1.5 max-w-[70%]">
                  {tiposUsados.map((t) => (
                    <span key={t.id} className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-0.5 text-[11px] font-semibold ${VIDRIO}`}>
                      <span className="w-2.5 h-2.5 rounded-full ring-1 ring-white/40" style={{ background: t.color }} />{t.label}
                    </span>
                  ))}
                </div>
                <span className="text-[11px] text-slate-300/70 text-right">
                  {modo === 'pincel' && editable ? 'Para girar: arrastra fuera del cuerpo o usa las vistas' : 'Arrastra para girar'} · pellizco o Ctrl + rueda para acercar
                  {/* Atribución que exige la licencia de los modelos (BodyParts3D, CC BY 4.0) */}
                  {credito && <span className="block text-[10px] text-slate-400/80" data-testid="credito-modelo">{credito}</span>}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Herramientas */}
        <div className="space-y-3">
          {editable && (
            <div className={`${TARJETA} p-3 space-y-3`}>
              <div className="flex rounded-xl bg-surface-container-low p-1">
                {([['pincel', 'brush', 'Pincel'], ['zona', 'touch_app', 'Zona completa']] as const).map(([m, icono, texto]) => (
                  <button key={m} type="button" onClick={() => { setModo(m); setZonaSel(null); }} data-testid={`modo-${m}`} aria-pressed={modo === m}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors ${modo === m ? 'bg-primary text-white shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>
                    <span className="material-symbols-outlined text-base leading-none">{icono}</span>{texto}
                  </button>
                ))}
              </div>
              {modo === 'pincel' ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1.5">Qué pintar</p>
                    <div className="flex flex-wrap gap-1.5">
                      {TIPOS_MARCA.map((t) => {
                        const activo = herramienta === t.id;
                        return (
                          <button key={t.id} type="button" onClick={() => setHerramienta(t.id)} aria-pressed={activo} data-testid={`pincel-${t.id}`}
                            className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${activo ? 'text-white shadow-sm' : 'border-outline-variant/40 text-on-surface hover:border-outline-variant'}`}
                            style={activo ? { background: t.color, borderColor: t.color } : undefined}>
                            <span className="w-3.5 h-3.5 rounded-full ring-1 ring-black/10" style={{ background: activo ? '#ffffff55' : t.color }} />{t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant mb-1.5">Grosor</p>
                      <div className="flex gap-1.5">
                        {GROSORES.map((g, i) => (
                          <button key={g.id} type="button" onClick={() => setGrosor(g.id)} aria-pressed={grosor === g.id} title={g.label} data-testid={`grosor-${g.id}`}
                            className={`w-11 h-11 rounded-xl border flex items-center justify-center transition-colors ${grosor === g.id ? 'border-primary bg-primary/10' : 'border-outline-variant/40 hover:border-outline-variant'}`}>
                            <span className="rounded-full" style={{ width: 8 + i * 8, height: 8 + i * 8, background: colorHerramienta }} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => setHerramienta('borrar')} aria-pressed={herramienta === 'borrar'} data-testid="pincel-borrar"
                      className={`h-11 inline-flex items-center gap-1.5 px-3 rounded-xl border text-xs font-semibold transition-colors ${herramienta === 'borrar' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/40 text-on-surface hover:border-outline-variant'}`}>
                      <span className="material-symbols-outlined text-lg leading-none">ink_eraser</span>Borrador
                    </button>
                  </div>
                  <p className="text-[11px] text-on-surface-variant leading-snug">
                    Pinta sobre el cuerpo justo donde está el hallazgo. El borrador quita lo pintado; un hallazgo de zona completa se quita desde la lista.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">Zona</label>
                  <select value={zonaSel ?? ''} onChange={(e) => setZonaSel(e.target.value || null)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-sm text-on-surface">
                    <option value="">Toca una zona del cuerpo o elígela aquí…</option>
                    {ZONAS_ORDENADAS.map((z) => <option key={z.zona} value={z.zona}>{z.label}</option>)}
                  </select>
                  {zonaSel && (
                    <div className="space-y-2 pt-1">
                      <p className="text-sm font-bold text-on-surface">{LABEL_ZONA[zonaSel]}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {TIPOS_MARCA.map((t) => {
                          const activo = marcasDeZona.some((m) => m.tipo === t.id);
                          return (
                            <button key={t.id} type="button" onClick={() => alternarTipo(t.id)} aria-pressed={activo}
                              className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${activo ? 'text-white shadow-sm' : 'border-outline-variant/40 text-on-surface hover:border-outline-variant'}`}
                              style={activo ? { background: t.color, borderColor: t.color } : undefined}>
                              <span className="w-3.5 h-3.5 rounded-full ring-1 ring-black/10" style={{ background: activo ? '#ffffff55' : t.color }} />{t.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[11px] text-on-surface-variant">Marca el hallazgo en toda la zona. Para señalar solo una parte, usa el pincel.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Lista: lo marcado, cada uno con su escala y su nota (también sirve sin 3D) */}
          <div className={`${TARJETA} p-3`}>
            <h4 className="text-sm font-bold text-on-surface mb-2 flex items-center gap-2">
              Hallazgos <span className="text-xs font-semibold text-on-surface-variant bg-surface-container-low rounded-full px-2 py-0.5">{marcas.length}</span>
            </h4>
            {grupos.length === 0 && <p className="text-sm text-on-surface-variant">Todavía no hay nada marcado.</p>}
            <div className="space-y-2">
              {grupos.map((gr) => {
                const elegida = gr.capa === capa && gr.zona === zonaSel;
                return (
                  <div key={`${gr.capa}|${gr.zona}`} className={`rounded-xl border px-3 py-2 transition-colors ${elegida ? 'border-primary/50 bg-primary/5' : 'border-outline-variant/20'}`}>
                    <button type="button" onClick={() => { if (gr.capa !== capa) setCapa(gr.capa); setZonaSel(elegida ? null : gr.zona); }}
                      className="text-sm font-semibold text-on-surface hover:text-primary text-left inline-flex items-center gap-2">
                      {LABEL_ZONA[gr.zona] ?? gr.zona}
                      {gr.capa === 'musculos' && <span className="text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-1.5 py-0.5">Músculos</span>}
                    </button>
                    <div className="mt-1.5 space-y-2">
                      {gr.ms.map((m) => {
                        const pintado = Boolean(m.puntos?.length);
                        return (
                          <div key={m.tipo} data-testid={`hallazgo-${gr.capa}-${gr.zona}-${m.tipo}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-semibold pl-1.5 pr-2 py-0.5 rounded-full text-white" style={{ background: COLOR_TIPO[m.tipo] }}
                                title={pintado ? 'Pintado con el pincel: solo esa parte de la zona' : 'Toda la zona'}>
                                <span className="material-symbols-outlined text-sm leading-none">{pintado ? 'brush' : 'select_all'}</span>{LABEL_TIPO[m.tipo]}
                              </span>
                              {editable ? (
                                <>
                                  <input defaultValue={m.nota ?? ''} maxLength={300} placeholder="Nota (opcional)"
                                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (m.nota ?? null)) editarMarca(m, { nota: v }); }}
                                    className="flex-1 min-w-[140px] bg-surface-container-low border border-outline-variant rounded-lg px-2 py-1 text-xs" />
                                  <button type="button" onClick={() => quitarMarca(m)} aria-label="Quitar" className="material-symbols-outlined text-on-surface-variant/60 hover:text-rose-600 text-lg">delete</button>
                                </>
                              ) : (
                                <span className="text-xs text-on-surface-variant">
                                  {pintado ? 'parte de la zona' : 'toda la zona'}{m.nota ? ` · ${m.nota}` : ''}
                                </span>
                              )}
                            </div>
                            {m.estructuras?.length ? <p className="mt-1 text-[11px] text-on-surface-variant leading-snug">{m.estructuras.join(' · ')}</p> : null}
                            {/* La escala es de CADA hallazgo: EVA en el dolor, intensidad en lo demás */}
                            <div className="mt-1.5">
                              <EscalaPunto tipo={m.tipo} valor={m.intensidad ?? null} editable={editable} anterior={anteriorDe?.(m) ?? null}
                                onCambiar={(v) => editarMarca(m, { intensidad: v })} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
