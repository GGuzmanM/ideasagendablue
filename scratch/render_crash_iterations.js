const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro (dientes, ojos, felpa gorro, suelas)
  w: '#e2e8f0', // Felpa sombra / blanco suave
  H: '#291809', // Pelo oscuro / crestas
  h: '#451a03', // Pelo castaño oscuro
  O: '#f97316', // Naranja vivo pelaje (Crash)
  o: '#ea580c', // Naranja medio
  d: '#c2410c', // Naranja sombra / contorno
  Y: '#fdba74', // Piel durazno sombra suave
  T: '#fed7aa', // Crema durazno (hocico, panza, orejas)
  N: '#0f172a', // Nariz negra y pupila
  G: '#22c55e', // Verde iris vivo
  g: '#16a34a', // Verde iris medio
  M: '#3f1111', // Fondo boca oscuro
  B: '#2563eb', // Jeans azul denim
  b: '#1d4ed8', // Jeans azul sombra
  P: '#94a3b8', // Rodilleras grises características de Crash
  p: '#64748b', // Rodilleras sombra
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón claro
  S: '#471836', // Zapatillas caña alta / morado-rojizo oscuro como en la foto
  s: '#311025', // Zapatillas sombra
  k: '#1e293b', // Contorno suave
};

// 26 columnas x 28 filas
const CRASH_V2 = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '...HH...H...RRRRrr........', // 2: Puntas crestas pelo de Crash
  '..HhhH.HHH.RRRRRRrr...HH..', // 3: Cresta de pelo y cono de gorro
  '.ddHhhH.wWWWWWWWWWWw.Hhh..', // 4: Oreja izq, felpa de gorro, oreja der
  'dTTTHH.dOOOOOOOOOOOOd.HTT.', // 5: Orejas con interior durazno y frente
  'dTTTTo.dOOOOOOOOOOOOd.oTTd', // 6: Orejas puntiagudas
  '.dddd.dOOOOOOOOOOOOOOd.ddd', // 7: Base de orejas
  '......dOOOOOOOOOOOOOOd....', // 8: Cejas y frente naranja
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos y base nariz)
  '.....dTTTTTTNNNNTTTTTTd...', // 12: Nariz negra prominente
  '....dTTTTTTTTTTTTTTTTTTd..', // 13: Hocico durazno
  '....dWWWWWWWWWWWWWWWWWWd..', // 14: ¡ENORME SONRISA DE DIENTES BLANCOS!
  '....dMWWWWWWWWWWWWWWWWMd..', // 15: Fila inferior de dientes y fondo de boca
  '.....dTTTTTTTTTTTTTTTTd...', // 16: Mentón durazno
  '......dOOOOOTTTTOOOOOd....', // 17: Cuello y hombros musculosos
  '.oO....dOOOOTTTTOOOOd...Oo', // 18: Brazos abiertos con pecho durazno
  '.oOo...dOOOOOTTOOOOOd..oOo', // 19: Brazos y cintura delgada
  '.uUUu...dBBBBBBBBBBd...uUU', // 20: Guantes marrones y cintura jeans
  '.UUUU...dBBBBBBBBBBd...UUU', // 21: Guantes y jeans
  '.o.o....dBBk....kBBd....o.', // 22: Dedos sin guante y perneras jeans
  '........dPPk....kPPd......', // 23: Rodilleras grises icónicas
  '.........oTo....oTo.......', // 24: Tobillos naranjas
  '........sSSs....sSSs......', // 25: Zapatillas skate
  '.......wWWWWw..wWWWWw.....', // 26: Punteras blancas características
  '.......wwwwww..wwwwww.....', // 27: Suelas de goma blancas
];

const OJOS_V2_OPEN = [
  { fila: 9,  mapa: '......dOOOWWkOOOWWkOOd....' },
  { fila: 10, mapa: '......dOOWGKNkOOWGKNkd....' },
  { fila: 11, mapa: '......dOOWGNNkOOWGNNkd....' },
];

const OJOS_V2_BLINK = [
  { fila: 9,  mapa: '......dOOOOOOOOOOOOOOd....' },
  { fila: 10, mapa: '......dOOkkkkkOkkkkkOd....' },
  { fila: 11, mapa: '......dOOOOOOOOOOOOOOd....' },
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
  const svgOpen = renderSvg(CRASH_V2, OJOS_V2_OPEN);
  const svgBlink = renderSvg(CRASH_V2, OJOS_V2_BLINK);
  
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';

  await sharp(Buffer.from(svgOpen)).png().toFile(path.join(artifactDir, 'crash_v2_open.png'));
  await sharp(Buffer.from(svgBlink)).png().toFile(path.join(artifactDir, 'crash_v2_blink.png'));
  console.log('Saved V2 to artifacts dir');
}

run().catch(console.error);
