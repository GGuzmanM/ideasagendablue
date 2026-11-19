const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro (dientes, ojos, felpa gorro, suelas)
  w: '#f1f5f9', // Blanco sombra / gris claro
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
  P: '#94a3b8', // Rodilleras grises
  p: '#64748b', // Rodilleras sombra
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón claro
  S: '#3f1a36', // Zapatillas caña alta morado-oscuro
  s: '#260d20', // Zapatillas sombra
  k: '#1e293b', // Contorno suave pizarra
};

const CRASH_FINAL_BASE = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Crestas de pelo oscuro de Crash
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Pelo castaño y cono de gorro
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4: Orejas puntiagudas + felpa blanca de gorro
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5: Interior orejas durazno y cabeza naranja
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6: Orejas puntiagudas
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7: Base orejas + cejas oscuras
  '......dHHHHdOOOOdHHHHd....', // 8: Cejas arqueadas (\ /)
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos)
  '......dTTTTTNNNNTTTTTd....', // 12: Nariz negra prominente en hocico durazno
  '.....dTTTTTTNNNNTTTTTTd...', // 13: Base nariz y hocico durazno
  '....dMMWWwWWwWWwWWwWWMMd..', // 14: ¡ENORME SONRISA DE DIENTES BLANCOS!
  '....dMWWWWWWWWWWWWWWWWMd..', // 15: Fila de dientes blancos
  '.....dTTTMWWWWWWWWMNTTTd..', // 16: Arco inferior de dientes
  '......dTTTTTTTTTTTTTTd....', // 17: Barbilla durazno
  '.......dOOOOOTTTTOOOOd....', // 18: Cuello y hombros musculosos
  '..oO....dOOOOTTTTOOOOd...Oo', // 19: Brazos abiertos y pecho crema
  '..oOo...dOOOOOTTOOOOOd..oOo', // 20: Brazos y cintura atlética
  '..uUUu...dBBBBBBBBBBd...uUU', // 21: Guantes marrones y jeans
  '..UUUU...dBBBBBBBBBBd...UUU', // 22: Guantes marrones
  '..oOo....dBBk....kBBd....oO', // 23: Dedos naranja y perneras de jean
  '.........dPPk....kPPd......', // 24: Rodilleras grises características
  '..........oTo....oTo.......', // 25: Tobillos naranjas
  '.........sSSs....sSSs......', // 26: Zapatillas skate morado/rojizas
  '........wWWWWw..wWWWWw.....', // 27: Punteras y suelas blancas
];

const CRASH_FINAL_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '......dOWWWWWddWWWWWOd....' },
  { fila: 10, mapa: '......dOWWGKNddNKGWWod....' },
  { fila: 11, mapa: '......dOWWGGNddNGGWWOd....' },
];

const CRASH_FINAL_OJOS_CERRADOS = [
  { fila: 9,  mapa: '......dOOOOOOOOOOOOOOd....' },
  { fila: 10, mapa: '......dOOkkkkkOOkkkkkOd...' },
  { fila: 11, mapa: '......dOOOOOOOOOOOOOOd....' },
];

function renderSvg(base, ojos, scale = 14) {
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
    <rect width="${width}" height="${height}" fill="#0f172a" />
    ${rects}
  </svg>`;
}

async function run() {
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';

  await sharp(Buffer.from(renderSvg(CRASH_FINAL_BASE, CRASH_FINAL_OJOS_ABIERTOS))).png().toFile(path.join(artifactDir, 'crash_navideno_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_FINAL_BASE, CRASH_FINAL_OJOS_CERRADOS))).png().toFile(path.join(artifactDir, 'crash_navideno_blink.png'));
  console.log('Saved final Crash to artifacts dir!');
}

run().catch(console.error);
