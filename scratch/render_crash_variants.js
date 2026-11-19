const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const COLORES = {
  '.': null,
  R: '#ef4444', // Gorro rojo vivo
  r: '#b91c1c', // Gorro rojo sombra
  W: '#ffffff', // Blanco puro
  w: '#e2e8f0', // Blanco sombra / gris claro
  H: '#18181b', // Cresta pelo negro/castaño oscuro
  h: '#3f1d10', // Pelo castaño
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
  b: '#1d4ed8', // Jeans azul sombra
  P: '#94a3b8', // Rodilleras grises
  p: '#64748b', // Rodilleras sombra
  U: '#78350f', // Guantes marrones
  u: '#92400e', // Guantes marrón claro
  S: '#3f1a36', // Zapatillas caña alta morado-oscuro
  s: '#260d20', // Zapatillas sombra
  k: '#1e293b', // Contorno suave pizarra
};

// Variación A: Sonrisa de dientes en arco continuo brillante con comisuras oscuras
const CRASH_A = [
  '...............RRWW.......', // 0
  '..............RRrrWW......', // 1
  '..HH...HH...RRRRrr........', // 2
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7: Cejas oscuras de Crash
  '......dHHHHdOOOOdHHHHd....', // 8
  '..........................', // 9
  '..........................', // 10
  '..........................', // 11
  '.....dTTTTTTNNNNTTTTTTd...', // 12: Nariz negra prominente
  '....dTTTTTTTNNNNTTTTTTTd..', // 13: Base nariz y hocico
  '...dMMWWWWWWWWWWWWWWMMd...', // 14: Sonrisa ancha curvada con comisuras
  '...dMWWWWWWWWWWWWWWWWMd...', // 15: Dientes blancos puros
  '....dTTTMWWWWWWWWMNTTTd...', // 16: Arco inferior de la boca
  '.....dTTTTTTTTTTTTTTTTd...', // 17: Barbilla durazno
  '.oO...dOOOOOTTTTOOOOOd..Oo', // 18: Pecho y brazos
  '.oOo...dOOOOOTTOOOOOd..oOo', // 19: Cintura
  '.uUUu...dBBBBBBBBBBd...uUU', // 20: Guantes y jeans
  '.UUUU...dBBBBBBBBBBd...UUU', // 21
  '.oOo....dBBk....kBBd....oO', // 22: Dedos naranja
  '........dPPk....kPPd......', // 23: Rodilleras
  '.........oTo....oTo.......', // 24: Tobillos
  '........sSSs....sSSs......', // 25: Zapatillas
  '.......wWWWWw..wWWWWw.....', // 26: Suelas y punteras blancas
];

const OJOS_A_OPEN = [
  { fila: 9,  mapa: '......dOOWWWkOOOkWWWOOd...' },
  { fila: 10, mapa: '......dOWWGKNkdOWWGKNd....' },
  { fila: 11, mapa: '......dOWWGGNkdOWWGGNd....' },
];

const OJOS_A_BLINK = [
  { fila: 9,  mapa: '......dOOOOOOOOOOOOOOd....' },
  { fila: 10, mapa: '......dOOkkkkkOOkkkkkOd...' },
  { fila: 11, mapa: '......dOOOOOOOOOOOOOOd....' },
];

// Variación B: Dientes con líneas finas de separación vertical (w) en lugar de negro
const CRASH_B = [
  '...............RRWW.......', // 0
  '..............RRrrWW......', // 1
  '..HH...HH...RRRRrr........', // 2
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7
  '......dHHHHdOOOOdHHHHd....', // 8
  '..........................', // 9
  '..........................', // 10
  '..........................', // 11
  '.....dTTTTTTNNNNTTTTTTd...', // 12
  '....dTTTTTTTNNNNTTTTTTTd..', // 13
  '...dMMWWwWWwWWwWWwWWMMd...', // 14: Dientes con separaciones suaves w
  '...dMMWWwWWwWWwWWwWWMMd...', // 15: Dientes en arco
  '....dTTTMMMMMMMMMMTTTd....', // 16: Fondo boca inferior
  '.....dTTTTTTTTTTTTTTTTd...', // 17: Barbilla durazno
  '.oO...dOOOOOTTTTOOOOOd..Oo', // 18
  '.oOo...dOOOOOTTOOOOOd..oOo', // 19
  '.uUUu...dBBBBBBBBBBd...uUU', // 20
  '.UUUU...dBBBBBBBBBBd...UUU', // 21
  '.oOo....dBBk....kBBd....oO', // 22
  '........dPPk....kPPd......', // 23
  '.........oTo....oTo.......', // 24
  '........sSSs....sSSs......', // 25
  '.......wWWWWw..wWWWWw.....', // 26
];

// Variación C: Proporciones de cara más redondeada y orejas más dinámicas
const CRASH_C = [
  '...............RRWW.......', // 0
  '..............RRrrWW......', // 1
  '..HH...HH...RRRRrr........', // 2
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3
  'ddHhhHH.wWWWWWWWWWWw.Hhh..', // 4
  'dTTTHo.dOOOOOOOOOOOOd.HTTd', // 5
  'dTTTTd.dOOOOOOOOOOOOd.oTTd', // 6
  '.dddd.dHHHHdOOOOdHHHHd.ddd', // 7
  '......dHHHHdOOOOdHHHHd....', // 8
  '..........................', // 9
  '..........................', // 10
  '..........................', // 11
  '.....dTTTTTTNNNNTTTTTTd...', // 12
  '....dTTTTTTTNNNNTTTTTTTd..', // 13
  '...dMMWWwWWwWWwWWwWWMMd...', // 14
  '...dMWWWWWWWWWWWWWWWWMd...', // 15
  '....dTTTWWwWWwWWwWWTTTd...', // 16: Dientes inferiores
  '.....dTTTTTTTTTTTTTTTTd...', // 17: Mandíbula
  '.oO...dOOOOOTTTTOOOOOd..Oo', // 18
  '.oOo...dOOOOOTTOOOOOd..oOo', // 19
  '.uUUu...dBBBBBBBBBBd...uUU', // 20
  '.UUUU...dBBBBBBBBBBd...UUU', // 21
  '.oOo....dBBk....kBBd....oO', // 22
  '........dPPk....kPPd......', // 23
  '.........oTo....oTo.......', // 24
  '........sSSs....sSSs......', // 25
  '.......wWWWWw..wWWWWw.....', // 26
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

  await sharp(Buffer.from(renderSvg(CRASH_A, OJOS_A_OPEN))).png().toFile(path.join(artifactDir, 'crash_A_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_B, OJOS_A_OPEN))).png().toFile(path.join(artifactDir, 'crash_B_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_C, OJOS_A_OPEN))).png().toFile(path.join(artifactDir, 'crash_C_open.png'));
  await sharp(Buffer.from(renderSvg(CRASH_C, OJOS_A_BLINK))).png().toFile(path.join(artifactDir, 'crash_C_blink.png'));
  console.log('Saved variants A, B, C');
}

run().catch(console.error);
