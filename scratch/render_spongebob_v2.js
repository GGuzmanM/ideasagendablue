const sharp = require('sharp');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño
  R: '#ef4444', r: '#b91c1c', W: '#ffffff', w: '#f1f5f9',

  // Esponja
  Y: '#facc15', // Amarillo SpongeBob vivo
  y: '#eab308', // Amarillo sombra
  d: '#ca8a04', // Poros verde-oliva
  k: '#0f172a', // Contornos / pestañas / pupila
  N: '#f59e0b', // Nariz alargada

  // Ojos celestes
  A: '#38bdf8', // Celeste cielo vivo
  a: '#0284c7', // Azul iris
  K: '#0f172a', // Pupila negra

  // Mejillas, pecas y boca
  p: '#fb7185', // Rubor rosado
  q: '#be123c', // Pecas rojas
  m: '#881337', // Fondo boca oscura
  l: '#f43f5e', // Lengua rosada
  D: '#ffffff', // Dientes cuadrados separados

  // Uniforme
  C: '#ffffff', // Camisa blanca
  T: '#ef4444', // Corbata roja
  P: '#854d0e', // Pantalón marrón
  t: '#713f12', // Marrón sombra
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

// Matriz de Bob Esponja Navideño (24 cols x 26 rows)
const BOB_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Punta doblada con sombra
  '............RRRRrr......', // 2: Caída del gorrito rojo
  '..........RRRRRRrr......', // 3: Cono del gorro
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa
  '....kYYYYYYYYYYYYYYYYk..', // 6: Tope esponjoso
  '..kYdYYYYYYdYYYYYYdYYYk.', // 7: Frente con poros esponjosos
  '..kYY..k.k.k..k.k.k.YYk.', // 8: Pestañas de ambos ojos (3 en cada ojo)
  '........................', // 9: (Ojos dinámicos)
  '........................', // 10: (Ojos dinámicos)
  '..kYpkkYYYYNNYYYYkkpYYk.', // 11: Mejillas con rubor y naricita saliente
  '..kYqqkDDkmmmmkDDkqYYYk.', // 12: Pecas y dos dientes separados sobre la boca
  '..kYYYYkllllllllkYYYYYk.', // 13: Lengüita rosada alegre
  '..kYYYYYkkkkkkkkYYYYYYk.', // 14: Barbilla con hoyuelos
  '..kYYk.kCCCCCCCCk.kYYk..', // 15: Bracitos amarillos y cuello camisa blanca
  '..kYYk.kCCCTCCCCk.kYYk..', // 16: Corbata roja navideña
  '..kYYk.kCCCTCCCCk.kYYk..', // 17: Corbata roja
  '...kYk.kPPUUPPUUPk.kYk..', // 18: Manitos en jarras y cinturón
  '....kk.kPPPPPPPPPk.kk...', // 19: Pantalones cuadrados marrones
  '........kPPk.kPPk.......', // 20: Perneras de los pantalones
  '........kYYk.kYYk.......', // 21: Piernitas delgadas amarillas
  '........kHHk.kHHk.......', // 22: Franja roja de las medias
  '........kIIk.kIIk.......', // 23: Franja azul de las medias
  '.......kSSSk.kSSSk......', // 24: Zapatitos negros de charol
  '......kSSSSk.kSSSSk.....', // 25: Base apoyada en la nieve
];

// Ojos grandes celestes con brillo blanco y pupila negra
// Ojo izq: cols 5..9 (5 pixels)
// Ojo der: cols 11..15 (5 pixels)
// Con puente / contacto en col 10
const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..kYY.kWWWk..kWWWk..YYk.' },
  { fila: 10, mapa: '..kYY.kWAKk..kWAKk..YYk.' },
];

const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..kYY.kYYYk..kYYYk..YYk.' },
  { fila: 10, mapa: '..kYY.kkkkk..kkkkk..YYk.' },
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
  await sharp(Buffer.from(renderScene(BOB_OJOS_ABIERTOS))).png().toFile(`${dir}/bob_v2_open.png`);
  await sharp(Buffer.from(renderScene(BOB_OJOS_CERRADOS))).png().toFile(`${dir}/bob_v2_blink.png`);
  console.log('Saved Bob v2!');
}
main();
