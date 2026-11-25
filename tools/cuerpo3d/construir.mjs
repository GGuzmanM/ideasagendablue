// Construye los dos modelos del mapa corporal 3D (Fisioterapia) a partir de BodyParts3D 4.0: «Piel» y «Músculos».
// Son EL MISMO cuerpo (misma pose y tamaño): la piel es la superficie corporal de BodyParts3D y debajo van sus músculos y huesos.
//
//   cd tools/cuerpo3d && npm install && node construir.mjs
//       →  apps/web/src/assets/cuerpo3d.bin (piel)  y  apps/web/src/assets/cuerpo3d-musculos.lbcz (músculos)
//
// Fuente: BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution 4.0 International
// (https://dbarchive.biosciencedbc.jp/en/bodyparts3d/). Esa atribución es OBLIGATORIA y la pantalla la muestra junto al modelo.
// El original pesa 136 MB y NO va al repositorio. Para regenerar:
//   1. bajar https://dbarchive.biosciencedbc.jp/data/bodyparts3d/LATEST/isa_BP3D_4.0_obj_99.zip a fuente-bp3d/
//   2. descomprimir sus 2 234 .obj en fuente-bp3d/obj/   (isa_element_parts.txt ya está en fuente-bp3d/)
//
// MÚSCULOS: 1) se eligen músculos (y tendones) y huesos (con cartílagos, ligamentos y dientes): ~730 de las 2 234 piezas,
// 2) cada pieza se simplifica (meshoptimizer) hasta ~9–13 % de sus triángulos, 3) se pasa a metros con los pies en el piso
// (y arriba, +z al frente, izquierda del paciente en x > 0), 4) se hornea el sombreado (oclusión ambiental: es lo que separa
// visualmente un músculo de otro), 5) cada vértice recibe su ZONA —con «huesos de zona» sacados de los huesos reales— y la
// pieza a la que pertenece (para decir su nombre), 6) se escribe el binario «LBC1» comprimido con gzip.
//
// PIEL: la pieza «Skin» es el escaneo de una persona real y no es simétrica. Se toma su mitad izquierda, se simplifica, se
// refleja (cuerpo SIMÉTRICO) y se suaviza; después recibe sombreado y las MISMAS zonas, y sus triángulos se cortan por el
// borde exacto de las zonas (esa es la línea fina que se dibuja).
//
// Los ids de zona se guardan en la historia clínica (dibujos_silueta, vista «cuerpo3d»): NO cambiarlos. Tampoco la forma o
// escala de un modelo ya en uso: lo pintado con el pincel son puntos de ESE modelo, en milímetros.
// OJO: a BodyParts3D 4.0 le faltan algunos músculos (recto del abdomen, dorsal ancho, masetero, músculos de la cara…).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const AQUI = dirname(fileURLToPath(import.meta.url));
const OBJ = resolve(AQUI, 'fuente-bp3d/obj');
const SALIDA = resolve(AQUI, '../../apps/web/src/assets/cuerpo3d-musculos.lbcz');
const SALIDA_PIEL = resolve(AQUI, '../../apps/web/src/assets/cuerpo3d.bin');
const CREDITO = 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International';
if (!existsSync(OBJ)) { console.error('Falta fuente-bp3d/obj (ver la cabecera de este archivo)'); process.exit(1); }
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
await MeshoptSimplifier.ready;

// ───────────────────────── 1) Qué piezas entran ─────────────────────────
const conceptos = new Map(); // pieza → nombres de los conceptos que la contienen
for (const l of readFileSync(resolve(AQUI, 'fuente-bp3d/isa_element_parts.txt'), 'utf8').split('\n').slice(1)) {
  const [, n, e] = l.trim().split('\t');
  if (!e) continue;
  if (!conceptos.has(e)) conceptos.set(e, new Set());
  conceptos.get(e).add(n.toLowerCase());
}
const MUSCULO_EXTRA = /trapezius|^set of (lumbricals|dorsal interossei|palmar interossei|interspinales|levatores|anterior cervical intertransversarii|posterior cervical intertransversarii)/;
const TEJIDO_BLANDO = /tendon|tract|aponeurosis|linea alba|raphe|tendinous|membrane|ligament|taenia/;
const HUESO_EXTRA = /^(body of sternum|manubrium)$|costal cartilage|tooth|intervertebral dis[ck]/;
const FUERA = /papillary|taenia|anal sphincter|commissure|vitreous|lacrimal lake|conus elasticus|vocal ligament|check ligament|tendinous ring|trochlea of superior oblique/; // del corazón, colon, ojo…
/** 'm' músculo · 't' tendón / fascia / ligamento · 'h' hueso · 'c' cartílago y discos · null = no entra. */
function tejido(e, nombre) {
  const cs = conceptos.get(e) ?? new Set(); const n = nombre.toLowerCase(); const todo = [...cs].join(' | ') + ' | ' + n;
  if (FUERA.test(todo)) return null;
  if (cs.has('bone organ') || /^(body of sternum|manubrium)$/.test(n.replace(/\b(left|right) /, '')) || /tooth/.test(n)) return 'h';
  if (cs.has('cartilage organ') || /costal cartilage|intervertebral dis[ck]/.test(n)) return 'c';
  if (cs.has('ligament organ') || /interosseous membrane|linea alba|thyrohyoid membrane/.test(n)) return 't';
  if (cs.has('muscle organ') || /\bmuscle\b|tendon|aponeurosis|\bfascia\b|diaphragm/.test(todo) || MUSCULO_EXTRA.test(n.replace(/\b(left|right) /, '')) || HUESO_EXTRA.test(n)) {
    return TEJIDO_BLANDO.test(n) ? 't' : 'm';
  }
  return null;
}

// ───────────────────────── Nombres en español ─────────────────────────
const ES = {
  // hombro y brazo
  'acromial part of deltoid': 'Deltoides (porción acromial)', 'clavicular part of deltoid': 'Deltoides (porción clavicular)', 'spinal part of deltoid': 'Deltoides (porción espinal)',
  'abdominal part of pectoralis major': 'Pectoral mayor (porción abdominal)', 'clavicular part of pectoralis major': 'Pectoral mayor (porción clavicular)', 'sternocostal part of pectoralis major': 'Pectoral mayor (porción esternocostal)',
  'pectoralis minor': 'Pectoral menor', 'subclavius': 'Subclavio', 'serratus anterior': 'Serrato anterior',
  'ascending part of trapezius': 'Trapecio (porción ascendente)', 'descending part of trapezius': 'Trapecio (porción descendente)', 'transverse part of trapezius': 'Trapecio (porción transversa)',
  'supraspinatus': 'Supraespinoso', 'infraspinatus muscle': 'Infraespinoso', 'teres major': 'Redondo mayor', 'teres minor': 'Redondo menor', 'subscapularis': 'Subescapular',
  'levator scapulae': 'Elevador de la escápula', 'rhomboid major': 'Romboides mayor', 'rhomboid minor': 'Romboides menor',
  'long head of biceps brachii': 'Bíceps braquial (cabeza larga)', 'short head of biceps brachii': 'Bíceps braquial (cabeza corta)',
  'lateral head of triceps brachii': 'Tríceps braquial (cabeza lateral)', 'long head of triceps brachii': 'Tríceps braquial (cabeza larga)', 'medial head of triceps brachii': 'Tríceps braquial (cabeza medial)',
  'brachialis': 'Braquial', 'brachioradialis': 'Braquiorradial', 'coracobrachialis': 'Coracobraquial', 'anconeus': 'Ancóneo', 'supinator': 'Supinador', 'pronator quadratus': 'Pronador cuadrado',
  'humeral head of pronator teres': 'Pronador redondo (cabeza humeral)', 'ulnar head of pronator teres': 'Pronador redondo (cabeza cubital)',
  // antebrazo y mano
  'flexor carpi radialis': 'Flexor radial del carpo', 'humeral head of flexor carpi ulnaris': 'Flexor cubital del carpo (cabeza humeral)', 'ulnar head of flexor carpi ulnaris': 'Flexor cubital del carpo (cabeza cubital)',
  'palmaris longus': 'Palmar largo', 'flexor digitorum superficialis': 'Flexor superficial de los dedos', 'flexor digitorum profundus': 'Flexor profundo de los dedos', 'flexor pollicis longus': 'Flexor largo del pulgar',
  'extensor carpi radialis longus': 'Extensor radial largo del carpo', 'extensor carpi radialis brevis': 'Extensor radial corto del carpo', 'extensor carpi ulnaris': 'Extensor cubital del carpo',
  'extensor digitorum': 'Extensor de los dedos', 'extensor digiti minimi': 'Extensor del meñique', 'extensor indicis': 'Extensor del índice',
  'extensor pollicis longus': 'Extensor largo del pulgar', 'extensor pollicis brevis': 'Extensor corto del pulgar', 'abductor pollicis longus': 'Abductor largo del pulgar', 'abductor pollicis brevis': 'Abductor corto del pulgar',
  'opponens pollicis': 'Oponente del pulgar', 'flexor pollicis brevis': 'Flexor corto del pulgar', 'superficial head of flexor pollicis brevis': 'Flexor corto del pulgar (cabeza superficial)',
  'oblique head of adductor pollicis': 'Aductor del pulgar (cabeza oblicua)', 'transverse head of adductor pollicis': 'Aductor del pulgar (cabeza transversa)',
  'abductor digiti minimi of hand': 'Abductor del meñique', 'flexor digiti minimi brevis of hand': 'Flexor corto del meñique', 'opponens digiti minimi of hand': 'Oponente del meñique',
  'set of lumbricals of hand': 'Lumbricales de la mano', 'set of dorsal interossei of hand': 'Interóseos dorsales de la mano', 'set of palmar interossei of hand': 'Interóseos palmares de la mano',
  // cuello y espalda
  'sternocleidomastoid': 'Esternocleidomastoideo', 'scalenus anterior': 'Escaleno anterior', 'scalenus medius': 'Escaleno medio', 'scalenus posterior': 'Escaleno posterior', 'platysma': 'Platisma',
  'splenius capitis': 'Esplenio de la cabeza', 'splenius cervicis': 'Esplenio del cuello', 'semispinalis capitis': 'Semiespinoso de la cabeza', 'semispinalis cervicis': 'Semiespinoso del cuello', 'semispinalis thoracis': 'Semiespinoso torácico',
  'longissimus capitis': 'Longísimo de la cabeza', 'longissimus cervicis': 'Longísimo del cuello', 'longissimus thoracis': 'Longísimo torácico',
  'iliocostalis cervicis': 'Iliocostal cervical', 'iliocostalis thoracis': 'Iliocostal torácico', 'iliocostalis lumborum': 'Iliocostal lumbar', 'spinalis': 'Espinoso', 'spinalis thoracis': 'Espinoso torácico',
  'longus capitis': 'Largo de la cabeza', 'obliquus capitis inferior': 'Oblicuo inferior de la cabeza', 'obliquus capitis superior': 'Oblicuo superior de la cabeza',
  'rectus capitis posterior major': 'Recto posterior mayor de la cabeza', 'rectus capitis posterior minor': 'Recto posterior menor de la cabeza', 'rectus capitis anterior': 'Recto anterior de la cabeza', 'rectus capitis lateralis': 'Recto lateral de la cabeza',
  'cervical rotator': 'Rotadores cervicales', 'thoracic rotator': 'Rotadores torácicos', 'lumbar rotator': 'Rotadores lumbares', 'interspinalis thoracis': 'Interespinosos torácicos',
  'set of interspinales cervicis': 'Interespinosos cervicales', 'set of interspinales lumborum': 'Interespinosos lumbares', 'lateral lumbar intertransversarius': 'Intertransversos lumbares laterales', 'medial lumbar intertransversarius': 'Intertransversos lumbares mediales',
  'set of anterior cervical intertransversarii': 'Intertransversos cervicales anteriores', 'set of posterior cervical intertransversarii': 'Intertransversos cervicales posteriores',
  'set of levatores costarum breves': 'Elevadores cortos de las costillas', 'set of levatores costarum longi': 'Elevadores largos de las costillas',
  'serratus posterior inferior': 'Serrato posterior inferior', 'serratus posterior superior': 'Serrato posterior superior',
  'omohyoid': 'Omohioideo', 'sternohyoid': 'Esternohioideo', 'sternothyroid': 'Esternotiroideo', 'thyrohyoid': 'Tirohioideo', 'digastric': 'Digástrico', 'mylohyoid': 'Milohioideo', 'geniohyoid': 'Genihioideo', 'stylohyoid': 'Estilohioideo',
  // tronco
  'external oblique': 'Oblicuo externo del abdomen', 'diaphragm': 'Diafragma', 'external intercostal muscle': 'Intercostales externos', 'internal intercostal muscle': 'Intercostales internos', 'innermost intercostal muscle': 'Intercostales íntimos',
  'transversus thoracis': 'Transverso del tórax', 'psoas major': 'Psoas mayor', 'iliacus': 'Ilíaco', 'linea alba': 'Línea alba', 'coccygeus': 'Coccígeo', 'iliococcygeus': 'Iliococcígeo', 'pubococcygeus': 'Pubococcígeo', 'puborectalis': 'Puborrectal',
  // cadera y muslo
  'gluteus maximus': 'Glúteo mayor', 'gluteus medius': 'Glúteo medio', 'gluteus minimus': 'Glúteo menor', 'tensor fasciae latae': 'Tensor de la fascia lata', 'iliotibial tract': 'Cintilla iliotibial',
  'piriformis': 'Piriforme', 'gemellus superior': 'Gémino superior', 'gemellus inferior': 'Gémino inferior', 'obturator internus': 'Obturador interno', 'obturator externus': 'Obturador externo', 'quadratus femoris': 'Cuadrado femoral',
  'sartorius': 'Sartorio', 'rectus femoris': 'Recto femoral', 'vastus lateralis': 'Vasto lateral', 'vastus medialis': 'Vasto medial', 'vastus intermedius': 'Vasto intermedio', 'gracilis': 'Grácil', 'pectineus': 'Pectíneo',
  'adductor longus': 'Aductor largo', 'adductor brevis': 'Aductor corto', 'adductor magnus': 'Aductor mayor', 'adductor minimus': 'Aductor mínimo',
  'long head of biceps femoris': 'Bíceps femoral (cabeza larga)', 'short head of biceps femoris': 'Bíceps femoral (cabeza corta)', 'semitendinosus': 'Semitendinoso', 'semimembranosus': 'Semimembranoso',
  // pierna y pie
  'popliteus': 'Poplíteo', 'lateral head of gastrocnemius': 'Gastrocnemio (cabeza lateral)', 'medial head of gastrocnemius': 'Gastrocnemio (cabeza medial)', 'soleus': 'Sóleo', 'plantaris': 'Plantar delgado', 'calcaneal tendon': 'Tendón de Aquiles',
  'tibialis anterior': 'Tibial anterior', 'tibialis posterior': 'Tibial posterior', 'extensor digitorum longus': 'Extensor largo de los dedos', 'extensor hallucis longus': 'Extensor largo del dedo gordo', 'extensor hallucis brevis': 'Extensor corto del dedo gordo',
  'fibularis longus': 'Peroneo largo', 'fibularis brevis': 'Peroneo corto', 'fibularis tertius': 'Tercer peroneo', 'flexor digitorum longus': 'Flexor largo de los dedos', 'flexor hallucis longus': 'Flexor largo del dedo gordo',
  'flexor digitorum brevis': 'Flexor corto de los dedos', 'abductor hallucis': 'Abductor del dedo gordo', 'abductor digiti minimi of foot': 'Abductor del quinto dedo', 'flexor digiti minimi brevis of foot': 'Flexor corto del quinto dedo',
  'opponens digiti minimi of foot': 'Oponente del quinto dedo', 'flexor accessorius': 'Cuadrado plantar', 'lateral head of flexor hallucis brevis': 'Flexor corto del dedo gordo (cabeza lateral)', 'medial head of flexor hallucis brevis': 'Flexor corto del dedo gordo (cabeza medial)',
  'oblique head of adductor hallucis': 'Aductor del dedo gordo (cabeza oblicua)', 'transverse head of adductor hallucis': 'Aductor del dedo gordo (cabeza transversa)', 'long plantar ligament': 'Ligamento plantar largo', 'interosseous membrane of leg': 'Membrana interósea de la pierna',
  // huesos
  'femur': 'Fémur', 'tibia': 'Tibia', 'fibula': 'Peroné', 'patella': 'Rótula', 'humerus': 'Húmero', 'radius': 'Radio', 'ulna': 'Cúbito', 'scapula': 'Escápula', 'clavicle': 'Clavícula', 'hip bone': 'Hueso coxal', 'sacrum': 'Sacro',
  'mandible': 'Mandíbula', 'maxilla': 'Maxilar', 'frontal bone': 'Hueso frontal', 'parietal bone': 'Hueso parietal', 'occipital bone': 'Hueso occipital', 'temporal bone': 'Hueso temporal', 'sphenoid bone': 'Esfenoides', 'ethmoid': 'Etmoides',
  'zygomatic bone': 'Hueso cigomático', 'nasal bone': 'Hueso nasal', 'lacrimal bone': 'Hueso lagrimal', 'palatine bone': 'Hueso palatino', 'vomer': 'Vómer', 'inferior nasal concha': 'Cornete nasal inferior', 'hyoid bone': 'Hioides',
  'calcaneus': 'Calcáneo', 'talus': 'Astrágalo', 'cuboid bone': 'Cuboides', 'navicular bone of foot': 'Navicular', 'medial cuneiform bone': 'Cuña medial', 'intermediate cuneiform bone': 'Cuña intermedia', 'lateral cuneiform bone': 'Cuña lateral', 'sesamoid bone of foot': 'Sesamoideo del pie',
  'scaphoid': 'Escafoides', 'lunate': 'Semilunar', 'triquetral': 'Piramidal', 'pisiform': 'Pisiforme', 'trapezium': 'Trapecio (carpo)', 'trapezoid': 'Trapezoide', 'capitate': 'Hueso grande', 'hamate': 'Ganchoso',
  'atlas': 'Atlas (C1)', 'axis': 'Axis (C2)', 'manubrium': 'Manubrio del esternón', 'body of sternum': 'Cuerpo del esternón', 'thyroid cartilage': 'Cartílago tiroides', 'cricoid cartilage': 'Cartílago cricoides',
};
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const DEDO = { thumb: 'pulgar', 'index finger': 'índice', 'middle finger': 'dedo medio', 'ring finger': 'anular', 'little finger': 'meñique', 'big toe': 'dedo gordo', 'second toe': '2.º dedo del pie', 'third toe': '3.er dedo del pie', 'fourth toe': '4.º dedo del pie', 'little toe': '5.º dedo del pie' };
function enEspanol(nombre) {
  let lado = '';
  let n = nombre.toLowerCase().replace(/\b(left|right)\b ?/, (_, l) => { lado = l === 'left' ? ' izq.' : ' der.'; return ''; }).replace(/\s+/g, ' ').trim();
  let m;
  if (ES[n]) return ES[n] + lado;
  if ((m = n.match(/^(\w+) rib$/)) && ORD[m[1]]) return `Costilla ${ORD[m[1]]}${lado}`;
  if ((m = n.match(/^(\w+) costal cartilage$/)) && ORD[m[1]]) return `Cartílago costal ${ORD[m[1]]}${lado}`;
  if ((m = n.match(/^(?:intervertebral disk of )?(\w+) (cervical|thoracic|lumbar) vertebra$/)) && ORD[m[1]]) {
    return `${n.startsWith('intervertebral') ? 'Disco intervertebral' : 'Vértebra'} ${{ cervical: 'C', thoracic: 'T', lumbar: 'L' }[m[2]]}${ORD[m[1]]}`;
  }
  if (/^intervertebral disk/.test(n)) return 'Disco intervertebral';
  if ((m = n.match(/^(proximal|middle|distal) phalanx of (.+)$/)) && DEDO[m[2]]) return `Falange ${{ proximal: 'proximal', middle: 'media', distal: 'distal' }[m[1]]} del ${DEDO[m[2]]}${lado}`;
  if ((m = n.match(/^(\w+) metacarpal bone$/)) && ORD[m[1]]) return `Metacarpiano ${ORD[m[1]]}${lado}`;
  if ((m = n.match(/^(\w+) metatarsal bone$/)) && ORD[m[1]]) return `Metatarsiano ${ORD[m[1]]}${lado}`;
  if (/tooth/.test(n)) return `Diente${lado}`;
  if ((m = n.match(/^(first|second|third|fourth) (lumbrical|plantar interosseous) of foot$/))) return `${m[2] === 'lumbrical' ? 'Lumbrical' : 'Interóseo plantar'} ${ORD[m[1]]} del pie${lado}`;
  return (n ? n[0].toUpperCase() + n.slice(1) : 'Estructura') + lado; // nombre anatómico original (latín / inglés)
}

// ───────────────────────── 2) Leer, simplificar y pasar a metros ─────────────────────────
/** OBJ → vértices soldados por posición (el original repite vértices), en milímetros, y triángulos. */
function leerObj(txt) {
  const vs = []; const mapa = new Map(); const remap = []; const ix = [];
  for (const l of txt.split('\n')) {
    if (l.charCodeAt(0) === 118 && l.charCodeAt(1) === 32) { // «v »
      const p = l.split(/\s+/); const x = +p[1], y = +p[2], z = +p[3];
      const k = `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)}`;
      let i = mapa.get(k);
      if (i === undefined) { i = vs.length / 3; mapa.set(k, i); vs.push(x, y, z); }
      remap.push(i);
    } else if (l.charCodeAt(0) === 102 && l.charCodeAt(1) === 32) { // «f »
      const p = l.trim().split(/\s+/).slice(1).map((t) => remap[parseInt(t, 10) - 1]);
      for (let i = 1; i + 1 < p.length; i++) if (p[0] !== p[i] && p[i] !== p[i + 1] && p[0] !== p[i + 1]) ix.push(p[0], p[i], p[i + 1]);
    }
  }
  return { vs, ix };
}
// La piel («Skin», FJ2810) marca el piso de los dos modelos: así quedan uno dentro del otro.
const PIEL = leerObj(readFileSync(resolve(OBJ, 'FJ2810.obj'), 'utf8'));
let PISO_MM = Infinity;
for (let i = 2; i < PIEL.vs.length; i += 3) PISO_MM = Math.min(PISO_MM, PIEL.vs[i]);
/** BodyParts3D (mm, z arriba, frente hacia −y) → metros con y arriba, +z al frente y los pies en y = 0. */
const aMetros = (x, y, z) => [x / 1000, (z - PISO_MM) / 1000, -y / 1000];
const RAZON = { m: 0.085, t: 0.1, h: 0.13, c: 0.12 };
const partes = []; // { nombre, en, tejido, lado, v0, nV }
const pos = []; const tris = []; const parteV = [];
let triFuente = 0;
for (const archivo of readdirSync(OBJ).sort()) {
  const e = archivo.replace(/\.obj$/, '');
  const txt = readFileSync(resolve(OBJ, archivo), 'utf8');
  const nombre = (txt.match(/^# English name : (.*)$/m)?.[1] ?? '').trim() || [...(conceptos.get(e) ?? [])].sort((a, b) => b.length - a.length)[0] || '';
  const tj = tejido(e, nombre);
  if (!tj) continue;
  const { vs, ix } = leerObj(txt);
  if (ix.length < 9) continue;
  triFuente += ix.length / 3;
  const objetivo = Math.max(48, Math.ceil((ix.length / 3) * RAZON[tj])) * 3;
  const [simple] = objetivo < ix.length ? MeshoptSimplifier.simplify(Uint32Array.from(ix), Float32Array.from(vs), 3, objetivo, 0.02) : [Uint32Array.from(ix)];
  // compactar y pasar a metros: BodyParts3D va en mm con z arriba y el frente hacia −y
  const nuevo = new Map(); const v0 = pos.length / 3;
  for (const i of simple) {
    if (!nuevo.has(i)) { nuevo.set(i, pos.length / 3); pos.push(...aMetros(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2])); parteV.push(partes.length); }
    tris.push(nuevo.get(i));
  }
  partes.push({ nombre: enEspanol(nombre), en: nombre.toLowerCase(), tejido: tj, v0, nV: pos.length / 3 - v0 });
}
const nV = pos.length / 3; const nT = tris.length / 3;
log(`${partes.length} piezas (${partes.filter((p) => p.tejido === 'm').length} músculos, ${partes.filter((p) => p.tejido === 'h').length} huesos): ${triFuente} → ${nT} triángulos, ${nV} vértices`);
const sinTraducir = [...new Set(partes.filter((p) => /^[A-Z][a-z]+ [a-z]/.test(p.nombre) && !Object.values(ES).some((v) => p.nombre.startsWith(v))).map((p) => p.nombre.replace(/ (izq|der)\.$/, '')))];
log(`nombres que quedan en latín/inglés: ${sinTraducir.length}`);

// ───────────────────────── 3) Normales (suaves, por pieza) ─────────────────────────
/** Normales suaves por vértice (ponderadas por el área de sus triángulos). */
function normales(pos, tris) {
  const nor = new Float64Array(pos.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const q of [a, b, c]) { nor[q] += nx; nor[q + 1] += ny; nor[q + 2] += nz; }
  }
  for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  return nor;
}
const nor = normales(pos, tris);
// ¿Hacia afuera? Se mira una pieza grande y convexa (el cráneo): sus normales deben alejarse de su centro.
{
  const p = partes.find((x) => x.en === 'frontal bone'); let s = 0; const c = [0, 0, 0];
  for (let v = p.v0; v < p.v0 + p.nV; v++) for (let k = 0; k < 3; k++) c[k] += pos[v * 3 + k] / p.nV;
  for (let v = p.v0; v < p.v0 + p.nV; v++) s += (pos[v * 3 + 2] - c[2]) * nor[v * 3 + 2];
  if (s < 0) { for (let i = 0; i < nor.length; i++) nor[i] = -nor[i]; for (let t = 0; t < tris.length; t += 3) { const x = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = x; } log('caras invertidas'); }
}

// ───────────────────────── 4) Oclusión ambiental ─────────────────────────
/** Oclusión ambiental por vértice (trazado de rayos sobre la propia malla): 1 = a plena luz. */
function hornear(pos, nor, tris, ALCANCE, RAYOS) {
  const nV = pos.length / 3, nT = tris.length / 3;
  const ao = new Float32Array(nV).fill(1);
  const CELDA = 0.02;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nV; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  for (let k = 0; k < 3; k++) { mn[k] -= 0.001; mx[k] += 0.001; }
  const dim = [0, 1, 2].map((k) => Math.ceil((mx[k] - mn[k]) / CELDA));
  const rej = new Map();
  const cel = (x, k) => Math.max(0, Math.min(dim[k] - 1, Math.floor((x - mn[k]) / CELDA)));
  for (let t = 0; t < nT; t++) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { const x = pos[tris[t * 3 + v] * 3 + k]; lo[k] = Math.min(lo[k], x); hi[k] = Math.max(hi[k], x); }
    for (let i = cel(lo[0], 0); i <= cel(hi[0], 0); i++) for (let j = cel(lo[1], 1); j <= cel(hi[1], 1); j++) for (let k = cel(lo[2], 2); k <= cel(hi[2], 2); k++) {
      const c = i + dim[0] * (j + dim[1] * k);
      if (!rej.has(c)) rej.set(c, []);
      rej.get(c).push(t);
    }
  }
  const inv = (d) => (Math.abs(d) < 1e-12 ? 1e12 : 1 / Math.abs(d));
  const rayo = (ox, oy, oz, dx, dy, dz) => {
    let i = cel(ox, 0), j = cel(oy, 1), k = cel(oz, 2);
    const si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
    const tdx = CELDA * inv(dx), tdy = CELDA * inv(dy), tdz = CELDA * inv(dz);
    let tx = (dx > 0 ? (i + 1) * CELDA + mn[0] - ox : ox - (i * CELDA + mn[0])) * inv(dx);
    let ty = (dy > 0 ? (j + 1) * CELDA + mn[1] - oy : oy - (j * CELDA + mn[1])) * inv(dy);
    let tz = (dz > 0 ? (k + 1) * CELDA + mn[2] - oz : oz - (k * CELDA + mn[2])) * inv(dz);
    for (;;) {
      const lista = rej.get(i + dim[0] * (j + dim[1] * k));
      const tSalida = Math.min(tx, ty, tz);
      if (lista) {
        let mejor = Infinity;
        for (const t of lista) {
          const a = tris[t * 3] * 3, b = tris[t * 3 + 1] * 3, c = tris[t * 3 + 2] * 3;
          const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
          const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-14) continue;
          const id = 1 / det; const sx = ox - pos[a], sy = oy - pos[a + 1], sz = oz - pos[a + 2];
          const u = (sx * px + sy * py + sz * pz) * id; if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const w = (dx * qx + dy * qy + dz * qz) * id; if (w < 0 || u + w > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
          if (tt > 1e-4 && tt < mejor) mejor = tt;
        }
        if (mejor <= tSalida + 1e-6) return mejor;
      }
      if (tSalida > ALCANCE) return Infinity;
      if (tx <= ty && tx <= tz) { i += si; tx += tdx; if (i < 0 || i >= dim[0]) return Infinity; }
      else if (ty <= tz) { j += sj; ty += tdy; if (j < 0 || j >= dim[1]) return Infinity; }
      else { k += sk; tz += tdz; if (k < 0 || k >= dim[2]) return Infinity; }
    }
  };
  const DIR = [];
  for (let r = 0; r < RAYOS; r++) { const u = (r + 0.5) / RAYOS; const rad = Math.sqrt(u); const ang = r * 2.399963; DIR.push([rad * Math.cos(ang), rad * Math.sin(ang), Math.sqrt(1 - u)]); }
  for (let v = 0; v < nV; v++) {
    const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
    let tx = Math.abs(nx) < 0.9 ? 1 : 0, ty = tx ? 0 : 1, tz = 0;
    const dn = tx * nx + ty * ny + tz * nz; tx -= dn * nx; ty -= dn * ny; tz -= dn * nz;
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const giro = ((v * 0.61803398875) % 1) * Math.PI * 2; const cg = Math.cos(giro), sg = Math.sin(giro);
    const ox = pos[v * 3] + nx * 0.002, oy = pos[v * 3 + 1] + ny * 0.002, oz = pos[v * 3 + 2] + nz * 0.002;
    let oc = 0;
    for (const [a0, b0, c] of DIR) {
      const a = a0 * cg - b0 * sg, b = a0 * sg + b0 * cg;
      const t = rayo(ox, oy, oz, tx * a + bx * b + nx * c, ty * a + by * b + ny * c, tz * a + bz * b + nz * c);
      if (t < ALCANCE) oc += 1 - t / ALCANCE;
    }
    ao[v] = 1 - oc / RAYOS;
  }
  // Suavizado dentro de cada pieza
  const vec = Array.from({ length: nV }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) { const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]]; vec[a].add(b).add(c); vec[b].add(a).add(c); vec[c].add(a).add(b); }
  for (let pasada = 0; pasada < 2; pasada++) {
    const s = new Float32Array(nV);
    for (let v = 0; v < nV; v++) { let x = ao[v] * 2; for (const o of vec[v]) x += ao[o]; s[v] = x / (2 + vec[v].size); }
    ao.set(s);
  }
  return ao;
}
const ao = hornear(pos, nor, tris, 0.16, 28);
log('músculos: oclusión horneada');

// ───────────────────────── 5) Zonas (las mismas para los dos modelos) ─────────────────────────
const ZONAS = ['cabeza', 'craneo_post', 'cuello', 'cervical', 'pecho', 'dorsal', 'abdomen', 'lumbar'];
for (const s of ['izq', 'der']) ZONAS.push(...['hombro', 'brazo_ant', 'brazo_post', 'codo', 'codo_post', 'antebrazo_ant', 'antebrazo_post', 'mano', 'cadera', 'gluteo', 'muslo_ant', 'muslo_post', 'rodilla', 'popliteo', 'pierna_ant', 'pantorrilla', 'tobillo', 'pie'].map((z) => `${z}_${s}`));
const IDX = new Map(ZONAS.map((z, i) => [z, i]));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mas = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mezcla = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const uni = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Centro de una pieza (por su nombre original), o de la parte de ella que cumpla `filtro(y, yMin, yMax)`. */
function centro(en, filtro) {
  const ps = partes.filter((p) => p.en === en);
  if (!ps.length) throw new Error(`No está la pieza «${en}»`);
  let yMin = Infinity, yMax = -Infinity;
  for (const p of ps) for (let v = p.v0; v < p.v0 + p.nV; v++) { yMin = Math.min(yMin, pos[v * 3 + 1]); yMax = Math.max(yMax, pos[v * 3 + 1]); }
  const c = [0, 0, 0]; let n = 0;
  for (const p of ps) for (let v = p.v0; v < p.v0 + p.nV; v++) {
    if (filtro && !filtro(pos[v * 3 + 1], yMin, yMax)) continue;
    c[0] += pos[v * 3]; c[1] += pos[v * 3 + 1]; c[2] += pos[v * 3 + 2]; n++;
  }
  return c.map((x) => x / n);
}
const arriba = (cm) => (y, _a, b) => y > b - cm / 100;
const abajo = (cm) => (y, a) => y < a + cm / 100;

function hueso(a, ra, b, rb, zona, frente = [0, 0, 1]) {
  const [za, zp] = typeof zona === 'string' ? [zona, zona] : zona;
  const ba = sub(b, a); const l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  const rr = ra - rb; const a2 = l2 - rr * rr; const il2 = l2 > 1e-12 ? 1 / l2 : 0;
  return {
    ant: IDX.get(za), post: IDX.get(zp), frente,
    eje: (x, y, z) => { const t = Math.max(0, Math.min(1, ((x - a[0]) * ba[0] + (y - a[1]) * ba[1] + (z - a[2]) * ba[2]) * il2)); return [a[0] + ba[0] * t, a[1] + ba[1] * t, a[2] + ba[2] * t]; },
    dist: (x, y, z) => {
      const px = x - a[0], py = y - a[1], pz = z - a[2];
      if (!il2) return Math.hypot(px, py, pz) - Math.max(ra, rb);
      const yy = px * ba[0] + py * ba[1] + pz * ba[2]; const zz = yy - l2;
      const qx = px * l2 - ba[0] * yy, qy = py * l2 - ba[1] * yy, qz = pz * l2 - ba[2] * yy;
      const x2 = qx * qx + qy * qy + qz * qz; const y2 = yy * yy * l2, z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
    },
  };
}
const zPelvis = (centro('left hip bone')[2] + centro('right hip bone')[2]) / 2;
function huesosLado(s) {
  const L = s === 'izq' ? 'left' : 'right'; const X = s === 'izq' ? 1 : -1;
  const hombro = centro(`${L} humerus`, arriba(4)), codo = centro(`${L} humerus`, abajo(3));
  const muneca = centro(`${L} lunate`), dedo = centro(`distal phalanx of ${L} middle finger`);
  const cadera = centro(`${L} femur`, arriba(4.5)), rodilla = centro(`${L} femur`, abajo(3));
  const tobillo = centro(`${L} talus`), punta = centro(`distal phalanx of ${L} third toe`);
  // Cara anterior del antebrazo = la de la palma (depende de cómo cuelga la mano en el modelo).
  const dAnte = uni(sub(muneca, codo));
  const palma = uni(cruz(sub(centro(`distal phalanx of ${L} little finger`), centro(`distal phalanx of ${L} thumb`)), dAnte).map((v) => v * X));
  let pliegue = mas(uni(sub(hombro, codo)), dAnte);
  pliegue = Math.hypot(...pliegue) < 0.5 ? [0, 0, 1] : uni(pliegue); // con el brazo estirado, el pliegue del codo mira al frente
  if (s === 'izq') log('palma izq. mira a', palma.map((v) => v.toFixed(2)).join(', '), '· pliegue del codo', pliegue.map((v) => v.toFixed(2)).join(', '));
  return [
    hueso(mas(hombro, [X * 0.012, 0, 0]), 0.066, mas(hombro, [X * 0.012, 0, 0]), 0.066, `hombro_${s}`),
    hueso(mezcla(hombro, codo, 0.3), 0.05, mezcla(hombro, codo, 0.8), 0.042, [`brazo_ant_${s}`, `brazo_post_${s}`]),
    hueso(codo, 0.058, codo, 0.058, [`codo_${s}`, `codo_post_${s}`], pliegue),
    hueso(mezcla(codo, muneca, 0.27), 0.042, mezcla(codo, muneca, 0.85), 0.03, [`antebrazo_ant_${s}`, `antebrazo_post_${s}`], palma),
    hueso(mezcla(codo, muneca, 1.04), 0.038, dedo, 0.045, `mano_${s}`),
    hueso([X * 0.03, cadera[1] + 0.055, zPelvis], 0.095, [X * 0.105, cadera[1] + 0.055, zPelvis], 0.095, [`cadera_${s}`, `gluteo_${s}`]),
    hueso([X * 0.085, cadera[1] + 0.02, zPelvis - 0.06], 0.09, [X * 0.085, cadera[1] + 0.02, zPelvis - 0.06], 0.09, `gluteo_${s}`),
    hueso(mezcla(cadera, rodilla, 0.14), 0.085, mezcla(cadera, rodilla, 0.84), 0.058, [`muslo_ant_${s}`, `muslo_post_${s}`]),
    hueso(rodilla, 0.076, rodilla, 0.076, [`rodilla_${s}`, `popliteo_${s}`]),
    hueso(mezcla(rodilla, tobillo, 0.17), 0.05, mezcla(rodilla, tobillo, 0.84), 0.034, [`pierna_ant_${s}`, `pantorrilla_${s}`]),
    hueso(mas(tobillo, [0, 0.01, 0]), 0.05, mas(tobillo, [0, 0.01, 0]), 0.05, `tobillo_${s}`),
    hueso([tobillo[0], 0.03, tobillo[2] - 0.03], 0.04, [punta[0], 0.02, punta[2]], 0.035, `pie_${s}`),
  ];
}
const craneo = mezcla(centro('frontal bone'), centro('occipital bone'), 0.5);
const menton = centro('mandible', abajo(1.5));
const c7 = centro('seventh cervical vertebra'), c1 = centro('atlas');
const t6 = centro('sixth thoracic vertebra'), l3 = centro('third lumbar vertebra'), esternon = centro('body of sternum');
const zPecho = (t6[2] + esternon[2]) / 2;
const H_CENTRO = [
  hueso(craneo, 0.1, craneo, 0.1, ['cabeza', 'craneo_post']),
  hueso(mas(craneo, [0, -0.02, 0.03]), 0.075, mas(menton, [0, 0.012, -0.045]), 0.05, 'cabeza'),
  hueso([0, c7[1] - 0.03, c7[2] + 0.05], 0.076, [0, c1[1] - 0.01, c1[2] + 0.03], 0.05, ['cuello', 'cervical']),
  hueso([-0.06, t6[1] + 0.01, zPecho], 0.13, [0.06, t6[1] + 0.01, zPecho], 0.13, ['pecho', 'dorsal']),
  hueso([-0.045, l3[1] + 0.02, l3[2] + 0.06], 0.1, [0.045, l3[1] + 0.02, l3[2] + 0.06], 0.1, ['abdomen', 'lumbar']),
];
const H_IZQ = huesosLado('izq'), H_DER = huesosLado('der');
/** Zona (índice en ZONAS) de un punto: la del «hueso» más cercano; por simetría solo compiten los de su lado y los del centro. */
function zonaDePunto(x, y, z) {
  let m = null, dm = Infinity;
  for (const h of H_CENTRO) { const d = h.dist(x, y, z); if (d < dm) { dm = d; m = h; } }
  for (const h of x >= 0 ? H_IZQ : H_DER) { const d = h.dist(x, y, z); if (d < dm) { dm = d; m = h; } }
  const e = m.eje(x, y, z);
  return (x - e[0]) * m.frente[0] + (y - e[1]) * m.frente[1] + (z - e[2]) * m.frente[2] >= 0 ? m.ant : m.post;
}
const zonaV = new Uint8Array(nV);
for (let v = 0; v < nV; v++) zonaV[v] = zonaDePunto(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
const sinPiel = ZONAS.filter((_, i) => !zonaV.includes(i));
if (sinPiel.length) console.warn('OJO: zonas sin ninguna pieza →', sinPiel.join(', '));

// ───────────────────────── 6) Binario «LBC1» + gzip ─────────────────────────
// Igual que la piel (más abajo), más: en el JSON `partes` [{ n: nombre, t: tejido }] y, al final, la pieza de cada vértice (Uint16).
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < pos.length; i++) { const k = i % 3; mn[k] = Math.min(mn[k], pos[i]); mx[k] = Math.max(mx[k], pos[i]); }
const tam = [0, 1, 2].map((k) => mx[k] - mn[k]);
const idx32 = nV > 65535;
const meta = Buffer.from(JSON.stringify({
  zonas: ZONAS, nV, nT, nL: 0, min: mn, tam, idx32, partes: partes.map((p) => ({ n: p.nombre, t: p.tejido })),
  credito: CREDITO,
}), 'utf8');
const relleno = (n) => Buffer.alloc((4 - (n % 4)) % 4);
const cuerpo = Buffer.concat([
  Buffer.from(Int16Array.from(pos, (x, i) => Math.round(((x - mn[i % 3]) / tam[i % 3]) * 65535) - 32768).buffer),
  Buffer.from(Int8Array.from(nor, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 127)).buffer),
  Buffer.from(Uint8Array.from(ao, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).buffer),
  Buffer.from(zonaV.buffer),
]);
const final = Buffer.concat([
  Buffer.from('LBC1'), Buffer.from(Uint32Array.of(meta.length).buffer), meta, relleno(meta.length),
  cuerpo, relleno(cuerpo.length),
  Buffer.from((idx32 ? Uint32Array.from(tris) : Uint16Array.from(tris)).buffer),
  Buffer.from(Uint16Array.from(parteV).buffer),
]);
const comprimido = gzipSync(final, { level: 9 });
writeFileSync(SALIDA, comprimido);
log(`escrito ${SALIDA}: ${(final.length / 1048576).toFixed(1)} MB → ${(comprimido.length / 1048576).toFixed(2)} MB comprimido · alto ${mx[1].toFixed(3)} m`);

// ════════════════════════════════════ PIEL ════════════════════════════════════
{
  // a) Mitad izquierda del paciente (x ≥ 0): los triángulos que cruzan el plano medio se recortan justo en x = 0.
  const V = PIEL.vs.slice();
  const dentro = (i) => V[i * 3] >= 0;
  const enPlano = new Map();
  const corte = (a, b) => {
    const k = a < b ? a * 1e7 + b : b * 1e7 + a;
    let n = enPlano.get(k);
    if (n === undefined) {
      const t = V[a * 3] / (V[a * 3] - V[b * 3]);
      n = V.length / 3;
      V.push(0, V[a * 3 + 1] + (V[b * 3 + 1] - V[a * 3 + 1]) * t, V[a * 3 + 2] + (V[b * 3 + 2] - V[a * 3 + 2]) * t);
      enPlano.set(k, n);
    }
    return n;
  };
  const mitad = [];
  for (let t = 0; t < PIEL.ix.length; t += 3) {
    const tri = [PIEL.ix[t], PIEL.ix[t + 1], PIEL.ix[t + 2]]; const d = tri.map(dentro);
    if (d[0] && d[1] && d[2]) { mitad.push(...tri); continue; }
    if (!d[0] && !d[1] && !d[2]) continue;
    const pol = [];
    for (let e = 0; e < 3; e++) { const a = tri[e], b = tri[(e + 1) % 3]; if (d[e]) pol.push(a); if (d[e] !== d[(e + 1) % 3]) pol.push(corte(a, b)); }
    for (let i = 1; i + 1 < pol.length; i++) mitad.push(pol[0], pol[i], pol[i + 1]);
  }
  // soldar (los cortes pueden coincidir con vértices que ya estaban en el plano) y quitar triángulos sin área
  const sv = []; const sold = new Map(); const de = new Int32Array(V.length / 3).fill(-1);
  const soldar = (i) => {
    if (de[i] >= 0) return de[i];
    const k = `${Math.round(V[i * 3] * 50)},${Math.round(V[i * 3 + 1] * 50)},${Math.round(V[i * 3 + 2] * 50)}`;
    let n = sold.get(k);
    if (n === undefined) { n = sv.length / 3; sold.set(k, n); sv.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); }
    return (de[i] = n);
  };
  const si = [];
  for (let t = 0; t < mitad.length; t += 3) { const a = soldar(mitad[t]), b = soldar(mitad[t + 1]), c = soldar(mitad[t + 2]); if (a !== b && b !== c && a !== c) si.push(a, b, c); }

  // b) Simplificar la mitad sin tocar su borde (la costura del plano medio): al reflejarla encaja exacta.
  const [simple] = MeshoptSimplifier.simplify(Uint32Array.from(si), Float32Array.from(sv), 3, 46000 * 3, 0.01, ['LockBorder']);

  // c) Reflejar: cuerpo simétrico. Los vértices de la costura (x = 0) se comparten.
  const P = []; const T = []; const idIzq = new Map(); const idDer = new Map(); const costura = [];
  const izq = (i) => { let n = idIzq.get(i); if (n === undefined) { n = P.length / 3; idIzq.set(i, n); P.push(...aMetros(sv[i * 3], sv[i * 3 + 1], sv[i * 3 + 2])); if (Math.abs(sv[i * 3]) < 0.01) { costura.push(n); idDer.set(i, n); } } return n; };
  const der = (i) => { izq(i); let n = idDer.get(i); if (n === undefined) { n = P.length / 3; idDer.set(i, n); const m = aMetros(sv[i * 3], sv[i * 3 + 1], sv[i * 3 + 2]); P.push(-m[0], m[1], m[2]); } return n; };
  for (let t = 0; t < simple.length; t += 3) {
    T.push(izq(simple[t]), izq(simple[t + 1]), izq(simple[t + 2]));
    T.push(der(simple[t]), der(simple[t + 2]), der(simple[t + 1])); // al reflejar se invierte el giro
  }
  const n0 = P.length / 3;
  // ¿hacia afuera? (volumen con signo positivo)
  {
    let vol = 0;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
    }
    if (vol < 0) { for (let t = 0; t < T.length; t += 3) { const x = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = x; } log('piel: caras invertidas'); }
  }

  // d) Cuerpo NEUTRO (el escaneo es de un hombre): la piel de la zona genital se tensa como una membrana sujeta por su
  //    borde, que es lo que deja un pubis liso de maniquí. Después se suaviza todo (Taubin: alisa el grano del escaneo sin
  //    encoger los dedos); la costura no se sale del plano medio.
  {
    const vec = Array.from({ length: n0 }, () => new Set());
    for (let t = 0; t < T.length; t += 3) { const [a, b, c] = [T[t], T[t + 1], T[t + 2]]; vec[a].add(b).add(c); vec[b].add(a).add(c); vec[c].add(a).add(b); }
    const zona = [];
    for (let v = 0; v < n0; v++) if (Math.abs(P[v * 3]) < 0.05 && P[v * 3 + 1] > 0.745 && P[v * 3 + 1] < 0.93 && P[v * 3 + 2] > zPelvis + 0.02) zona.push(v);
    for (let it = 0; it < 500; it++) {
      const nuevo = new Float64Array(zona.length * 3);
      zona.forEach((v, k) => {
        let x = 0, y = 0, z = 0; const n = vec[v].size;
        for (const o of vec[v]) { x += P[o * 3]; y += P[o * 3 + 1]; z += P[o * 3 + 2]; }
        nuevo[k * 3] = x / n; nuevo[k * 3 + 1] = y / n; nuevo[k * 3 + 2] = z / n;
      });
      zona.forEach((v, k) => { P[v * 3] = nuevo[k * 3]; P[v * 3 + 1] = nuevo[k * 3 + 1]; P[v * 3 + 2] = nuevo[k * 3 + 2]; });
    }
    log(`piel: zona genital alisada (${zona.length} vértices)`);
    const paso = (k) => {
      const N = new Float64Array(P.length);
      for (let v = 0; v < n0; v++) {
        let x = 0, y = 0, z = 0; const n = vec[v].size;
        for (const o of vec[v]) { x += P[o * 3]; y += P[o * 3 + 1]; z += P[o * 3 + 2]; }
        N[v * 3] = P[v * 3] + k * (x / n - P[v * 3]); N[v * 3 + 1] = P[v * 3 + 1] + k * (y / n - P[v * 3 + 1]); N[v * 3 + 2] = P[v * 3 + 2] + k * (z / n - P[v * 3 + 2]);
      }
      for (let i = 0; i < P.length; i++) P[i] = N[i];
    };
    for (let it = 0; it < 6; it++) { paso(0.5); paso(-0.53); }
    for (const v of costura) P[v * 3] = 0;
  }
  log(`piel: ${PIEL.ix.length / 3} → ${T.length / 3} triángulos, ${n0} vértices (simétrica)`);

  // e) Normales, sombreado y zonas
  const N = Array.from(normales(P, T));
  const A = Array.from(hornear(P, N, T, 0.3, 40));
  log('piel: oclusión horneada');
  const zona = new Array(n0);
  for (let v = 0; v < n0; v++) zona[v] = zonaDePunto(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);

  // f) Cortar por el borde de las zonas (bisección sobre cada arista que cambia de zona)
  const cruces = new Map();
  const combinar = (vs, ws) => {
    let x = 0, y = 0, z = 0, a = 0, b = 0, c = 0, o = 0;
    vs.forEach((q, i) => { const w = ws[i]; x += P[q * 3] * w; y += P[q * 3 + 1] * w; z += P[q * 3 + 2] * w; a += N[q * 3] * w; b += N[q * 3 + 1] * w; c += N[q * 3 + 2] * w; o += A[q] * w; });
    const l = Math.hypot(a, b, c) || 1;
    P.push(x, y, z); N.push(a / l, b / l, c / l); A.push(o);
    return P.length / 3 - 1;
  };
  const cruce = (a, b) => {
    const p = Math.min(a, b), q = Math.max(a, b); const k = p * n0 + q;
    if (cruces.has(k)) return cruces.get(k);
    let lo = 0, hi = 1;
    for (let it = 0; it < 8; it++) {
      const t = (lo + hi) / 2;
      if (zonaDePunto(P[p * 3] + (P[q * 3] - P[p * 3]) * t, P[p * 3 + 1] + (P[q * 3 + 1] - P[p * 3 + 1]) * t, P[p * 3 + 2] + (P[q * 3 + 2] - P[p * 3 + 2]) * t) === zona[p]) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2; const n = combinar([p, q], [1 - t, t]);
    cruces.set(k, n);
    return n;
  };
  const out = []; const outZona = []; const lin = [];
  const emitir = (a, b, c, z) => { out.push(a, b, c); outZona.push(z); };
  const linea = (a, b) => { for (const q of [a, b]) lin.push(P[q * 3] + N[q * 3] * 0.0007, P[q * 3 + 1] + N[q * 3 + 1] * 0.0007, P[q * 3 + 2] + N[q * 3 + 2] * 0.0007); };
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t], b = T[t + 1], c = T[t + 2]; const za = zona[a], zb = zona[b], zc = zona[c];
    if (za === zb && zb === zc) { emitir(a, b, c, za); continue; }
    if (za !== zb && zb !== zc && za !== zc) {
      const ab = cruce(a, b), bc = cruce(b, c), ca = cruce(c, a); const m = combinar([a, b, c], [1 / 3, 1 / 3, 1 / 3]);
      emitir(a, ab, m, za); emitir(a, m, ca, za); emitir(b, bc, m, zb); emitir(b, m, ab, zb); emitir(c, ca, m, zc); emitir(c, m, bc, zc);
      linea(ab, m); linea(bc, m); linea(ca, m);
      continue;
    }
    const [o, u, w] = za === zb ? [c, a, b] : zb === zc ? [a, b, c] : [b, c, a];
    const ou = cruce(o, u), ow = cruce(o, w);
    emitir(o, ou, ow, zona[o]); emitir(ou, u, w, zona[u]); emitir(ou, w, ow, zona[u]);
    linea(ou, ow);
  }
  // Un vértice de salida por cada (vértice, zona): el color va por vértice y cada zona tiene el suyo.
  const idSalida = new Map(); const sPos = [], sNor = [], sAo = [], sZona = [], sIdx = [];
  for (let t = 0; t < outZona.length; t++) for (let v = 0; v < 3; v++) {
    const q = out[t * 3 + v]; const k = q * 64 + outZona[t];
    let n = idSalida.get(k);
    if (n === undefined) { n = sZona.length; idSalida.set(k, n); sPos.push(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]); sNor.push(N[q * 3], N[q * 3 + 1], N[q * 3 + 2]); sAo.push(A[q]); sZona.push(outZona[t]); }
    sIdx.push(n);
  }
  const faltan = ZONAS.filter((_, i) => !sZona.includes(i));
  if (faltan.length) console.warn('OJO: zonas sin piel →', faltan.join(', '));

  // g) Binario «LBC1» (sin comprimir: es la capa que abre primero, también en navegadores sin DecompressionStream):
  // «LBC1» | u32 largo del JSON | JSON { zonas, nV, nT, nL, min, tam, idx32, credito } | relleno a 4 | pos Int16×3 | nor Int8×3 |
  // ao Uint8 | zona Uint8 | relleno a 4 | índices Uint16/Uint32 | líneas Int16×3 por punto
  const mnP = [1e9, 1e9, 1e9], mxP = [-1e9, -1e9, -1e9];
  for (const arr of [sPos, lin]) for (let i = 0; i < arr.length; i++) { const k = i % 3; mnP[k] = Math.min(mnP[k], arr[i]); mxP[k] = Math.max(mxP[k], arr[i]); }
  const tamP = [0, 1, 2].map((k) => mxP[k] - mnP[k]);
  const cuant = (arr) => Int16Array.from(arr, (x, i) => Math.round(((x - mnP[i % 3]) / tamP[i % 3]) * 65535) - 32768);
  const i32 = sZona.length > 65535;
  const metaP = Buffer.from(JSON.stringify({ zonas: ZONAS, nV: sZona.length, nT: outZona.length, nL: lin.length / 3, min: mnP, tam: tamP, idx32: i32, credito: CREDITO }), 'utf8');
  const cuerpoP = Buffer.concat([
    Buffer.from(cuant(sPos).buffer),
    Buffer.from(Int8Array.from(sNor, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 127)).buffer),
    Buffer.from(Uint8Array.from(sAo, (x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).buffer),
    Buffer.from(Uint8Array.from(sZona).buffer),
  ]);
  const finalP = Buffer.concat([
    Buffer.from('LBC1'), Buffer.from(Uint32Array.of(metaP.length).buffer), metaP, relleno(metaP.length),
    cuerpoP, relleno(cuerpoP.length),
    Buffer.from((i32 ? Uint32Array.from(sIdx) : Uint16Array.from(sIdx)).buffer),
    Buffer.from(cuant(lin).buffer),
  ]);
  writeFileSync(SALIDA_PIEL, finalP);
  log(`escrito ${SALIDA_PIEL}: ${sZona.length} vértices, ${outZona.length} triángulos, ${(finalP.length / 1048576).toFixed(2)} MB · alto ${mxP[1].toFixed(3)} m`);
}
