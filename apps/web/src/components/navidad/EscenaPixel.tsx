// Escenas navideñas en pixel art para el pie del menú lateral (encima del usuario):
// - Sección «dech»: pingüino original con gorro de Papá Noel (solo Dennise Chigne).
// - Sección «dasan»: Chibi dinosaurio T-Rex navideño con gorrito y bufanda (para Daniela Santos).
// - Sección «gaman»: capibara con gorro de duende y bastón de caramelo (ga.mancilla; por ahora también el rol admin).
// Dibujo en SVG nítido a cualquier zoom. Solo es visual: no recibe clics. Con «reducir animaciones» queda quieto.
import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';
import { useNavidadStore, type PersonajeNavidad } from '../../stores/navidadStore';

// ============================================================================
// 1. ÁRBOL NAVIDEÑO COMÚN CON LUCES TITILANTES
// ============================================================================
export const COLORES_ARBOL: Record<string, string> = {
  G: '#16a34a',
  g: '#166534',
  Y: '#facc15',
  B: '#92400e',
  R: '#ef4444',
  L: '#60a5fa',
  O: '#fb923c',
};
const LUCES = new Set(['R', 'L', 'O']);

export const ARBOL = [
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

export function PixelesArbol({ mapa, lado, className }: { mapa: string[]; lado: number; className?: string }) {
  const ancho = Math.max(...mapa.map((f) => f.length));
  let luz = 0;
  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={mapa.length * lado}
      viewBox={`0 0 ${ancho} ${mapa.length}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {mapa.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        const titila = LUCES.has(c);
        return (
          <rect
            key={`${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_ARBOL[c]}
            className={titila ? 'navidad-foco' : undefined}
            style={titila ? { animationDelay: `${(luz++ % 4) * 0.45}s` } : undefined}
          />
        );
      }))}
    </svg>
  );
}

// ============================================================================
// 2. SECCIÓN «dech»: PERSONAJE AZUL ORIGINAL CON GORRO DE PAPÁ NOEL
// ============================================================================
const COLORES_STITCH: Record<string, string> = {
  R: '#ef4444', // Gorro rojo
  W: '#ffffff', // Felpa y pompón blanco
  S: '#386ad4', // Azul principal
  s: '#2552b5', // Azul sombra
  d: '#1b2a4a', // Contorno / azul noche suave
  h: '#639bff', // Brillo azul piel
  C: '#a6c4ff', // Celeste pastel (panza y contorno ojos)
  c: '#8ab0f5', // Celeste contorno
  P: '#f08cc0', // Rosa orejas
  p: '#d66da4', // Rosa sombra
  q: '#9e3b6e', // Rosa profundo
  N: '#1a2b56', // Nariz azul marino
  K: '#0f172a', // Pupila oscura
  I: '#2552b5', // Iris azul profundo
};

// Mascota azul en perspectiva 3/4 con gorrito navideño rojo y pompón blanco esponjoso (27 cols x 22 filas):
const STITCH_BASE = [
  '...............RRWW........', // 0: Pompón blanco esponjoso
  '..............RRRRWW.......', // 1: Punta doblada del gorro
  '............RRRRRR.........', // 2: Caída del gorrito rojo
  '..dd.......RRRRRRR......dd.', // 3: Puntas de orejas anchas
  '.dPPd.....RRRRRRRR.....dPPd', // 4: Curva suave de orejas
  'dPPPPd...WWWWWWWWWW...dPPPP', // 5: Felpa blanca del gorro entre orejas
  'dPPPPqd..dSSSSSSSSd..dqPPPP', // 6: Muesca en oreja izquierda + frente azul
  '.dPPPPddSSSSSSSSSSSSddPPPPd', // 7: Base de orejas redondeada
  '...........................', // 8: (Ojos dinámicos)
  '...........................', // 9: (Ojos dinámicos)
  '...........................', // 10: (Ojos dinámicos)
  '....sPsCCCCssNNNssCCCCsPs..', // 11: Mejillas con rubor rosado + naricita redonda
  '....sPPsdSSSsNNNsSSSdsPPs..', // 12: Nariz y mejillas redondeadas
  '.....dd..sSSSSSSSSs..dd....', // 13: Boquita dulce sonriente
  '.......ddSSSSSSSSSSdd......', // 14: Cuellito suave natural
  '.....ddSS.CCCCCCCC.SSdd....', // 15: Pecho celeste pastel y bracitos
  '....dSSSS.CCCCCCCC.SSSSd...', // 16: Pecho celeste pastel
  '....dSSSSSCCCCCCCCSSSSSd...', // 17: Barriguita redonda
  '....dSSSS.dWW..WWd.SSSSd...', // 18: Manitos/patitas tiernas apoyadas al frente
  '.....dSSSSdWW..WWdSSSSd....', // 19: Patitas de cachorro
  '......dSSSSSSSSSSSSSSd.....', // 20: Base del cuerpo sentadito
  '.......ddSSSSSSSSSSdd......', // 21: Apoyado en la nieve
];

const STITCH_OJOS_ABIERTOS = [
  { fila: 8, mapa: '..dPPddSCWWdsSSSsdWWCSdPPd.' },
  { fila: 9, mapa: '...dd.sCWWKIsSSSsIKWWCs.dd.' },
  { fila: 10, mapa: '.....sCCKIWCsNNNsCWIICCs...' },
];

const STITCH_OJOS_CERRADOS = [
  { fila: 8, mapa: '..dPPddSSSSSSSSSSSSSSSdPPd.' },
  { fila: 9, mapa: '...dd.sCdddCsSSSsCdddCs.dd.' },
  { fila: 10, mapa: '.....sCCCCssNNNssCCCCs.....' },
];

export function StitchPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...STITCH_BASE.map((f) => f.length));
  const alto = STITCH_BASE.length;

  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={alto * lado}
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {/* Cuerpo base de la mascota */}
      {STITCH_BASE.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        return (
          <rect
            key={`st-base-${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_STITCH[c]}
          />
        );
      }))}

      {/* Capa de ojos abiertos */}
      <g className="navidad-ojos-abiertos">
        {STITCH_OJOS_ABIERTOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`st-open-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_STITCH[c]}
            />
          );
        }))}
      </g>

      {/* Capa de ojos parpadeando tiernos (^ ^) */}
      <g className="navidad-ojos-cerrados">
        {STITCH_OJOS_CERRADOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`st-closed-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_STITCH[c]}
            />
          );
        }))}
      </g>
    </svg>
  );
}

// Alias para compatibilidad
export const PinguinoPixel = StitchPixel;


// ============================================================================
// 3. SECCIÓN «dasan»: CHIBI DINOSAURIO T-REX NAVIDEÑO
// ============================================================================
const COLORES_TREX: Record<string, string> = {
  G: '#22c55e', // Verde esmeralda alegre (cuerpo)
  H: '#4ade80', // Verde highlight
  d: '#16a34a', // Verde medio sombra
  s: '#15803d', // Verde sombra profunda
  k: '#14532d', // Contorno verde noche suave (sin negro duro)
  Y: '#fef08a', // Amarillo crema pastel (barriguita)
  y: '#fde047', // Amarillo sombra
  K: '#0f172a', // Pupila profunda
  W: '#ffffff', // Blanco puro (ojos, dientitos, pompom, nieve, garritas)
  c: '#f1f5f9', // Felpa sombra suave
  P: '#fb7185', // Rubor rosado mejilla
  T: '#f43f5e', // Lengüita rosada tierna
  D: '#881337', // Fondo interior boca
  R: '#ef4444', // Rojo navideño brillante (gorro y bufanda)
  r: '#b91c1c', // Rojo sombra
  O: '#fb923c', // Espinas dorsales naranja festivo
  o: '#ea580c', // Sombra espinas
};

// Chibi T-Rex Kawaii Navideño (29 cols x 23 rows):
// - Silueta 100% dinosaurio therópodo: mandíbula rugiendo "Rawr!" con dientitos y lengüita rosada
// - Cresta ósea sobre ojo kawaii, bracitos clásicos de T-Rex con garras
// - Lomo y cola larga horizontal de dinosaurio con espinitas naranja festivas
// - Patas con garras firmes sobre la nieve mientras la cola se eleva al aire
const TREX_BASE = [
  '...........RRWW..............', // 0: Pompón del gorro blanco esponjoso
  '.........RRRRWW..............', // 1: Punta doblada del gorro
  '......RRRRRRRR...............', // 2: Cono del gorro rojo
  '...RRRRRRRRRR................', // 3: Corona del gorro
  '.cccccccccccccc..............', // 4: Felpa sombra
  '.WWWWWWWWWWWWWW..............', // 5: Felpa blanca esponjosa
  'kkGGGGGGGGGGGGkk..kO.........', // 6: Frente del T-Rex + 1ra espina dorsal anclada
  'kGGGGGGGGGGGGGGGGkOo.........', // 7: Cresta ósea sobre el ojo
  '.............................', // 8: (Ojo dinámico)
  '.............................', // 9: (Ojo dinámico)
  '.............................', // 10: (Ojo dinámico)
  'kGGGGGGGGGkPPkdGGGGGk........', // 11: Rubor rosado en mejilla
  'kGGGGGGkWWkkkddddGGGGk.......', // 12: Diente superior + mandíbula abierta
  '.kGGGkk.DDDDDDkkkGGGGk.kO....', // 13: Mandíbula abierta rugiendo "Rawr!" + 3ra espina
  '..kGGk..kTTTTkk..kGGGGkkOo...', // 14: Lengüita rosada tierna
  '..kkkGkkWWkkkk...kRRRRRRkk...', // 15: Diente inferior + inicio de bufanda
  '....kRRRRRRRRRRRRRRRRRRRk....', // 16: Bufanda roja abrigada
  '...kWWkdGkYYYYYkGGGGGGGGGGkO.', // 17: Bracito T-Rex con garritas + pecho crema + espina cola
  '..kWWkdGGkYYYYYkGGGGGGGGGGGkOo', // 18: Manitas adorables + cola flotando en el aire
  '...kk.kddkYYYYYkGGGGGGGGGGGGkO', // 19: Barriga crema + cola larga horizontal de terópodo
  '......kGGGGYYYYkkkGGGGGGGGkkk.', // 20: Muslo de T-Rex + punta de la cola
  '.....kGGGGkkkGGGGk..kkkkkk....', // 21: Dos patas de dinosaurio bajo la cadera
  '.....kWWWWk..kWWWWk...........', // 22: Garras blancas de dinosaurio en la nieve
];

const TREX_OJOS_ABIERTOS = [
  { fila: 8, mapa:  'kGGGGGGGGkWWkGGGGGkk.........' },
  { fila: 9, mapa:  'kGGGGGGGGkWWKKGGGGGk..kO.....' },
  { fila: 10, mapa: 'kGdGGGGGGkKKKKdGGGGkkkOo.....' },
];

const TREX_OJOS_CERRADOS = [
  { fila: 8, mapa:  'kGGGGGGGGGGGGGGGGGGkk........' },
  { fila: 9, mapa:  'kGGGGGGGGkddddkGGGGk..kO.....' },
  { fila: 10, mapa: 'kGdGGGGGGkGGGGkdGGGkkkOo.....' },
];

export function TRexPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...TREX_BASE.map((f) => f.length));
  const alto = TREX_BASE.length;

  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={alto * lado}
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {TREX_BASE.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        return (
          <rect
            key={`tr-base-${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_TREX[c]}
          />
        );
      }))}
      <g className="navidad-ojos-abiertos">
        {TREX_OJOS_ABIERTOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`tr-open-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_TREX[c]}
            />
          );
        }))}
      </g>
      <g className="navidad-ojos-cerrados">
        {TREX_OJOS_CERRADOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`tr-closed-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_TREX[c]}
            />
          );
        }))}
      </g>
    </svg>
  );
}

// ============================================================================
// 3b. SECCIÓN «gaman»: CAPIBARA NAVIDEÑA CON GORRO DE DUENDE Y BASTÓN DE CARAMELO
// ============================================================================
const COLORES_CAPIBARA: Record<string, string> = {
  B: '#c99a6c', // Pelaje
  b: '#a97c52', // Rayitas del lomo
  M: '#8b6347', // Hocico y patitas
  k: '#5a3a24', // Contorno café
  K: '#2b1a10', // Ojo
  P: '#f4a3a3', // Rubor
  G: '#22c55e', // Gorro verde
  g: '#15803d', // Sombra del gorro
  R: '#ef4444', // Rojo (borde del gorro, bastón, lazo)
  r: '#b91c1c', // Nudo del lazo
  W: '#ffffff', // Pompón y franjas del bastón
};

// Capibara de perfil (mira a la izquierda), 28 x 20. El ojo va en capa aparte para que parpadee.
const CAPIBARA_BASE = [
  '............GGW.............',
  '..........GGGGWW............',
  '........GGGGGGG.............',
  '......gGGGGGGGGg............',
  '.....RRRRRRRRRRRR...........',
  '....kRRRRRRRRRRRRk..........',
  '...kBBBBBBBBBBMMBBkkkkkkk...',
  '..kMMMMBBBBBBBBBBBBBBBBBBkk.',
  '.kMMMMMBBBBBBBBBBBbBBBBBBBBk',
  '.kMkMMMBB.BBBBBBBBBBbBBBBBBk',
  '.kMMMMMBB.BBBBBBBBBBBBBBBbBk',
  '.kMMMMBBPPBBBBBBBBBBBBBBBBBk',
  '..kMkMBBBBBBBBBBBBBBBBBBBBBk',
  '...kkBBBBBBBBBBBBBBBBBBBBBBk',
  '....kBBBBBBBBBBBBBBBBBBBBBBk',
  '....kBBBBBBBBBBBBBBBBBBBBBk.',
  '.....kBBBBBBBBBBBBBBBBBBBBk.',
  '.....kBBBkkkkBBBkkkkkkBBBk..',
  '.....kMMMk...kMMk....kMMMk..',
  '......kkk.....kk......kkk...',
];
// Bastón de caramelo con lazo, sostenido delante del cuerpo: [x, y, color].
const CAPIBARA_BASTON: Array<[number, number, string]> = [
  // gancho
  [0, 12, 'W'], [0, 11, 'R'], [1, 10, 'W'], [2, 10, 'R'], [3, 11, 'W'], [3, 12, 'R'],
  // palo a franjas
  [3, 13, 'W'], [3, 14, 'R'], [3, 15, 'W'], [3, 17, 'W'], [3, 18, 'R'],
  // lazo (su nudo va en el palo, en [3, 16])
  [1, 15, 'R'], [2, 16, 'R'], [1, 17, 'R'], [5, 15, 'R'], [4, 16, 'R'], [5, 17, 'R'], [3, 16, 'r'],
];
const CAPIBARA_OJOS_ABIERTOS: Array<[number, number, string]> = [[9, 9, 'K'], [9, 10, 'K']];
const CAPIBARA_OJOS_CERRADOS: Array<[number, number, string]> = [[9, 9, 'B'], [9, 10, 'k']];

export function CapibaraPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...CAPIBARA_BASE.map((f) => f.length));
  const alto = CAPIBARA_BASE.length;
  const puntos = (lista: Array<[number, number, string]>, clave: string) =>
    lista.map(([x, y, c]) => <rect key={`${clave}-${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORES_CAPIBARA[c]} />);
  return (
    <svg aria-hidden width={ancho * lado} height={alto * lado} viewBox={`0 0 ${ancho} ${alto}`} shapeRendering="crispEdges" className={className}>
      {CAPIBARA_BASE.flatMap((fila, y) => [...fila].map((c, x) => (
        c === '.' ? null : <rect key={`cp-${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORES_CAPIBARA[c]} />
      )))}
      <g className="navidad-ojos-abiertos">{puntos(CAPIBARA_OJOS_ABIERTOS, 'cp-open')}</g>
      <g className="navidad-ojos-cerrados">{puntos(CAPIBARA_OJOS_CERRADOS, 'cp-closed')}</g>
      {puntos(CAPIBARA_BASTON, 'cp-baston')}
    </svg>
  );
}

// ============================================================================
// 5. SECCIÓN «jaruiz»: JOVEN MAGO CON LENTES, BUFANDA Y GORRO NAVIDEÑO
// ============================================================================
const COLORES_MAGO: Record<string, string> = {
  R: '#ef4444', // Gorro navideño rojo vivo
  r: '#b91c1c', // Gorro sombra
  W: '#ffffff', // Felpa, pompón y destellos
  w: '#f1f5f9', // Felpa sombra suave
  H: '#0a0f1d', // Cabello negro azabache contorno y sombras
  h: '#1e293b', // Cabello grafito mechones
  F: '#fed7aa', // Piel cálida
  p: '#fca5a5', // Rubor rosado mejillas
  b: '#d97706', // Sonrisita dulce
  Z: '#dc2626', // Cicatriz escarlata
  V: '#0f172a', // Marco de lentes negro grafito
  u: '#334155', // Línea de ojos cerrados (^ ^)
  K: '#020617', // Pupila oscura
  E: '#16a34a', // Verde esmeralda vivo
  e: '#15803d', // Verde esmeralda sombra
  D: '#991b1b', // Escarlata oscuro bufanda
  d: '#dc2626', // Escarlata vivo bufanda
  A: '#f59e0b', // Oro bufanda
  a: '#d97706', // Oro sombra bufanda
  T: '#1e293b', // Túnica gris pizarra oscura
  t: '#0f172a', // Contorno túnica
  C: '#ffffff', // Cuello camisa
  I: '#dc2626', // Corbata escarlata
  i: '#f59e0b', // Franja dorada de corbata
  M: '#78350f', // Varita madera
  m: '#92400e', // Varita clara
  X: '#fef08a', // Chispita mágica dorada
  x: '#ffffff', // Destello blanco en la chispa
  P: '#334155', // Pantalón
  S: '#0f172a', // Zapatos negros
};

const MAGO_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Punta doblada con sombra
  '............RRRRrr......', // 2: Caída del gorrito rojo
  '..........RRRRRRrr......', // 3: Cono del gorro con sombra
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa
  '....HHHHHHHHHHH.Z.HHHH..', // 6: Cabello azabache y punta del rayo (Z)
  '..HHH.HH.FFFFFFZZF.HHH..', // 7: Mechones despeinados y rayo (ZZ) sobre ojo derecho
  '..HHH..VVV..FF..VVV.HH..', // 8: Frente y marco superior de ambos lentes
  '........................', // 9: (Ojos dinámicos con lentes)
  '........................', // 10: (Ojos dinámicos con lentes y puente)
  '..HHp..VVV..FF..VVV.pH..', // 11: Base de lentes y rubor rosado en mejillas
  '...HH...FFFF.b.FFFF..HH.', // 12: Boquita sonriente dulce y barbilla
  '.....ddddAAAAAddddAAAA..', // 13: Bufanda Gryffindor: escarlata y oro (vuelta 1)
  '..X..AAAAddddAAAAdddd...', // 14: Bufanda: vuelta 2 + chispita mágica dorada
  '.xXx.ddddAAAAAdddd.dd...', // 15: Chispita brillante y caída de bufanda
  '..m..TTTTTCICCTTTT.AA...', // 16: Varita mágica, túnica y cuello de camisa con corbata
  '...M.TTTTTIiITTTTT.dd...', // 17: Varita de acebo y nudo de corbata con franja dorada
  '..FM.TTTTTTITTTTTT.AA...', // 18: Manito sosteniendo varita y fleco bufanda
  '..TT.TTTTTTTTTTTTT.dd...', // 19: Manga de la túnica y bufanda
  '.....TTTTTTTTTTTTT.aa...', // 20: Túnica Hogwarts y flecos dorados
  '.....TTTTTtTtTTTTT......', // 21: Pliegues de la túnica larga
  '.....PPPPP...PPPPP......', // 22: Pantalón escolar
  '.....PPPPP...PPPPP......', // 23: Pantalón largo
  '....SSSS.......SSSS.....', // 24: Zapatos negros
  '...SSSSS......SSSSS....', // 25: Base firme de botas sobre la nieve
];

const MAGO_OJOS_ABIERTOS = [
  { fila: 9, mapa: '..HH..VWKEV.FF.VWKEV..HH' },
  { fila: 10, mapa: '..HH..VeEEV.VV.VeEEV..HH' },
];

const MAGO_OJOS_CERRADOS = [
  { fila: 9, mapa: '..HH..VFFFV.FF.VFFFV..HH' },
  { fila: 10, mapa: '..HH..VuuuV.VV.VuuuV..HH' },
];

export function HarryPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...MAGO_BASE.map((f) => f.length));
  const alto = MAGO_BASE.length;

  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={alto * lado}
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {/* Base del mago */}
      {MAGO_BASE.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        return (
          <rect
            key={`hp-base-${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_MAGO[c]}
          />
        );
      }))}

      {/* Ojos abiertos con destello y mirada esmeralda */}
      <g className="navidad-ojos-abiertos">
        {MAGO_OJOS_ABIERTOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`hp-open-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_MAGO[c]}
            />
          );
        }))}
      </g>

      {/* Ojos parpadeando (^ ^) */}
      <g className="navidad-ojos-cerrados">
        {MAGO_OJOS_CERRADOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`hp-closed-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_MAGO[c]}
            />
          );
        }))}
      </g>
    </svg>
  );
}

export const MagoPixel = HarryPixel;

// ============================================================================
// 6. SECCIÓN «institucional»: ESPONJA AMARILLA CON PANTALÓN CUADRADO Y GORRO NAVIDEÑO
// ============================================================================
const COLORES_BOB: Record<string, string> = {
  R: '#ef4444', // Gorro navideño rojo vivo
  r: '#b91c1c', // Gorro sombra
  W: '#ffffff', // Felpa, pompón y dientes
  w: '#f1f5f9', // Felpa sombra
  Y: '#facc15', // Amarillo esponja vivo cálido
  y: '#eab308', // Amarillo sombra
  d: '#ca8a04', // Poros mostaza suave
  k: '#1e293b', // Contorno suave pizarra
  N: '#f59e0b', // Nariz naranja-amarillo
  n: '#fbbf24', // Nariz brillo
  A: '#38bdf8', // Celeste cielo vivo
  a: '#0284c7', // Azul iris
  K: '#0f172a', // Pupila
  p: '#fca5a5', // Rubor rosado pastel
  q: '#f43f5e', // Pecas suaves
  m: '#9f1239', // Boca cálida
  l: '#fb7185', // Lengüita rosada tierna
  D: '#ffffff', // Dientes frontales blancos
  C: '#ffffff', // Camisa blanca
  T: '#ef4444', // Corbata roja
  P: '#854d0e', // Pantalones marrones
  t: '#713f12', // Marrón sombra
  U: '#0f172a', // Cinturón negro
  H: '#ef4444', // Franja roja medias
  I: '#38bdf8', // Franja azul medias
  S: '#0f172a', // Zapatos negros
};

const BOB_BASE = [
  '...............RRWW.....', // 0: Pompón blanco esponjoso
  '..............RRrrWW....', // 1: Punta doblada con sombra
  '............RRRRrr......', // 2: Caída del gorrito rojo
  '..........RRRRRRrr......', // 3: Cono del gorro
  '........RRRRRRRRrrrr....', // 4: Base roja del gorro
  '......wWWWWWWWWWWWWWWw..', // 5: Felpa blanca esponjosa
  '....kYYYYYYYYYYYYYYYYk..', // 6: Tope esponjoso amarillo
  '....kYYdYYdYYYYYdYYdYk..', // 7: Frente con poros suaves
  '....kYYYYkYkYYYYkYkYYk..', // 8: Pestañas delicadas sobre frente sólida
  '........................', // 9: (Ojos dinámicos)
  '........................', // 10: (Ojos dinámicos)
  '........................', // 11: (Ojos dinámicos y nariz)
  '....kYppYYWWNNWWYYppYk..', // 12: Mejillas rosadas, base de ojos y naricita
  '....kYppkDDkmmkDDkpYk...', // 13: 2 DIENTES FRONTALES adorables y sonrientes
  '....kYYYkmmllllmmkYYYk..', // 14: Boquita abierta sonriente con lengüita rosada
  '....kYYYYkkkkkkkkYYYYk..', // 15: Barbilla tierna con hoyuelo
  '..kCkCCCCCCCCCCCCCCkCk..', // 16: Mangas blancas de camisa
  '.kYk.kCCCCTTTCCCCCk.kYk.', // 17: Bracitos amarillos y corbata roja
  '.kYk.kPPUUPPUUPPUUPk.kYk', // 18: Manitos en jarras y cinturón
  '..kk.kPPPPPPPPPPPPk..kk.', // 19: Pantalones cuadrados marrones
  '......kPPPk....kPPPk....', // 20: Perneras del pantalón
  '.......kYk......kYk.....', // 21: Piernitas delgadas amarillas
  '.......kHk......kHk.....', // 22: Franja roja de las medias canónicas
  '.......kIk......kIk.....', // 23: Franja azul de las medias canónicas
  '.......kWk......kWk.....', // 24: Medias blancas
  '......kSSSk....kSSSk....', // 25: Zapatitos negros de charol en la nieve
];

const BOB_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '....kYYYWWWWYYWWWWYYYk..' },
  { fila: 10, mapa: '....kYYYWWAKnNNKAWWYYYk.' },
  { fila: 11, mapa: '....kYYYWWAKNNNKAWWYYYk.' },
];

const BOB_OJOS_CERRADOS = [
  { fila: 9,  mapa: '....kYYYYYYYYYYYYYYYYk..' },
  { fila: 10, mapa: '....kYYYYYYYYnNNYYYYYYk.' },
  { fila: 11, mapa: '....kYYYkkkkkNNkkkkkYYk.' },
];

export function BobPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...BOB_BASE.map((f) => f.length));
  const alto = BOB_BASE.length;

  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={alto * lado}
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {/* Base de la esponja */}
      {BOB_BASE.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        return (
          <rect
            key={`bob-base-${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_BOB[c]}
          />
        );
      }))}

      {/* Ojos abiertos azules con pestañas */}
      <g className="navidad-ojos-abiertos">
        {BOB_OJOS_ABIERTOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`bob-open-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_BOB[c]}
            />
          );
        }))}
      </g>

      {/* Ojos cerrados parpadeando */}
      <g className="navidad-ojos-cerrados">
        {BOB_OJOS_CERRADOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`bob-closed-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_BOB[c]}
            />
          );
        }))}
      </g>
    </svg>
  );
}

export const EsponjaPixel = BobPixel;

// ============================================================================
// 7. SECCIÓN «dasirvas»: MARSUPIAL NARANJA INTRÉPIDO CON GRAN SONRISA Y GORRO NAVIDEÑO
// ============================================================================
const COLORES_CRASH: Record<string, string> = {
  R: '#ef4444', // Gorro navideño rojo vivo
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

const CRASH_BASE = [
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

const CRASH_OJOS_ABIERTOS = [
  { fila: 9,  mapa: '.....dOWWWWWddWWWWWOd.....' },
  { fila: 10, mapa: '.....dOWWGKNddNKGWWod.....' },
  { fila: 11, mapa: '.....dOWWGGNddNGGWWOd.....' },
];

const CRASH_OJOS_CERRADOS = [
  { fila: 9,  mapa: '.....dOOOOOOOOOOOOOOd.....' },
  { fila: 10, mapa: '.....dOOkkkkkOOkkkkkOd....' },
  { fila: 11, mapa: '.....dOOOOOOOOOOOOOOd.....' },
];

export function CrashPixel({ lado = 2, className }: { lado?: number; className?: string }) {
  const ancho = Math.max(...CRASH_BASE.map((f) => f.length));
  const alto = CRASH_BASE.length;

  return (
    <svg
      aria-hidden
      width={ancho * lado}
      height={alto * lado}
      viewBox={`0 0 ${ancho} ${alto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      {/* Base del marsupial */}
      {CRASH_BASE.flatMap((fila, y) => [...fila].map((c, x) => {
        if (c === '.') return null;
        return (
          <rect
            key={`crash-base-${x}-${y}`}
            x={x} y={y} width={1} height={1}
            fill={COLORES_CRASH[c]}
          />
        );
      }))}

      {/* Ojos abiertos verdes esmeralda */}
      <g className="navidad-ojos-abiertos">
        {CRASH_OJOS_ABIERTOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`crash-open-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_CRASH[c]}
            />
          );
        }))}
      </g>

      {/* Ojos cerrados parpadeando */}
      <g className="navidad-ojos-cerrados">
        {CRASH_OJOS_CERRADOS.flatMap(({ fila, mapa }) => [...mapa].map((c, x) => {
          if (c === '.') return null;
          return (
            <rect
              key={`crash-closed-${x}-${fila}`}
              x={x} y={fila} width={1} height={1}
              fill={COLORES_CRASH[c]}
            />
          );
        }))}
      </g>
    </svg>
  );
}

export const MarsupialPixel = CrashPixel;

// ============================================================================
// 8. ESCENA INTERACTIVA Y PERSONAJE PREDETERMINADO
// ============================================================================

export type Seccion = 'dech' | 'dasan' | 'gaman' | 'jaruiz' | 'institucional' | 'dasirvas';

const SECCIONES: Record<string, Seccion> = {
  'de.chigne@limablue.com': 'dech',
  'dechigne@limablue.com': 'dech',
  'al.leyva@limablue.com': 'dech',
  'alleyva@limablue.com': 'dech',
  'da.santos@limablue.com': 'dasan',
  'dasantos@limablue.com': 'dasan',
  'ga.mancilla@limablue.com': 'gaman',
  'gamancilla@limablue.com': 'gaman',
  'ja.ruiz@limablue.com': 'jaruiz',
  'jaruiz@limablue.com': 'jaruiz',
  'institucional@limablue.com': 'institucional',
  'da.sirvas@limablue.com': 'dasirvas',
  'dasirvas@limablue.com': 'dasirvas',
};

/** TEMPORAL (17-nov-2026): el rol admin ve la capibara por defecto. Poner en false para quitarlo. */
export const ADMIN_VE_CAPIBARA = true;

/** Qué personaje le corresponde por defecto según su correo o rol (si no ha elegido uno en el modal). */
export function personajePredeterminado(email?: string | null, rol?: string | null): PersonajeNavidad {
  const norm = (email ?? '').trim().toLowerCase();
  const seccion = SECCIONES[norm];
  if (seccion === 'dasirvas') return 'crash';
  if (seccion === 'jaruiz') return 'harry';
  if (seccion === 'institucional') return 'bob';
  if (seccion === 'dasan') return 'dino';
  if (seccion === 'gaman') return 'capibara';
  if (seccion === 'dech') return 'stitch';
  if (ADMIN_VE_CAPIBARA && rol === 'admin') return 'capibara';
  return 'stitch';
}

/** Compatibilidad con código previo que consultaba la sección. */
export function seccionNavidena(email?: string | null, rol?: string | null): Seccion | null {
  const propia = SECCIONES[(email ?? '').trim().toLowerCase()];
  if (propia) return propia;
  if (ADMIN_VE_CAPIBARA && rol === 'admin') return 'gaman';
  return null;
}

function Escena({
  compacto,
  testid,
  onClick,
  children,
}: {
  compacto: boolean;
  testid: string;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="w-full flex justify-center">
      <button
        type="button"
        onClick={onClick}
        data-testid={testid}
        title="Haz clic para elegir o cambiar tu personaje navideño 🎄"
        className="group relative select-none flex flex-col items-center justify-center cursor-pointer focus:outline-none transition-transform hover:scale-105 active:scale-95 mx-auto"
      >
        <div className={cn('flex items-end justify-center', compacto ? 'gap-0' : 'gap-2.5')}>
          <PixelesArbol mapa={ARBOL} lado={compacto ? 2 : 3} />
          {!compacto && children && <div className="navidad-mascota-pixel origin-bottom">{children}</div>}
        </div>
        <div className={cn('h-1.5 rounded-full bg-white/80 -mt-0.5', compacto ? 'w-9' : 'w-32')} />
        {!compacto && (
          <span className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-5 text-[10px] bg-black/75 text-white px-2 py-0.5 rounded-full pointer-events-none whitespace-nowrap shadow">
            Cambiar personaje ✨
          </span>
        )}
      </button>
    </div>
  );
}

/** Escena navideña del pie del menú: arbolito + la mascota seleccionada por el usuario (o su predeterminada). */
export function EscenaPixel({ compacto = false }: { compacto?: boolean }) {
  const usuario = useAuthStore((s) => s.usuario);
  const personajeGuardado = useNavidadStore((s) => s.personaje);
  const abrirModalSelector = useNavidadStore((s) => s.abrirModalSelector);

  const personaje = personajeGuardado ?? personajePredeterminado(usuario?.email, usuario?.rol);

  let mascota: ReactNode = null;
  if (personaje === 'crash') mascota = <CrashPixel lado={2} />;
  else if (personaje === 'harry') mascota = <HarryPixel lado={2} />;
  else if (personaje === 'bob') mascota = <BobPixel lado={2} />;
  else if (personaje === 'dino') mascota = <TRexPixel lado={2} />;
  else if (personaje === 'capibara') mascota = <CapibaraPixel lado={2} />;
  else if (personaje === 'stitch') mascota = <StitchPixel lado={2} />;
  // 'arbol' -> mascota es null, solo se muestra el árbol

  return (
    <Escena compacto={compacto} testid={`navidad-escena-${personaje}`} onClick={abrirModalSelector}>
      {mascota}
    </Escena>
  );
}
