const sharp = require('sharp');
const fs = require('fs');

const COLORES = {
  // Árbol
  G: '#16a34a', g: '#166534', Y: '#facc15', B: '#92400e',
  L: '#60a5fa', O: '#fb923c',

  // Gorro navideño de Papá Noel
  R: '#ef4444', // Rojo navideño vivo
  r: '#b91c1c', // Rojo sombra
  W: '#ffffff', // Blanco puro (pompón, felpa, destello)
  w: '#e2e8f0', // Felpa sombra suave

  // Cabello azabache desordenado de Harry
  H: '#0f172a', // Negro azabache contorno y mechones
  h: '#1e293b', // Negro grafito mechones medios
  c: '#334155', // Brillo sutil de cabello

  // Piel y carita
  F: '#fed7aa', // Piel cálida
  f: '#fbcfe8', // Rubor rosado mejillas
  b: '#d97706', // Boquita sonriente tierna

  // Cicatriz de rayo icónica
  Z: '#dc2626', // Cicatriz escarlata

  // Lentes redondos icónicos
  V: '#18181b', // Montura de lentes negra
  v: '#3f3f46', // Montura sombra

  // Ojos verdes esmeralda (signo distintivo)
  K: '#09090b', // Pupila
  E: '#16a34a', // Verde esmeralda vivo
  e: '#15803d', // Verde esmeralda profundo

  // Bufanda Gryffindor (escarlata y oro)
  D: '#991b1b', // Escarlata oscuro
  d: '#dc2626', // Escarlata vivo
  A: '#f59e0b', // Oro Gryffindor
  a: '#b45309', // Oro sombra

  // Túnica de Hogwarts
  T: '#1e293b', // Túnica gris pizarra oscura
  t: '#0f172a', // Sombra túnica
  U: '#334155', // Pliegue túnica

  // Varita de acebo y chispa mágica
  M: '#78350f', // Madera varita
  m: '#92400e', // Madera clara
  X: '#fef08a', // Chispita mágica dorada
  x: '#ffffff', // Centro de la chispita

  // Pantalón y zapatos
  P: '#334155', // Pantalón
  S: '#0f172a', // Zapatitos sobre nieve
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

// Grid Harry Potter (24 cols x 22 rows)
// 0: Pompón blanco esponjoso cayendo a la derecha
// 1-4: Gorro rojo navideño inclinado
// 5: Felpa blanca esponjosa
// 6-8: Cabello negro desordenado con mechones + Cicatriz de rayo en la frente
// 9-11: Lentes redondos con marco negro, ojos verdes esmeralda con brillo blanco, rubor y sonrisita
// 12-14: Bufanda Gryffindor envolviendo el cuello (escarlata y oro) con extremo colgando
// 15-18: Túnica de Hogwarts y manito sosteniendo la varita mágica apuntando al arbolito con chispita dorada
// 19-21: Patitas y zapatitos apoyados en la nieve
const HARRY_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRRRWW....', // 1: Punta doblada del gorro
  '............RRRRRR......', // 2: Caída del gorrito rojo
  '..........RRRRRRRR......', // 3: Cono del gorro
  '........RRRRRRRRRRRR....', // 4: Gorrito rojo
  '......WWWWWWWWWWWWWWWW..', // 5: Felpa blanca esponjosa del gorro
  '.....HHHHHHHHHHHHHHHHH..', // 6: Cabello negro azabache
  '...HHH.HHH.FFF.Z.HHHHH..', // 7: Mechones despeinados y rayo (Z)
  '..HH...FFF.FFFZZ.FFFF.HH', // 8: Frente descubierta con rayo
  '........................', // 9: (Lentes y ojos dinámicos)
  '........................', // 10: (Lentes y ojos dinámicos)
  '..HH..f.VVV.b.VVV.f..HH.', // 11: Base de lentes, sonrisita y rubor
  '...HH..FFFFFFFFF..HH....', // 12: Barbilla y cuello
  '.....ddddAAAAAdddd......', // 13: Bufanda Gryffindor: escarlata y oro
  '..x..AAAAddddAAAAAdd....', // 14: Vuelta de bufanda + inicio chispa mágica
  '.xXx.ddddAAAAAdddd.dd...', // 15: Chispita mágica dorada y caída de bufanda
  '..M..TTTTTTTTTTTTT.AA...', // 16: Varita de acebo y túnica Hogwarts
  '..M..FTTTTTTTTTTTT.dd...', // 17: Manito sosteniendo varita
  '.....TTTTTTTTTTTTT......', // 18: Túnica cuerpo
  '.....PPPP.....PPPP......', // 19: Pantalón
  '....SSSS.......SSSS.....', // 20: Zapatitos apoyados
  '....SSSS.......SSSS.....', // 21: Base en la nieve
];

// Lentes redondos bien definidos:
// Lente izquierdo: cols 6-10 (ancho 5) -> .VVV. en fila 9, V W E K V en fila 10, .VVV. en fila 11
// Puente: col 11-12
// Lente derecho: cols 13-17 (ancho 5) -> .VVV. en fila 9, V W E K V en fila 10, .VVV. en fila 11
const HARRY_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '..HH..VVVVV.VV.VVVVV..HH' },
  { fila: 10, mapa: '..HH.VWKEV.VV.VWKEV..HH.' },
];

const HARRY_OJOS_CERRADOS = [
  { fila: 9,  mapa: '..HH..VVVVV.VV.VVVVV..HH' },
  { fila: 10, mapa: '..HH.VFFFFV.VV.VFFFFV.HH.' },
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
  await sharp(Buffer.from(renderScene(HARRY_OJOS_ABIERTOS))).png().toFile(`${dir}/harry_v2_open.png`);
  await sharp(Buffer.from(renderScene(HARRY_OJOS_CERRADOS))).png().toFile(`${dir}/harry_v2_blink.png`);
  console.log('Saved v2!');
}
main();
