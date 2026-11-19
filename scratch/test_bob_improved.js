const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  R: '#ef4444',
  r: '#b91c1c',
  W: '#ffffff',
  w: '#f1f5f9',
  Y: '#facc15',
  y: '#eab308',
  d: '#ca8a04',
  k: '#1e293b',
  N: '#f59e0b',
  n: '#fbbf24',
  A: '#38bdf8',
  a: '#0284c7',
  K: '#0f172a',
  p: '#fca5a5',
  q: '#f43f5e',
  m: '#9f1239',
  l: '#fb7185',
  D: '#ffffff',
  C: '#ffffff',
  T: '#ef4444',
  P: '#854d0e',
  t: '#713f12',
  U: '#0f172a',
  H: '#ef4444',
  I: '#38bdf8',
  S: '#0f172a',
};

const BOB_BASE_IMPROVED = [
  '...............RRWW.....', // 0
  '..............RRrrWW....', // 1
  '............RRRRrr......', // 2
  '..........RRRRRRrr......', // 3
  '........RRRRRRRRrrrr....', // 4
  '......wWWWWWWWWWWWWWWw..', // 5
  '....kYYYYYYYYYYYYYYYYk..', // 6
  '....kYYdYYdYYYYYdYYdYk..', // 7
  '....kYYYYkYkYYYYkYkYYk..', // 8
  '........................', // 9
  '........................', // 10
  '........................', // 11
  '....kYppYYWWNNWWYYppYk..', // 12
  '....kYppkDDkmmkDDkpYk...', // 13: 2 dientes juntos canónicos separados por la comisura de la boca
  '....kYYYkmmllllmmkYYYk..', // 14
  '....kYYYYkkkkkkkkYYYYk..', // 15
  '..kCkCCCCCCCCCCCCCCkCk..', // 16
  '.kYk.kCCCCTTTCCCCCk.kYk.', // 17
  '.kYk.kPPUUPPUUPPUUPk.kYk', // 18
  '..kk.kPPPPPPPPPPPPk..kk.', // 19
  '......kPPPk....kPPPk....', // 20
  '.......kYk......kYk.....', // 21
  '.......kHk......kHk.....', // 22
  '.......kIk......kIk.....', // 23
  '.......kWk......kWk.....', // 24
  '......kSSSk....kSSSk....', // 25
];

const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '....kYYYWWWWYYWWWWYYYk..' },
  { fila: 10, mapa: '....kYYYWWAKnNNKAWWYYYk.' },
  { fila: 11, mapa: '....kYYYWWAKNNNKAWWYYYk.' },
];

function renderBob(base, ojos, scale = 12) {
  const width = 24;
  const height = 26;
  let rects = '';
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = base[y][x];
      if (c && c !== '.') {
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORES[c]}" />`;
      }
    }
  }
  for (const { fila, mapa } of ojos) {
    for (let x = 0; x < mapa.length; x++) {
      const c = mapa[x];
      if (c && c !== '.') {
        rects += `<rect x="${x}" y="${fila}" width="1" height="1" fill="${COLORES[c]}" />`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">
    <rect width="${width}" height="${height}" fill="#1e293b" />
    ${rects}
  </svg>`;
}

async function run() {
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderBob(BOB_BASE_IMPROVED, BOB_OJOS_ABIERTOS))).png().toFile(path.join(artifactDir, 'bob_improved_preview.png'));
  console.log('Saved bob_improved_preview.png');
}

run().catch(console.error);
