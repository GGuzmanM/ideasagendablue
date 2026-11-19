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
  d: '#ca8a04', // Poros mostaza suave
  k: '#1e293b', // Contorno suave (no negro chillón)
  N: '#f59e0b', // Nariz simpática

  // Ojos azules súper tiernos
  A: '#38bdf8', // Celeste cielo vivo
  a: '#0284c7', // Azul iris
  K: '#0f172a', // Pupila
  w: '#ffffff', // Reflejo blanco brillante

  // Sonrisa dulce y mejillas
  p: '#fca5a5', // Rubor rosado pastel
  q: '#f43f5e', // Pecas suaves
  m: '#9f1239', // Boca cálida
  l: '#fb7185', // Lengüita rosada tierna
  D: '#ffffff', // Dientes de conejo adorables

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

// Matriz de Bob Esponja ULTRA TIERNO Y AMIGABLE (24 cols x 26 rows)
// Cara 100% sólida amarilla, ojos celestes enormes y brillantes sin marcos oscuros,
// naricita dulce, mejillas sonrosadas y sus 2 dientecitos adorables sobre una sonrisa tierna.
const BOB_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Punta doblada con sombra
  '............RRRRrr......', // 2: Cono del gorrito rojo
  '..........RRRRRRrr......', // 3: Cuerpo del gorro
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa
  '....kYYYYYYYYYYYYYYYYk..', // 6: Tope esponjoso amarillo
  '....kYYdYYdYYYYYdYYdYk..', // 7: Frente con poros suaves
  '....kYYYYkYkYYYYkYkYYk..', // 8: Pestañas delicadas sobre frente sólida amarilla
  '........................', // 9: (Ojos dinámicos)
  '........................', // 10: (Ojos dinámicos)
  '........................', // 11: (Ojos dinámicos y nariz)
  '....kYppYYWWNNWWYYppYk..', // 12: Mejillas rosadas, base de ojos y nariz
  '....kYYk..DDYYDD..kYYk..', // 13: 2 DIENTES TIERNOS separados en sonrisa dulce
  '....kYYYkkmllllmmkkYYk..', // 14: Sonrisa abierta amable con lengüita rosada
  '....kYYYYYkkkkkkYYYYYk..', // 15: Barbilla tierna con hoyuelo
  '..kCkCCCCCCCCCCCCCCkCk..', // 16: Mangas blancas de camisa
  '.kYk.kCCCCTTTCCCCCk.kYk.', // 17: Bracitos amarillos y corbata roja
  '.kYk.kPPUUPPUUPPUUPk.kYk', // 18: Manitos en jarras y cinturón
  '..kk.kPPPPPPPPPPPPk..kk.', // 19: Pantalones cuadrados marrones
  '......kPPPk....kPPPk....', // 20: Perneras del pantalón
  '.......kYk......kYk.....', // 21: Piernitas delgadas amarillas
  '.......kHk......kHk.....', // 22: Franja roja de las medias canónicas
  '.......kIk......kIk.....', // 23: Franja azul de las medias canónicas
  '.......kWk......kWk.....', // 24: Medias blancas
  '......kSSSk....kSSSk....', // 25: Zapatitos negros de charol en la nieve
];

// Ojos gigantes, tiernos, súper expresivos (blancos puros con iris celeste y pupila amigable)
// Ojo izq: cols 7..10
// Nariz: cols 11..12
// Ojo der: cols 13..16
const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '....kYYYWWWWYYWWWWYYYk..' },
  { fila: 10, mapa: '....kYYYWWAKNNKAWWYYYk..' },
  { fila: 11, mapa: '....kYYYWWAKNNKAWWYYYk..' },
];

// Parpadeo dulce (^ ^)
const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '....kYYYYYYYYYYYYYYYYk..' },
  { fila: 10, mapa: '....kYYYkYYkNNkYYkYYYk..' },
  { fila: 11, mapa: '....kYYYYkkkNNkkkYYYYk..' },
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
  await sharp(Buffer.from(renderScene(BOB_OJOS_ABIERTOS))).png().toFile(`${dir}/bob_friendly_open.png`);
  await sharp(Buffer.from(renderScene(BOB_OJOS_CERRADOS))).png().toFile(`${dir}/bob_friendly_blink.png`);
  console.log('Saved Bob friendly!');
}
main();
