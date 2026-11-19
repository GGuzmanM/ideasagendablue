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

// 26 columnas: centro geométrico = entre 12 y 13 (12.5).
// Todo el personaje simétrico:
const CRASH_CENTERED_BASE = [
  '...............RRWW.......', // 0: Pompón blanco esponjoso
  '..............RRrrWW......', // 1: Punta doblada con sombra
  '..HH...HH...RRRRrr........', // 2: Crestas de pelo oscuro
  '.HhhH.HhhH.RRRRRRrr...HH..', // 3: Pelo castaño y cono de gorro
  '.ddHhhH.wWWWWWWWWWWw.Hhhdd', // 4: Orejas puntiagudas (1 dot izq, 0 dots der)
  'dTTTHo.dOOOOOOOOOOOOd.oTTTd', // 5: Interior orejas durazno simétrico (0 dots izq y der -> center 13)
  'dTTTTd.dOOOOOOOOOOOOd.dTTTd', // 6: Orejas puntiagudas
  '.dddd.dHHHHdOOOOdHHHHd.dddd', // 7: Base orejas simétricas
  '.....dHHHHdOOOOdHHHHd.....', // 8: Cejas (5 dots izq, 5 dots der -> center 12.5)
  '..........................', // 9: (Ojos dinámicos)
  '..........................', // 10: (Ojos dinámicos)
  '..........................', // 11: (Ojos dinámicos)
  '.....dTTTTTNNNNTTTTTd.....', // 12: Nariz negra (5 dots izq, 5 dots der -> center 12.5)
  '....dTTTTTTNNNNTTTTTTd....', // 13: Base nariz y hocico durazno (4 dots izq y der -> center 12.5)
  '...dMMWWwWWwWWwWWwWWMMd...', // 14: Sonrisa (3 dots izq y der -> center 12.5)
  '...dMWWWWWWWWWWWWWWWWMd...', // 15: Fila de dientes blancos (3 dots izq y der -> center 12.5)
  '....dTTTMWWWWWWWWMNTTTd...', // 16: Arco inferior (4 dots izq, 3 der -> center 12.5)
  '.....dTTTTTTTTTTTTTTd.....', // 17: Barbilla durazno (5 dots izq y der -> center 12.5)
  '......dOOOOOTTTTOOOOOd....', // 18: Cuello y hombros (6 dots izq, 4 der -> col 6..21 center 13.5)
  '.oO....dOOOOTTTTOOOOd...Oo', // 19: Brazos simétricos (1 dot izq, 0 der)
  '.oOo...dOOOOOTTOOOOOd..oOo', // 20: Cintura simétrica
  '.uUUu...dBBBBBBBBBBd...uUU', // 21: Guantes y jeans
  '.UUUU...dBBBBBBBBBBd...UUU', // 22: Guantes marrones
  '.oOo....dBBk....kBBd....oO', // 23: Dedos y perneras
  '........dPPk....kPPd......', // 24: Rodilleras
  '.........oTo....oTo.......', // 25: Tobillos
  '........sSSs....sSSs......', // 26: Zapatillas skate
  '.......wWWWWw..wWWWWw.....', // 27: Punteras y suelas
];

const CRASH_CENTERED_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '.....dOWWWWWddWWWWWOd.....' },
  { fila: 10, mapa: '.....dOWWGKNddNKGWWod.....' },
  { fila: 11, mapa: '.....dOWWGGNddNGGWWOd.....' },
];

const CRASH_CENTERED_OJOS_CERRADOS = [
  { fila: 9,  mapa: '.....dOOOOOOOOOOOOOOd.....' },
  { fila: 10, mapa: '.....dOOkkkkkOOkkkkkOd....' },
  { fila: 11, mapa: '.....dOOOOOOOOOOOOOOd.....' },
];

function checkLengths() {
  CRASH_CENTERED_BASE.forEach((r, i) => {
    if (r.length !== 26) console.error(`Row ${i} length is ${r.length} (expected 26)!`);
  });
  CRASH_CENTERED_OJOS_ABIERTOS.forEach((o, i) => {
    if (o.mapa.length !== 26) console.error(`Ojo abierto ${i} length is ${o.mapa.length} (expected 26)!`);
  });
  CRASH_CENTERED_OJOS_CERRADOS.forEach((o, i) => {
    if (o.mapa.length !== 26) console.error(`Ojo cerrado ${i} length is ${o.mapa.length} (expected 26)!`);
  });
}

checkLengths();
console.log('All lengths checked OK!');
