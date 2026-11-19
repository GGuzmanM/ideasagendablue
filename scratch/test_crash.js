const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro (dientes, ojos, felpa gorro, suelas)
  w: '#e2e8f0', // Blanco sombra / gris claro
  H: '#261408', // Pelo oscuro / crestas
  h: '#451a03', // Pelo castaño oscuro
  O: '#ea580c', // Naranja vivo pelaje (Crash)
  o: '#c2410c', // Naranja sombra / contorno
  Y: '#fb923c', // Naranja brillo / realce
  T: '#fed7aa', // Crema durazno (hocico, panza, interior orejas)
  t: '#fdba74', // Crema durazno sombra
  N: '#0f172a', // Nariz negra y pupila
  G: '#22c55e', // Verde iris vivo
  g: '#15803d', // Verde iris profundo
  M: '#450a0a', // Fondo boca oscuro
  B: '#2563eb', // Jeans azul
  b: '#1e40af', // Jeans azul sombra
  C: '#94a3b8', // Hebilla / rodilleras
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón medio
  S: '#dc2626', // Zapatillas rojas
  s: '#991b1b', // Zapatillas sombra
};

// 26 columnas x 27 filas
const CRASH_V1 = [
  '...............RRWW.......', // 0: Pompón gorro
  '..............RRrrWW......', // 1: Punta doblada del gorro
  '....HH......RRRRrr........', // 2: Puntas pelo crestas
  '..HHhHH...RRRRRRrr...HH...', // 3: Cresta y cono gorro
  '.ooHTHH.wWWWWWWWWWWw.HHh..', // 4: Oreja izq, felpa gorro, oreja der
  'oTTTTH.kOOOOOOOOOOOOo.HTTo', // 5: Interior orejas durazno y frente naranja
  'oTTTH.kOOOOOOOOOOOOOOo.HTo', // 6: Orejas y frente
  '.oo..kOOOOOOOOOOOOOOOOo..o', // 7: Base orejas
  '.....kOOOOOOOOOOOOOOOOo...', // 8: Cejas y tope de ojos
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos y nariz)
  '.....kTTTTTTNNNNTTTTTTk...', // 12: Nariz negra prominente en hocico durazno
  '....kTTTTTTTTTTTTTTTTTTk..', // 13: Labio superior durazno
  '....kWWWWWWWWWWWWWWWWWWk..', // 14: ¡GRAN SONRISA DE DIENTES BLANCOS!
  '....kMWWWWWWWWWWWWWWWWMk..', // 15: Dientes inferiores y fondo boca
  '.....kTTTTTTTTTTTTTTTTk...', // 16: Barbilla y mandíbula inferior durazno
  '..oO..kOOOOOTTTTOOOOOo..Oo', // 17: Hombros naranja y pecho crema
  '.oOOo..kOOOOTTTTOOOOo..oOO', // 18: Brazos y torso
  '.UuuU..kOOOOTTTTOOOOo..Uuu', // 19: Brazos y cintura
  '.UUUU...kBBBBBBBBBBk...UUU', // 20: Guantes marrones y jeans azules
  '........kBBBBBBBBBBk......', // 21: Pantalones jeans
  '........kBBk....kBBk......', // 22: Perneras jean
  '.........oTo....oTo.......', // 23: Piernas naranjas / tobillos
  '........wSSw....wSSw......', // 24: Zapatillas rojas
  '.......wWWWWw..wWWWWw.....', // 25: Suelas y punteras blancas zapatillas
  '.......wwwwww..wwwwww.....', // 26: Base suela
];

const OJOS_ABIERTOS = [
  { fila: 9,  mapa: '.....kOOOWWWKOOKWWWOOOo...' },
  { fila: 10, mapa: '.....kOOWGgNKOOKNgGWOOo...' },
  { fila: 11, mapa: '.....kOOWGGNKOOKNGGWOOo...' },
];

const OJOS_CERRADOS = [
  { fila: 9,  mapa: '.....kOOOOOOOOOOOOOOOOo...' },
  { fila: 10, mapa: '.....kOOkkkkkOOkOkkkkoo...' },
  { fila: 11, mapa: '.....kOOOOOOOOOOOOOOOOo...' },
];

function renderSvg(base, ojos, scale = 12) {
  const width = base[0].length;
  const height = base.length;
  let rects = '';

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = base[y][x];
      if (c && c !== '.') {
        const color = COLORES[c] || (c === 'k' ? '#18181b' : null);
        if (color) {
          rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}" />`;
        }
      }
    }
  }

  for (const { fila, mapa } of ojos) {
    for (let x = 0; x < mapa.length; x++) {
      const c = mapa[x];
      if (c && c !== '.') {
        const color = COLORES[c] || (c === 'k' ? '#18181b' : null);
        if (color) {
          rects += `<rect x="${x}" y="${fila}" width="1" height="1" fill="${color}" />`;
        }
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
    <rect width="${width}" height="${height}" fill="#1e293b" />
    ${rects}
  </svg>`;
}

async function run() {
  const svgOpen = renderSvg(CRASH_V1, OJOS_ABIERTOS);
  const svgBlink = renderSvg(CRASH_V1, OJOS_CERRADOS);
  
  const outDir = path.resolve(__dirname, 'crash_preview');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  await sharp(Buffer.from(svgOpen)).png().toFile(path.join(outDir, 'crash_v1_open.png'));
  await sharp(Buffer.from(svgBlink)).png().toFile(path.join(outDir, 'crash_v1_blink.png'));
  console.log('Saved preview to', outDir);
}

run().catch(console.error);
