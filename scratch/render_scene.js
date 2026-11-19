const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Árbol de EscenaPixel
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

const COLORES_ARBOL = {
  G: '#16a34a',
  g: '#166534',
  Y: '#facc15',
  B: '#92400e',
  R: '#ef4444',
  L: '#60a5fa',
  O: '#fb923c',
};

const COLORES_CRASH = {
  R: '#ef4444',
  r: '#b91c1c',
  W: '#ffffff',
  w: '#f1f5f9',
  H: '#18181b',
  h: '#441c0e',
  O: '#ea580c',
  o: '#c2410c',
  Y: '#f97316',
  T: '#fed7aa',
  t: '#fdba74',
  N: '#0f172a',
  G: '#22c55e',
  g: '#15803d',
  M: '#450a0a',
  m: '#7f1d1d',
  B: '#2563eb',
  b: '#1e40af',
  P: '#94a3b8',
  p: '#64748b',
  U: '#78350f',
  u: '#92400e',
  S: '#3f1a36',
  s: '#260d20',
  k: '#1e293b',
};

const CRASH_CENTERED_BASE = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Crestas de pelo oscuro
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Pelo castaño y cono de gorro
  '.ddHhhHH.wWWWWWWWWWWw.Hhh.', // 4: Orejas puntiagudas simétricas
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5: Interior orejas durazno
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6: Orejas puntiagudas
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7: Base orejas
  '.....dHHHHdOOOOdHHHHd.....', // 8: Cejas centradas (5 dots izq, 5 dots der)
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos)
  '.....dTTTTTNNNNTTTTTd.....', // 12: Nariz negra centrada (5 dots izq, 5 dots der)
  '....dTTTTTTNNNNTTTTTTd....', // 13: Base nariz y hocico durazno (4 dots izq, 4 dots der)
  '...dMMWWwWWwWWwWWwWWMMd...', // 14: Sonrisa centrada (3 dots izq, 3 dots der)
  '...dMWWWWWWWWWWWWWWWWMd...', // 15: Dientes centrados (3 dots izq, 3 dots der)
  '....dTTTMWWWWWWWWMNTTTd...', // 16: Dientes inferiores centrados
  '.....dTTTTTTTTTTTTTTd.....', // 17: Barbilla centrada (5 dots izq, 5 dots der)
  '......dOOOOOTTTTOOOOd.....', // 18: Cuello y hombros centrados (6 dots izq, 5 dots der)
  '..oO...dOOOOTTTTOOOOd..Oo.', // 19: Brazos simétricos
  '..oOo..dOOOOOTTOOOOOd..oOo', // 20: Cintura simétrica
  '..uUUu..dBBBBBBBBBBd..uUUu', // 21: Guantes y jeans simétricos
  '..UUUU..dBBBBBBBBBBd..UUUU', // 22: Guantes marrones
  '..oOo...dBBk....kBBd...oOo', // 23: Dedos y perneras
  '.......dPPk......kPPd.....', // 24: Rodilleras centradas
  '........oTo......oTo......', // 25: Tobillos centrados
  '.......sSSs......sSSs.....', // 26: Zapatillas centradas
  '......wWWWWw....wWWWWw....', // 27: Suelas centradas
];

const CRASH_CENTERED_OJOS = [
  { fila: 9,  mapa: '.....dOWWWWWddWWWWWOd.....' },
  { fila: 10, mapa: '.....dOWWGKNddNKGWWod.....' },
  { fila: 11, mapa: '.....dOWWGGNddNGGWWOd.....' },
];

function renderFullScene(scale = 6) {
  const treeW = 15;
  const treeH = 19;
  const crashW = 26;
  const crashH = 28;
  const gap = 3;
  const totalW = treeW + gap + crashW;
  const totalH = Math.max(treeH, crashH) + 2;

  let rects = '';

  const treeYOff = totalH - 2 - treeH;
  for (let y = 0; y < treeH; y++) {
    for (let x = 0; x < treeW; x++) {
      const c = ARBOL[y][x];
      if (c && c !== '.') {
        rects += `<rect x="${x}" y="${y + treeYOff}" width="1" height="1" fill="${COLORES_ARBOL[c]}" />`;
      }
    }
  }

  const crashXOff = treeW + gap;
  const crashYOff = totalH - 2 - crashH;
  for (let y = 0; y < crashH; y++) {
    for (let x = 0; x < crashW; x++) {
      const c = CRASH_CENTERED_BASE[y][x];
      if (c && c !== '.') {
        rects += `<rect x="${x + crashXOff}" y="${y + crashYOff}" width="1" height="1" fill="${COLORES_CRASH[c]}" />`;
      }
    }
  }

  for (const { fila, mapa } of CRASH_CENTERED_OJOS) {
    for (let x = 0; x < mapa.length; x++) {
      const c = mapa[x];
      if (c && c !== '.') {
        rects += `<rect x="${x + crashXOff}" y="${fila + crashYOff}" width="1" height="1" fill="${COLORES_CRASH[c]}" />`;
      }
    }
  }

  rects += `<rect x="2" y="${totalH - 2}" width="${totalW - 4}" height="1.5" rx="0.75" fill="#ffffff" opacity="0.85" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW * scale}" height="${totalH * scale}" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">
    <rect width="${totalW}" height="${totalH}" fill="#1e293b" />
    ${rects}
  </svg>`;
}

async function run() {
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderFullScene(8))).png().toFile(path.join(artifactDir, 'crash_escena_preview.png'));
  console.log('Saved updated crash_escena_preview.png');
}

run().catch(console.error);
