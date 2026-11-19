const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Harry Potter Paleta
  R: '#dc2626', // Rojo navideño / Gryffindor
  r: '#991b1b', // Rojo sombra
  W: '#ffffff', // Blanco (pompón, felpa, destello)
  H: '#111827', // Cabello negro azabache
  h: '#1f2937', // Cabello negro sombra/volumen
  F: '#fed7aa', // Piel cálida
  s: '#fbcfe8', // Rubor rosado mejilla
  Z: '#b91c1c', // Cicatriz de rayo rojo oscuro / vino
  z: '#ef4444', // Cicatriz brillo
  V: '#0f172a', // Marco de los lentes redondos (negro)
  K: '#0f172a', // Pupila
  E: '#15803d', // Iris verde esmeralda icónico de Harry
  A: '#fbbf24', // Amarillo / Dorado Gryffindor
  a: '#d97706', // Dorado sombra Gryffindor
  T: '#1e293b', // Túnica gris oscura
  t: '#0f172a', // Túnica contorno / pliegues
  M: '#78350f', // Varita madera
  m: '#b45309', // Varita punta
  X: '#fef08a', // Chispita mágica
  P: '#334155', // Pantalón
  S: '#0f172a', // Zapatos negros
};

// Árbol para referencia de escala y composición
const ARBOL = [
  '.......Y.......',
  '......YYY......',
  '.......Y.......',
  '.......G.......',
  '......GGG......',
  '.....GGRGg.....',
  '....GGGGGGg....',
  '......GGg......',
  '.....GLGGg.....',
  '....GGGGGOg....',
  '...GRGGGGGGg...',
  '..GGGGGGLGGGg..',
  '.....GGGGg.....',
  '....GGOGGGg....',
  '...GGGGGGRGg...',
  '..GLGGGGGGGGg..',
  '.GGGGGGOGGGGGg.',
  '......BBB......',
  '......BBB......',
];

// Harry Potter (22 cols x 22 rows)
// Gorrito navideño inclinado, mechones desordenados, cicatriz rayo en frente,
// lentes redondos grandes con ojos verdes esmeralda, bufanda Gryffindor roja y dorada,
// túnica de Hogwarts y varita mágica con chispita apuntando hacia arriba.
const HARRY_BASE = [
  '............RRWW......', // 0: Pompón blanco esponjoso
  '...........RRRRWW.....', // 1: Punta doblada del gorro
  '.........RRRRRR.......', // 2: Caída del gorrito rojo
  '.......RRRRRRRR.......', // 3: Cono del gorro
  '.....RRRRRRRRRRR......', // 4: Gorro rojo
  '....WWWWWWWWWWWWW.....', // 5: Felpa blanca esponjosa del gorro
  '...HHHHHHHHHHHHHHH....', // 6: Cabello negro azabache desordenado
  '..HH.HHHHZZHHHHH.HH...', // 7: Flequillo con mechones y cicatriz de rayo (ZZ)
  '..H.F.FFFZFFFF.F..H...', // 8: Frente descubierta con cicatriz
  '......................', // 9: (Ojos dinámicos con lentes)
  '......................', // 10: (Ojos dinámicos con lentes)
  '..H.FFFFFFFFFFFF..H...', // 11: Mejillas tiernas y naricita
  '..HH..FFFFFFFF..HH....', // 12: Boquita y barbilla
  '....RRRRAAAARRRR......', // 13: Bufanda Gryffindor: rojo y dorado
  '....AAAARRRRAAAA......', // 14: Segunda vuelta de bufanda
  '..m.RRRRAAAARRRR.RR...', // 15: Bufanda con caída lateral (RR) y mano con varita
  '.M..TtTTtTTtTTTt.RR...', // 16: Túnica Hogwarts y flecos bufanda
  '.M..TTTTTTTTTTTT.AA...', // 17: Túnica y flecos dorados
  '....TTTTTTTTTTTT......', // 18: Túnica cuerpo
  '....PPPP....PPPP......', // 19: Pantalón
  '...SSSS......SSSS.....', // 20: Zapatitos apoyados en la nieve
  '......................', // 21: Base
];

const HARRY_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..H.VVVVV..VVVVV..H...' },
  { fila: 10, mapa: '..H.VWEKV..VWEKV..H...' },
  { fila: 11, mapa: '..H.sVVVs..sVVVs..H...' },
];

const HARRY_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..H.VVVVV..VVVVV..H...' },
  { fila: 10, mapa: '..H.VvvvV..VvvvV..H...' },
  { fila: 11, mapa: '..H.sVVVs..sVVVs..H...' },
];

function svgContent(mapa) {
  let rects = '';
  mapa.forEach((fila, y) => {
    [...fila].forEach((c, x) => {
      if (c === '.') return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORES[c] || '#000'}" />`;
    });
  });
  return rects;
}

function fullSvg(ojos) {
  const mapa = HARRY_BASE.map((f, i) => {
    const o = ojos.find(x => x.fila === i);
    if (!o) return f;
    let res = '';
    for (let c = 0; c < f.length; c++) {
      if (o.mapa[c] && o.mapa[c] !== '.') res += o.mapa[c];
      else res += f[c];
    }
    return res;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="230" viewBox="0 0 135 70" shape-rendering="crispEdges">
    <rect width="135" height="70" fill="#0b1e38" />
    <rect x="8" y="62" width="119" height="5" rx="2.5" fill="rgba(255,255,255,0.85)" />
    <!-- Arbolito (lado 3) -->
    <g transform="translate(10, 5) scale(3)">
      ${svgContent(ARBOL)}
    </g>
    <!-- Harry Potter (lado 2) -->
    <g transform="translate(70, 20) scale(2)">
      ${svgContent(mapa)}
    </g>
  </svg>`;
}

async function run() {
  const dir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(fullSvg(HARRY_OJOS_ABIERTOS))).png().toFile(`${dir}/harry_test_open.png`);
  await sharp(Buffer.from(fullSvg(HARRY_OJOS_CERRADOS))).png().toFile(`${dir}/harry_test_blink.png`);
  console.log('Rendered test images!');
}
run();
