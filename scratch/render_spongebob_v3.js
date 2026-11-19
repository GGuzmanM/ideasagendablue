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
  d: '#a16207', // Poros verde-oliva / mostaza
  k: '#0f172a', // Contorno / pestañas / pupila
  N: '#f59e0b', // Nariz amarilla saliente
  n: '#d97706', // Sombra nariz

  // Ojos azules icónicos
  A: '#38bdf8', // Celeste cielo vivo
  a: '#0284c7', // Azul iris
  K: '#0f172a', // Pupila negra
  E: '#0f172a', // Pestañas

  // Mejillas, pecas y boca
  p: '#fb7185', // Rubor rosado mejillas
  q: '#be123c', // Pecas rojas
  m: '#881337', // Fondo boca oscura
  l: '#f43f5e', // Lengua rosada
  D: '#ffffff', // Dientes separados clásicos de Bob

  // Uniforme
  C: '#ffffff', // Camisa blanca
  T: '#ef4444', // Corbata roja
  P: '#854d0e', // Pantalones cuadrados marrones
  t: '#713f12', // Marrón sombra
  U: '#0f172a', // Cinturón negro
  H: '#ef4444', // Franja roja de las medias
  I: '#38bdf8', // Franja azul de las medias
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

// Matriz de Bob Esponja Pro (24 cols x 26 rows)
const BOB_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Caída del gorro doblado
  '............RRRRrr......', // 2: Cono del gorrito rojo
  '..........RRRRRRrr......', // 3: Cuerpo del gorro
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa del gorro
  '....kYYYYYYYYYYYYYYYYk..', // 6: Tope de la esponja amarilla
  '....kYdYYYdYYYYYYdYYYk..', // 7: Frente con poros esponjosos
  '....kY.E.E.EYY.E.E.EYk..', // 8: 3 pestañas sobre cada ojo
  '........................', // 9: (Ojos dinámicos)
  '........................', // 10: (Ojos dinámicos)
  '........................', // 11: (Ojos dinámicos con nariz saliente)
  '..kpqqkYkDDkkDDkYkqqpk..', // 12: Mejillas con pecas y 2 DIENTES SEPARADOS
  '..kppppkmmmmmmmmkppppk..', // 13: Boca abierta sonriente
  '...kYYYYkllllllkYYYYk...', // 14: Lengüita rosada alegre
  '....kYYYYkkkkkkYYYYk....', // 15: Barbilla con hoyuelo
  '..kYk.kCCCCCCCCCCk.kYk..', // 16: Brazos amarillos, cuello camisa blanca y corbata
  '..kYYkkCCCTTTCCCCkkYYk..', // 17: Corbata roja navideña
  '..kYYk.kPPUUPPUUPk.kYYk.', // 18: Manitos en jarras y cinturón negro
  '...kk..kPPPPPPPPPk..kk..', // 19: Pantalones cuadrados marrones
  '........kPPk.kPPk.......', // 20: Perneras del pantalón
  '........kYYk.kYYk.......', // 21: Piernitas delgadas amarillas
  '........kHHk.kHHk.......', // 22: Franja roja de las medias canónicas
  '........kIIk.kIIk.......', // 23: Franja azul de las medias canónicas
  '........kWk...kWk.......', // 24: Medias blancas
  '.......kSSk...kSSk......', // 25: Zapatitos negros de charol
];

// Ojos grandes contiguos con mirada alegre:
// Ojo izq: cols 5..9
// Ojo der: cols 13..17
// Nariz en el centro: cols 10..12
const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '....kY.kWWWk..kWWWk.Yk..' },
  { fila: 10, mapa: '....kYkWAKWkNNkKAWWkYk..' },
  { fila: 11, mapa: '....kYkWAKWkNNkKAWWkYk..' },
];

const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '....kY.kYYYk..kYYYk.Yk..' },
  { fila: 10, mapa: '....kYkYYYYkNNkYYYYkYk..' },
  { fila: 11, mapa: '....kYkkkkkkNNkkkkkkYk..' },
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
  await sharp(Buffer.from(renderScene(BOB_OJOS_ABIERTOS))).png().toFile(`${dir}/bob_v3_open.png`);
  await sharp(Buffer.from(renderScene(BOB_OJOS_CERRADOS))).png().toFile(`${dir}/bob_v3_blink.png`);
  console.log('Saved Bob v3!');
}
main();
