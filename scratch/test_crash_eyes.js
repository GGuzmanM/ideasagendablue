const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro
  w: '#f1f5f9', // Blanco sombra / gris claro
  H: '#18181b', // Cresta pelo negro/castaño oscuro
  h: '#441c0e', // Pelo castaño
  O: '#ea580c', // Naranja vivo pelaje
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

// 26 columnas:
// Centro de la cara es entre col 12 y 13.
// Ojos grandes que casi se tocan en el centro (col 8..11 izq, col 14..17 der, o col 9..12 y col 13..16)
const CRASH_PERFECT = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Puntas crestas pelo de Crash
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Cresta de pelo y cono de gorro
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4: Oreja izq, felpa de gorro, oreja der
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5: Interior orejas durazno y cabeza
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6: Orejas puntiagudas hacia arriba
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7: Cejas anguladas
  '.....dHk..kdOOOOdk..kHd...', // 8: Cejas arqueadas
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos)
  '......dTTTTTNNNNTTTTTd....', // 12: Nariz negra prominente en hocico durazno
  '....dTTTTTTTNNNNTTTTTTTd..', // 13: Base nariz y labio durazno
  '...dMMWWwWWwWWwWWwWWMMd...', // 14: ¡ENORME SONRISA DE DIENTES BLANCOS!
  '...dMWWWWWWWWWWWWWWWWMd...', // 15: Fila de dientes blancos
  '....dTTTWWwWWwWWwWWTTTd...', // 16: Dientes inferiores en arco
  '.....dTTTTTTTTTTTTTTTTd...', // 17: Mandíbula / barbilla durazno
  '......dOOOOOTTTTOOOOOd....', // 18: Cuello y hombros musculosos
  '.oO....dOOOOTTTTOOOOd...Oo', // 19: Brazos abiertos y pecho crema
  '.oOo...dOOOOOTTOOOOOd..oOo', // 20: Brazos y cintura
  '.uUUu...dBBBBBBBBBBd...uUU', // 21: Guantes marrones y jeans
  '.UUUU...dBBBBBBBBBBd...UUU', // 22: Guantes marrones
  '.oOo....dBBk....kBBd....oO', // 23: Dedos naranja y piernas de jean
  '........dPPk....kPPd......', // 24: Rodilleras grises características
  '.........oTo....oTo.......', // 25: Tobillos naranjas
  '........sSSs....sSSs......', // 26: Zapatillas skate morado/rojizas
  '.......wWWWWw..wWWWWw.....', // 27: Punteras y suelas blancas
];

// Ojos grandes juntos: 4 px cada ojo, divididos por 1px
const OJOS_PERFECT_OPEN = [
  { fila: 9,  mapa: '.....kWWWWkkWWWWk.........' },
  { fila: 10, mapa: '.....kWGGNkkWGGNk.........' },
  { fila: 11, mapa: '.....kWGGNkkWGGNk.........' },
];

// Alternativa con ojos centrados:
// 26 columnas total:
// col 0..6 (7 cols margen izq)
// Ojo izq: cols 7, 8, 9, 10 (4 cols)
// Separador: cols 11, 12 (2 cols)
// Ojo der: cols 13, 14, 15, 16 (4 cols)
// Margen der: cols 17..25 (9 cols)
// Ojos centrados: cols 8..11 y 14..17
const OJOS_CENTERED_OPEN = [
  { fila: 9,  mapa: '.......kWWWWk..kWWWWk.....' },
  { fila: 10, mapa: '.......kWGGNk..kWGGNk.....' },
  { fila: 11, mapa: '.......kWGNNk..kWGNNk.....' },
];

const OJOS_TOUCHING_OPEN = [
  { fila: 9,  mapa: '........kWWWWkWWWWk.......' },
  { fila: 10, mapa: '........kWGGNkWGGNk.......' },
  { fila: 11, mapa: '........kWGNNkWGNNk.......' },
];

const OJOS_TOUCHING_BLINK = [
  { fila: 9,  mapa: '........dOOOOOOOOOd.......' },
  { fila: 10, mapa: '........dOkkkkkkkOd.......' },
  { fila: 11, mapa: '........dOOOOOOOOOd.......' },
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
    <rect width="${width}" height="${height}" fill="#0f172a" />
    ${rects}
  </svg>`;
}

async function run() {
  const artifactDir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';

  await sharp(Buffer.from(renderSvg(CRASH_PERFECT, OJOS_TOUCHING_OPEN))).png().toFile(path.join(artifactDir, 'crash_touching_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_PERFECT, OJOS_TOUCHING_BLINK))).png().toFile(path.join(artifactDir, 'crash_touching_blink.png'));
  await sharp(Buffer.from(renderSvg(CRASH_PERFECT, OJOS_CENTERED_OPEN))).png().toFile(path.join(artifactDir, 'crash_centered_open.png'));
  console.log('Saved touching & centered');
}

run().catch(console.error);
