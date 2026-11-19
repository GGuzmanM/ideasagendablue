const sharp = require('sharp');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño de Papá Noel
  R: '#ef4444', // Rojo navideño vivo
  r: '#b91c1c', // Rojo sombra
  W: '#ffffff', // Blanco puro (pompón, felpa, destello)
  w: '#f1f5f9', // Felpa relieve

  // Cabello azabache de Harry
  H: '#090d16', // Negro azabache contorno y sombras
  h: '#1e293b', // Negro grafito mechones

  // Rostro y piel
  F: '#fed7aa', // Tono piel cálido
  f: '#fcd34d', // Sombra piel
  p: '#fca5a5', // Rubor rosado mejillas
  b: '#b45309', // Boquita sonriente dulce

  // Cicatriz de rayo icónica
  Z: '#dc2626', // Cicatriz escarlata vivo
  z: '#991b1b', // Cicatriz sombra

  // Lentes redondos icónicos
  V: '#0f172a', // Marco negro grafito oscuro

  // Ojos verdes esmeralda canónicos
  K: '#020617', // Pupila oscura
  E: '#16a34a', // Verde esmeralda vivo
  e: '#15803d', // Verde esmeralda profundo

  // Bufanda Gryffindor (escarlata y oro)
  D: '#991b1b', // Escarlata oscuro
  d: '#dc2626', // Escarlata vivo
  A: '#f59e0b', // Oro Gryffindor vivo
  a: '#d97706', // Oro Gryffindor sombra

  // Túnica de Hogwarts y ropa
  T: '#1e293b', // Túnica gris pizarra oscura
  t: '#0f172a', // Contorno túnica
  C: '#ffffff', // Cuellito blanco de camisa
  I: '#dc2626', // Corbata Gryffindor

  // Varita de acebo y magia
  M: '#78350f', // Madera varita acebo
  m: '#92400e', // Madera clara
  X: '#fef08a', // Chispita mágica dorada
  x: '#ffffff', // Destello blanco en la chispa

  // Pantalón y zapatos
  P: '#334155', // Pantalón
  S: '#0f172a', // Zapatitos apoyados
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

// Matriz base de Harry Potter (24 cols x 22 rows)
const HARRY_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRRRWW....', // 1: Punta doblada del gorro
  '............RRRRRR......', // 2: Caída del gorrito rojo
  '..........RRRRRRRR......', // 3: Cono del gorro
  '........RRRRRRRRRRRR....', // 4: Gorrito rojo
  '......WWWWWWWWWWWWWWWW..', // 5: Felpa blanca esponjosa del gorro
  '.....HHHHHHHHHHHHHHHHH..', // 6: Cabello negro azabache
  '...HHH.HH.FFFF.ZZ.HHHH..', // 7: Mechones despeinados y rayo (ZZ)
  '..HH..FFFFFFFFZFFFF.HH..', // 8: Frente descubierta con rayo
  '........................', // 9: (Ojos y lentes dinámicos)
  '........................', // 10: (Ojos y lentes dinámicos)
  '..HH..p.VVV.b.VVV.p.HH..', // 11: Base de lentes, rubor mejillas y sonrisita
  '...HH..FFFFFFFFF...HH...', // 12: Barbilla y cuello
  '.....ddddAAAAAdddd......', // 13: Bufanda Gryffindor: escarlata y oro
  '..x..AAAAddddAAAAAdd....', // 14: Vuelta de bufanda + inicio chispa mágica
  '.xXx.ddddAAAAAdddd.dd...', // 15: Chispita mágica dorada y caída de bufanda
  '..m..TTTTTCICCTTTT.AA...', // 16: Varita y cuello camisa con corbata
  '..M..FTTTTTTTTTTTT.dd...', // 17: Manito sosteniendo varita
  '.....TTTTTTTTTTTTT......', // 18: Túnica cuerpo
  '.....PPPP.....PPPP......', // 19: Pantalón
  '....SSSS.......SSSS.....', // 20: Zapatitos apoyados
  '....SSSS.......SSSS.....', // 21: Base en la nieve
];

// Lentes redondos (5x3 cada ojo):
// Lente izq: cols 5..9 -> .VVV. en fila 9, VWKEV en fila 10, .VVV. en fila 11
// Puente: cols 10..11 -> VV en fila 10
// Lente der: cols 12..16 -> .VVV. en fila 9, VWKEV en fila 10, .VVV. en fila 11
const HARRY_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..HH..VVVV...VVVV...HH..' },
  { fila: 10, mapa: '..HH.VWKEV.VV.VWKEV.HH..' },
];

const HARRY_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..HH..VVVV...VVVV...HH..' },
  { fila: 10, mapa: '..HH.VFFFFV.VV.VFFFFVHH..' },
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="230" viewBox="0 0 135 70" shape-rendering="crispEdges">
    <rect width="135" height="70" fill="#0b1e38" />
    <rect x="8" y="62" width="119" height="5" rx="2.5" fill="rgba(255,255,255,0.85)" />
    <!-- Arbolito (lado 3) -->
    <g transform="translate(10, 5) scale(3)">
      ${svgContent(ARBOL)}
    </g>
    <!-- Harry Potter (lado 2) -->
    <g transform="translate(68, 20) scale(2)">
      ${svgContent(mapa)}
    </g>
  </svg>`;
}

async function main() {
  const dir = 'C:/Users/User/.gemini/antigravity/brain/253ec110-f104-4fe8-8489-5cbe266f4a3c';
  await sharp(Buffer.from(renderScene(HARRY_OJOS_ABIERTOS))).png().toFile(`${dir}/harry_v3_open.png`);
  await sharp(Buffer.from(renderScene(HARRY_OJOS_CERRADOS))).png().toFile(`${dir}/harry_v3_blink.png`);
  console.log('Saved v3!');
}
main();
