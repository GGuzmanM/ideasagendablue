const sharp = require('sharp');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño
  R: '#ef4444', r: '#b91c1c', W: '#ffffff', w: '#e2e8f0',

  // Cabello azabache de Harry
  H: '#090d16', h: '#1e293b', c: '#334155',

  // Piel
  F: '#fed7aa', f: '#fde68a', p: '#fca5a5', b: '#b45309',

  // Cicatriz de rayo ⚡
  Z: '#dc2626', z: '#ef4444',

  // Lentes redondos
  V: '#0f172a', v: '#334155', u: '#334155',

  // Ojos verdes esmeralda
  K: '#020617', E: '#16a34a', e: '#15803d',

  // Bufanda Gryffindor (escarlata y oro)
  D: '#991b1b', d: '#dc2626', A: '#f59e0b', a: '#d97706',

  // Uniforme / Túnica Hogwarts
  T: '#1e293b', t: '#0f172a', J: '#475569', C: '#ffffff', I: '#dc2626', i: '#f59e0b',

  // Varita mágica y chispa
  M: '#78350f', m: '#92400e', X: '#fef08a', x: '#ffffff',

  // Pantalón y zapatos
  P: '#334155', S: '#0f172a',
};

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

// Matriz de Harry Potter MÁS ALTO (24 cols x 27 rows):
// Proporciones estilizadas de joven mago: cuerpo esbelto con túnica larga,
// bufanda Gryffindor de doble vuelta con caída y flecos, varita extendida apuntando al árbol con magia,
// y rostro expresivo con lentes redondos, ojos verdes esmeralda, cicatriz de rayo y gorro navideño.
const HARRY_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRRRWW....', // 1: Caída y doblez del gorro
  '............RRRRRR......', // 2: Cono del gorro
  '..........RRRRRRRR......', // 3: Cuerpo del gorro
  '........RRRRRRRRRRRR....', // 4: Base roja del gorro
  '......WWWWWWWWWWWWWWWW..', // 5: Felpa blanca esponjosa
  '....HHHHHHHHHHHHHHHHHH..', // 6: Cabello azabache despeinado
  '..HHH.HH.FFFFF.ZZF.HHH..', // 7: Mechones y cicatriz de rayo (ZZ) sobre ojo derecho
  '..HHH..VVV..FF..VVV.HH..', // 8: Frente y marco superior de ambos lentes
  '........................', // 9: (Ojos dinámicos con lentes)
  '........................', // 10: (Ojos dinámicos con lentes y puente)
  '..HHp..VVV..FF..VVV.pH..', // 11: Base de lentes y mejillas con rubor
  '...HH...FFFF.b.FFFF..HH.', // 12: Boquita sonriente dulce y barbilla
  '....HH...FFFFFFFFF...HH.', // 13: Cuello suave
  '.....ddddAAAAAddddAAAA..', // 14: Bufanda Gryffindor: escarlata y oro (vuelta 1)
  '..X..AAAAddddAAAAdddd...', // 15: Bufanda: vuelta 2 + chispita mágica
  '.xXx.ddddAAAAAdddd.dd...', // 16: Chispa mágica dorada y caída de bufanda
  '..m..TTTTTTCICCTTT.AA...', // 17: Varita de acebo, túnica y cuello con corbata
  '..M..FTTTTTTICITTT.dd...', // 18: Manito con varita, túnica y corbata
  '..M..TTTTTTTTTTTTT.aa...', // 19: Cuerpo de la túnica y flecos de la bufanda
  '.....TTTTTTTTTTTTT......', // 20: Túnica de Hogwarts fluyendo
  '.....TTTTTTTTTTTTT......', // 21: Túnica alargada
  '.....TTTTT...TTTTT......', // 22: Caída y apertura de la túnica
  '.....PPPP.....PPPP......', // 23: Pantalón escolar
  '.....PPPP.....PPPP......', // 24: Pantalón largo
  '....SSSS.......SSSS.....', // 25: Zapatitos negros apoyados
  '....SSSS.......SSSS.....', // 26: Base firme sobre la nieve
];

const HARRY_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..HH..VWKEV.FF.VWKEV..HH' },
  { fila: 10, mapa: '..HH..VeEEV.VV.VeEEV..HH' },
];

const HARRY_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..HH..VFFFV.FF.VFFFV..HH' },
  { fila: 10, mapa: '..HH..VuuuV.VV.VuuuV..HH' },
];

function svgContent(mapa) {
  let rects = '';
  mapa.forEach((fila, y) => {
    [...fila].forEach((c, x) => {
      if (c === '.') return;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORES[c] || '#000'}" />`;
    });
  });
  return rects;
}

function renderScene(ojos) {
  const mapa = HARRY_BASE.map((f, i) => {
    const o = ojos.find(x => x.fila === i);
    if (!o) return f;
    let res = '';
    for (let c = 0; c < f.length; c++) {
      if (o.mapa[c] && o.mapa[c] !== '.') res += o.mapa[c];
      else res += f[c];
    }
    return res;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="250" viewBox="0 0 135 75" shape-rendering="crispEdges">
    <rect width="135" height="75" fill="#0b1e38" />
    <rect x="8" y="66" width="119" height="5" rx="2.5" fill="rgba(255,255,255,0.85)" />
    <!-- Arbolito (lado 3) -->
    <g transform="translate(10, 9) scale(3)">
      ${svgContent(ARBOL)}
    </g>
    <!-- Harry Potter (lado 2) -->
    <g transform="translate(68, 12) scale(2)">
      ${svgContent(mapa)}
    </g>
  </svg>`;
}

async function main() {
  const dir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderScene(HARRY_OJOS_ABIERTOS))).png().toFile(`${dir}/harry_tall_open.png`);
  await sharp(Buffer.from(renderScene(HARRY_OJOS_CERRADOS))).png().toFile(`${dir}/harry_tall_blink.png`);
  console.log('Saved tall version!');
}
main();
