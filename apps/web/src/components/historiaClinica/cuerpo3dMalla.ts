import * as THREE from 'three';
import urlPiel from '../../assets/cuerpo3d.bin?url';
import urlMusculos from '../../assets/cuerpo3d-musculos.lbcz?url';
import type { CapaCuerpo } from './cuerpo3dModelo';

/**
 * Los dos modelos del mapa corporal 3D; aquí solo se descargan y se leen (los prepara `tools/cuerpo3d/construir.mjs`).
 * Son el MISMO cuerpo, de BodyParts3D 4.0 (CC BY 4.0: la pantalla DEBE mostrar su crédito, que viene en `credito`):
 *  · «piel»: su superficie corporal, hecha simétrica, neutra y suavizada (`cuerpo3d.bin`).
 *  · «musculos»: sus músculos y huesos, simplificados (`cuerpo3d-musculos.lbcz`, el mismo formato comprimido con gzip).
 *    Se baja solo si se abre.
 * Los dos traen el sombreado de pliegues horneado y cada vértice asignado a su ZONA (las mismas en ambos).
 * Formato «LBC1»: u32 largo | JSON { zonas, nV, nT, nL, min, tam, idx32, partes?, credito? } | pos Int16×3 | nor Int8×3 | ao Uint8 |
 * zona Uint8 (bits 6-7: ojo) | índices | líneas Int16×3 | pieza de cada vértice Uint16 (si hay `partes`). Cada bloque alineado a 4 bytes.
 */
export interface CuerpoDatos {
  pos: Float32Array; // 3 por vértice (metros; pies en y = 0; izquierda del paciente en x > 0)
  nor: Int8Array; // 3 por vértice (normalizada ×127)
  ao: Uint8Array; // oclusión por vértice (255 = a plena luz)
  zonaV: string[]; // zona de cada vértice (un vértice es de una sola zona: en los bordes está duplicado)
  ojo: Uint8Array; // 0 = piel · 1 = esclera · 2 = iris · 3 = pupila
  indices: Uint16Array | Uint32Array;
  lineas: Float32Array; // bordes entre zonas: pares de puntos (vacío en la capa de músculos)
  /** Capa de músculos: las piezas (nombre y tejido: m músculo · t tendón/ligamento · h hueso · c cartílago) y la de cada vértice. */
  partes: { n: string; t: 'm' | 't' | 'h' | 'c' }[] | null;
  parteV: Uint16Array | null;
  /** Atribución que la licencia del modelo obliga a mostrar (o null). */
  credito: string | null;
  alto: number; ancho: number;
}

const promesas = new Map<CapaCuerpo, Promise<CuerpoDatos>>();

export function cargarCuerpo(capa: CapaCuerpo = 'piel'): Promise<CuerpoDatos> {
  let p = promesas.get(capa);
  if (!p) {
    p = fetch(capa === 'musculos' ? urlMusculos : urlPiel)
      .then(async (r) => {
        if (!r.ok) throw new Error(`No se pudo descargar el modelo (${r.status})`);
        if (capa !== 'musculos') return r.arrayBuffer();
        // Viene comprimido con gzip (5,4 MB → 2,5 MB); el navegador lo descomprime al vuelo.
        if (typeof DecompressionStream === 'undefined' || !r.body) throw new Error('Este navegador no puede abrir la capa de músculos');
        return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      })
      .then(leer)
      .catch((e) => { promesas.delete(capa); throw e; }); // un fallo de red no queda guardado: se reintenta al volver a abrir
    promesas.set(capa, p);
  }
  return p;
}

function leer(buf: ArrayBuffer): CuerpoDatos {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'LBC1') throw new Error('Modelo 3D con formato desconocido');
  const largo = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, largo))) as {
    zonas: string[]; nV: number; nT: number; nL: number; min: number[]; tam: number[]; idx32: boolean;
    partes?: { n: string; t: 'm' | 't' | 'h' | 'c' }[]; credito?: string;
  };
  const al4 = (n: number) => n + ((4 - (n % 4)) % 4);
  let o = al4(8 + largo);
  const expandir = (q: Int16Array) => {
    const f = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) f[i] = meta.min[i % 3] + ((q[i] + 32768) / 65535) * meta.tam[i % 3];
    return f;
  };
  const pos = expandir(new Int16Array(buf.slice(o, o + meta.nV * 6))); o += meta.nV * 6;
  const nor = new Int8Array(buf.slice(o, o + meta.nV * 3)); o += meta.nV * 3;
  const ao = new Uint8Array(buf.slice(o, o + meta.nV)); o += meta.nV;
  const zonaIdx = new Uint8Array(buf.slice(o, o + meta.nV)); o = al4(o + meta.nV);
  const nI = meta.nT * 3;
  const indices = meta.idx32 ? new Uint32Array(buf.slice(o, o + nI * 4)) : new Uint16Array(buf.slice(o, o + nI * 2));
  o += nI * (meta.idx32 ? 4 : 2);
  const lineas = expandir(new Int16Array(buf.slice(o, o + meta.nL * 6)));
  o += meta.nL * 6;
  const parteV = meta.partes ? new Uint16Array(buf.slice(o, o + meta.nV * 2)) : null;
  return {
    pos, nor, ao, zonaV: Array.from(zonaIdx, (z) => meta.zonas[z & 63]), ojo: zonaIdx.map((z) => z >> 6), indices, lineas,
    partes: meta.partes ?? null, parteV, credito: meta.credito ?? null, alto: meta.min[1] + meta.tam[1], ancho: meta.tam[0] };
}

/** Geometría de three.js; el atributo `color` lo pinta la pantalla (color de la zona × sombreado). */
export function geometriaCuerpo(d: CuerpoDatos): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.nor, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(d.pos.length), 3));
  g.setIndex(new THREE.BufferAttribute(d.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Búsqueda rápida de vértices cercanos a un punto (rejilla de 3 cm): la usan el pincel y el dibujo de lo pintado. */
export interface IndiceVertices {
  /** Llama a `visitar` con cada vértice a menos de `r` metros (y su distancia al cuadrado). */
  cerca(x: number, y: number, z: number, r: number, visitar: (v: number, d2: number) => void): void;
  /** El vértice más cercano a menos de `max` metros, o -1. */
  masCercano(x: number, y: number, z: number, max: number): number;
}

export function indiceVertices(pos: Float32Array): IndiceVertices {
  const CEL = 0.03;
  const celda = (x: number) => Math.floor(x / CEL);
  const clave = (i: number, j: number, k: number) => (i + 128) + 512 * ((j + 128) + 512 * (k + 128));
  const rejilla = new Map<number, number[]>();
  for (let v = 0; v < pos.length / 3; v++) {
    const k = clave(celda(pos[v * 3]), celda(pos[v * 3 + 1]), celda(pos[v * 3 + 2]));
    const lista = rejilla.get(k);
    if (lista) lista.push(v); else rejilla.set(k, [v]);
  }
  const cerca: IndiceVertices['cerca'] = (x, y, z, r, visitar) => {
    const r2 = r * r;
    for (let i = celda(x - r); i <= celda(x + r); i++) for (let j = celda(y - r); j <= celda(y + r); j++) for (let k = celda(z - r); k <= celda(z + r); k++) {
      const lista = rejilla.get(clave(i, j, k));
      if (!lista) continue;
      for (const v of lista) {
        const dx = pos[v * 3] - x, dy = pos[v * 3 + 1] - y, dz = pos[v * 3 + 2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 <= r2) visitar(v, d2);
      }
    }
  };
  return {
    cerca,
    masCercano: (x, y, z, max) => {
      let mejor = -1, dm = Infinity;
      cerca(x, y, z, max, (v, d2) => { if (d2 < dm) { dm = d2; mejor = v; } });
      return mejor;
    },
  };
}
