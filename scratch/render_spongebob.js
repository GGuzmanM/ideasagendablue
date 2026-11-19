const sharp = require('sharp');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño
  R: '#ef4444', // Rojo navideño vivo
  r: '#b91c1c', // Rojo sombra
  W: '#ffffff', // Blanco puro
  w: '#e2e8f0', // Felpa sombra suave

  // Esponja (cuerpo amarillo de Bob Esponja)
  Y: '#facc15', // Amarillo principal esponja
  y: '#eab308', // Amarillo medio
  d: '#ca8a04', // Poros / manchas verdes-oliva / mostaza
  k: '#0f172a', // Contorno / pestañas / pupila

  // Ojos azules icónicos de Bob Esponja
  B: '#38bdf8', // Celeste cielo vivo
  b: '#0284c7', // Azul iris profundo
  K: '#0f172a', // Pupila negra

  // Rostro / Mejillas / Dientes
  p: '#fb7185', // Rubor rosado mejillas con pecas
  q: '#e11d48', // Pecas en las mejillas
  D: '#ffffff', // Dientes cuadrados separados

  // Boca
  m: '#881337', // Boca abierta fondo oscuro
  l: '#f43f5e', // Lengüita rosada

  // Uniforme Krusty Krab / Escolar
  C: '#ffffff', // Camisa blanca
  T: '#ef4444', // Corbata roja
  P: '#854d0e', // Pantalones cuadrados marrones
  t: '#713f12', // Marrón sombra
  U: '#0f172a', // Cinturón negro con hebilla
  S: '#0f172a', // Zapatos negros brillantes
  s: '#38bdf8', // Franja azul media
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

// Matriz inicial de Bob Esponja (22 cols x 25 rows)
// Gorrito navideño inclinado en la esquina, cuerpo esponjoso amarillo con poros,
// grandes ojos celestes con 3 pestañas cada uno, nariz redonda saliente,
// dos dientes separados en amplia sonrisa, camisa blanca con corbata roja,
// pantalones cuadrados marrones con cinturón, y piernitas delgadas con zapatos negros.
const BOB_BASE = [
  '............RRWW......', // 0: Pompón blanco
  '...........RRrrWW.....', // 1: Punta doblada del gorro
  '.........RRRRrr.......', // 2: Cono del gorro
  '.......RRRRRRrr.......', // 3: Caída del gorro
  '.....RRRRRRRRrrrr.....', // 4: Base del gorro
  '....wWWWWWWWWWWWWw....', // 5: Felpa blanca del gorro
  '...kYYYYYYYYYYYYYYk...', // 6: Tope de la cabeza esponja ondulada
  '..kYdYYYYYYdYYYYYYYk..', // 7: Frente con poros esponjosos
  '..kYYk.k.kYYk.k.kYYk..', // 8: Pestañas (3 en cada ojo)
  '......................', // 9: (Ojos dinámicos)
  '......................', // 10: (Ojos dinámicos)
  '..kYpkkYYY..YYYkkpYk..', // 11: Mejillas con rubor y naricita
  '..kYYpYkDDkkDDkYpYYk..', // 12: Dientes separados clásicos de Bob
  '..kYYYkmmmmmmmmkYYYk..', // 13: Boca abierta con lengüita
  '..kYYYYkllllllkYYYYk..', // 14: Lengüita
  '...kYYYkkkkkkkkYYYk...', // 15: Barbilla ondulada
  '....kCCCCCCCCCCCCk....', // 16: Camisa blanca con cuello
  '....kCCCCCTCCCCCTk....', // 17: Corbata roja
  '....kPPPUUTUUUPPPk....', // 18: Pantalones cuadrados y cinturón
  '....kPPPPPPPPPPPPk....', // 19: Pantalones marrones
  '.....kPPPk..kPPPk.....', // 20: Perneras
  '......kYk....kYk......', // 21: Piernitas amarillas
  '......kWk....kWk......', // 22: Medias blancas
  '.....kSSk....kSSk.....', // 23: Zapatos negros
  '.....kSSk....kSSk.....', // 24: Zapatos en la nieve
];

const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..kYkWWWKkYkWWWKkYYk..' },
  { fila: 10, mapa: '..kYkWWKBkYkWWKBkYYk..' },
];

const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..kYkYYYYkYkYYYYkYYk..' },
  { fila: 10, mapa: '..kYkkkkkkYkkkkkkYYk..' },
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
    <g transform="translate(70, 14) scale(2)">
      ${svgContent(mapa)}
    </g>
  </svg>`;
}

async function main() {
  const dir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderScene(BOB_OJOS_ABIERTOS))).png().toFile(`${dir}/bob_v1_open.png`);
  await sharp(Buffer.from(renderScene(BOB_OJOS_CERRADOS))).png().toFile(`${dir}/bob_v1_blink.png`);
  console.log('Saved Bob v1!');
}
main();
