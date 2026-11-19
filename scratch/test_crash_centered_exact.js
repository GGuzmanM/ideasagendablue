const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro (dientes, ojos, felpa gorro, suelas)
  w: '#f1f5f9', // Felpa sombra / blanco suave
  H: '#18181b', // Cresta pelo negro/castaño oscuro
  h: '#441c0e', // Pelo castaño
  O: '#ea580c', // Naranja vivo pelaje (Crash)
  o: '#c2410c', // Naranja sombra / contorno
  Y: '#f97316', // Naranja claro
  T: '#fed7aa', // Crema durazno (hocico, panza, orejas)
  t: '#fdba74', // Crema durazno sombra
  N: '#0f172a', // Nariz negra y pupila
  G: '#22c55e', // Verde iris vivo
  g: '#15803d', // Verde iris medio
  M: '#450a0a', // Fondo boca oscuro
  m: '#7f1d1d', // Boca cálida
  B: '#2563eb', // Jeans azul denim
  b: '#1e40af', // Jeans azul sombra
  P: '#94a3b8', // Rodilleras grises características
  p: '#64748b', // Rodilleras sombra
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón claro
  S: '#3f1a36', // Zapatillas caña alta morado-oscuro
  s: '#260d20', // Zapatillas sombra
  k: '#1e293b', // Contorno suave pizarra
};

const CRASH_CENTERED = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Crestas de pelo oscuro
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Pelo castaño y cono de gorro
  '.ddHhhHH.wWWWWWWWWWWw.Hhh.', // 4: Orejas puntiagudas (1 dot izq y der)
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

const OJOS_CENTERED_OPEN = [
  { fila: 9,  mapa: '.....dOWWWWWddWWWWWOd.....' },
  { fila: 10, mapa: '.....dOWWGKNddNKGWWod.....' },
  { fila: 11, mapa: '.....dOWWGGNddNGGWWOd.....' },
];

const OJOS_CENTERED_BLINK = [
  { fila: 9,  mapa: '.....dOOOOOOOOOOOOOOd.....' },
  { fila: 10, mapa: '.....dOOkkkkkOOkkkkkOd....' },
  { fila: 11, mapa: '.....dOOOOOOOOOOOOOOd.....' },
];

CRASH_CENTERED.forEach((r, i) => {
  if (r.length !== 26) console.error(`Row ${i} len is ${r.length}!`);
});
OJOS_CENTERED_OPEN.forEach((o, i) => {
  if (o.mapa.length !== 26) console.error(`Ojo ${i} len is ${o.mapa.length}!`);
});

function renderSvg(base, ojos, scale = 12) {
  const width = 26;
  const height = 28;
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
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderSvg(CRASH_CENTERED, OJOS_CENTERED_OPEN))).png().toFile(path.join(artifactDir, 'crash_navideno_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_CENTERED, OJOS_CENTERED_BLINK))).png().toFile(path.join(artifactDir, 'crash_navideno_blink.png'));
  console.log('Saved centered Crash to artifacts dir');
}

run().catch(console.error);
