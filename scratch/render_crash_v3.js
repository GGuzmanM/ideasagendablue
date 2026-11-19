const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro (dientes, ojos, felpa gorro, suelas)
  w: '#f1f5f9', // Felpa sombra / blanco suave
  H: '#1c1917', // Pelo oscuro / cejas / crestas
  h: '#441c0e', // Pelo castaño
  O: '#ea580c', // Naranja vivo pelaje (Crash)
  o: '#c2410c', // Naranja sombra / contorno
  Y: '#f97316', // Naranja claro
  T: '#fed7aa', // Crema durazno (hocico, panza, orejas)
  t: '#fdba74', // Crema durazno sombra
  N: '#0f172a', // Nariz negra y pupila
  G: '#22c55e', // Verde iris vivo
  g: '#15803d', // Verde iris medio
  M: '#450a0a', // Fondo boca oscuro (entre dientes)
  B: '#2563eb', // Jeans azul denim
  b: '#1d4ed8', // Jeans azul sombra
  P: '#94a3b8', // Rodilleras grises características
  p: '#64748b', // Rodilleras sombra
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón claro
  S: '#3f1a36', // Zapatillas caña alta morado-oscuro canónicas
  s: '#260d20', // Zapatillas sombra
  k: '#1e293b', // Contorno suave pizarra
};

// 26 columnas x 27 filas
const CRASH_V3 = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Puntas pelo crestas
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Cresta de pelo y cono de gorro
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4: Oreja izq, felpa de gorro, oreja der
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5: Interior orejas durazno y cabeza naranja
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6: Orejas puntiagudas
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7: Cejas oscuras expresivas de Crash (\ /)
  '......dHHHHdOOOOdHHHHd....', // 8: Cejas inclinadas hacia el centro
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos y nariz)
  '.....dTTTTTTNNNNTTTTTTd...', // 12: Nariz negra en hocico durazno
  '....dTTTTTTTNNNNTTTTTTTd..', // 13: Base nariz y labio durazno
  '....dWWNWWNWWNWWNWWNWWd...', // 14: Dientes superiores definidos con separadores
  '....dWWNWWNWWNWWNWWNWWd...', // 15: Dientes inferiores en gran sonrisa
  '.....dTTTTTTTTTTTTTTTTd...', // 16: Mandíbula / barbilla durazno
  '......dOOOOOTTTTOOOOOd....', // 17: Cuello naranja y pecho crema
  '.oO....dOOOOTTTTOOOOd...Oo', // 18: Brazos y pecho
  '.oOo...dOOOOOTTOOOOOd..oOo', // 19: Brazos y cintura atlética
  '.uUUu...dBBBBBBBBBBd...uUU', // 20: Guantes marrones y jeans
  '.UUUU...dBBBBBBBBBBd...UUU', // 21: Guantes marrones
  '.oOo....dBBk....kBBd....oO', // 22: Dedos naranja y perneras jeans
  '........dPPk....kPPd......', // 23: Rodilleras grises
  '.........oTo....oTo.......', // 24: Tobillos naranjas
  '........sSSs....sSSs......', // 25: Zapatillas caña alta
  '.......wWWWWw..wWWWWw.....', // 26: Punteras blancas y suela
];

const OJOS_V3_OPEN = [
  { fila: 9,  mapa: '......dOOWWWkOOOkWWWOOd...' },
  { fila: 10, mapa: '......dOWWGKNkdOWWGKNd....' },
  { fila: 11, mapa: '......dOWWGGNkdOWWGGNd....' },
];

const OJOS_V3_BLINK = [
  { fila: 9,  mapa: '......dOOOOOOOOOOOOOOd....' },
  { fila: 10, mapa: '......dOOkkkkkOOkkkkkOd...' },
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
  const svgOpen = renderSvg(CRASH_V3, OJOS_V3_OPEN);
  const svgBlink = renderSvg(CRASH_V3, OJOS_V3_BLINK);
  
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';

  await sharp(Buffer.from(svgOpen)).png().toFile(path.join(artifactDir, 'crash_v3_open.png'));
  await sharp(Buffer.from(svgBlink)).png().toFile(path.join(artifactDir, 'crash_v3_blink.png'));
  console.log('Saved V3 to artifacts dir');
}

run().catch(console.error);
