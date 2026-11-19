const sharp = require('sharp');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño
  R: '#ef4444', r: '#b91c1c', W: '#ffffff', w: '#f1f5f9',

  // Esponja
  Y: '#facc15', // Amarillo SpongeBob vivo cálido
  y: '#eab308', // Amarillo sombra
  d: '#ca8a04', // Poros amarillo-oliva suaves
  k: '#1e293b', // Contornos suaves
  N: '#f59e0b', // Nariz simpática

  // Ojos brillantes tiernos
  A: '#38bdf8', // Celeste cielo vivo
  a: '#0284c7', // Azul iris
  K: '#0f172a', // Pupila negra
  w: '#ffffff', // Brillo destello blanco

  // Mejillas tiernas y sonrisa dulce
  p: '#fca5a5', // Rubor rosado pastel
  q: '#f43f5e', // Pecas suaves
  m: '#881337', // Boca fondo cálido
  l: '#fb7185', // Lengüita rosada tierna
  D: '#ffffff', // Dientes frontales blancos

  // Uniforme
  C: '#ffffff', // Camisa blanca
  T: '#ef4444', // Corbata roja
  P: '#854d0e', // Pantalones marrones
  U: '#0f172a', // Cinturón negro
  H: '#ef4444', // Franja roja medias
  I: '#38bdf8', // Franja azul medias
  S: '#0f172a', // Zapatos negros
};

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

// Matriz de Bob Esponja ULTRA FRIENDLY / CUTE (24 cols x 26 rows)
const BOB_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Caída del gorro doblado
  '............RRRRrr......', // 2: Cono del gorrito rojo
  '..........RRRRRRrr......', // 3: Cuerpo del gorro
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa
  '....kYYYYYYYYYYYYYYYYk..', // 6: Tope esponjoso amarillo
  '....kYYdYYdYYYYYdYYdYk..', // 7: Frente con poros suaves
  '....kYYk.k.YYYY.k.kYYk..', // 8: Pestañas delicadas (2 en cada ojo)
  '........................', // 9: (Ojos dinámicos)
  '........................', // 10: (Ojos dinámicos)
  '........................', // 11: (Ojos dinámicos y nariz)
  '....kpqqkYYYYNNkYYkqqpk.', // 12: Mejillas rosadas con pecas y naricita
  '....kYYk.kDDk..kDDk.kYk.', // 13: 2 DIENTES TIERNOS separados bajo la sonrisa
  '....kYYYkmmmmllmmmmkYk..', // 14: Boquita abierta sonriente con lengüita rosada
  '....kYYYYkkkllllkkkYYk..', // 15: Curva dulce de la barbilla
  '..kCkCCCCCCCCCCCCCCkCk..', // 16: Mangas blancas de camisa
  '.kYk.kCCCCTTTCCCCCk.kYk.', // 17: Bracitos amarillos y corbata roja
  '.kYk.kPPUUPPUUPPUUPk.kYk', // 18: Manitos en jarras y cinturón
  '..kk.kPPPPPPPPPPPPk..kk.', // 19: Pantalones cuadrados marrones
  '......kPPPk....kPPPk....', // 20: Perneras del pantalón
  '.......kYk......kYk.....', // 21: Piernitas delgadas amarillas
  '.......kHk......kHk.....', // 22: Franja roja de las medias
  '.......kIk......kIk.....', // 23: Franja azul de las medias
  '.......kWk......kWk.....', // 24: Medias blancas
  '......kSSSk....kSSSk....', // 25: Zapatitos negros de charol en la nieve
];

// Ojos grandes, brillantes, súper tiernos y amigables:
// Pupila y reflejo mirando con ternura hacia el árbol
const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '....kY..WWWW....WWWW..Yk' },
  { fila: 10, mapa: '....kY.WWKAW..NNWWKAW.Yk' },
  { fila: 11, mapa: '....kY.WWAAW..NNWWAAW.Yk' },
];

// Parpadeo tierno (^ ^) con mejillas felices
const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '....kY.YYYYYY..YYYYYY.Yk' },
  { fila: 10, mapa: '....kY.kYYYYk.NNkYYYYkYk' },
  { fila: 11, mapa: '....kY..kkkk....kkkk..Yk' },
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

function renderScene(ojos) {
  const mapa = BOB_BASE.map((f, i) => {
    const o = ojos.find(x => x.fila === i);
    if (!o) return f;
    let res = '';
    for (let c = 0; c < f.length; c++) {
      if (o.mapa[c] && o.mapa[c] !== '.') res += o.mapa[c];
      else res += f[c];
    }
    return res;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="240" viewBox="0 0 135 72" shape-rendering="crispEdges">
    <rect width="135" height="72" fill="#0b1e38" />
    <rect x="8" y="64" width="119" height="5" rx="2.5" fill="rgba(255,255,255,0.85)" />
    <!-- Arbolito (lado 3) -->
    <g transform="translate(10, 7) scale(3)">
      ${svgContent(ARBOL)}
    </g>
    <!-- Bob Esponja (lado 2) -->
    <g transform="translate(68, 12) scale(2)">
      ${svgContent(mapa)}
    </g>
  </svg>`;
}

async function main() {
  const dir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderScene(BOB_OJOS_ABIERTOS))).png().toFile(`${dir}/bob_cute_open.png`);
  await sharp(Buffer.from(renderScene(BOB_OJOS_CERRADOS))).png().toFile(`${dir}/bob_cute_blink.png`);
  console.log('Saved Bob cute!');
}
main();
