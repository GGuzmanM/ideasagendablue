/**
 * Interacciones (3.2) y contraindicaciones por condición del paciente (3.3) para el vademécum
 * curado de la clínica del pie. Tabla PEQUEÑA y explícita (sin base externa): se avisa antes de
 * emitir, no se bloquea (la decisión es del médico). Provisional hasta que el doctor la valide.
 *
 * Los fármacos se identifican por DCI normalizado (sin tildes, minúsculas) y por familia; los ítems
 * de la receta traen el nombre impreso (DCI) y, si vienen del vademécum, su vía y forma.
 */

export type NivelAviso = 'alto' | 'medio';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Familias: un ítem pertenece a una familia si su DCI contiene alguno de los términos.
export const FAMILIAS: Record<string, string[]> = {
  aine: ['ibuprofeno', 'naproxeno', 'diclofenaco', 'etoricoxib', 'ketoprofeno', 'meloxicam', 'celecoxib', 'aspirina', 'acido acetilsalicilico'],
  azol_sistemico: ['itraconazol', 'fluconazol', 'ketoconazol'],
  antifungico_oral: ['terbinafina', 'itraconazol', 'fluconazol', 'griseofulvina'],
  quinolona: ['ciprofloxacino', 'levofloxacino', 'moxifloxacino'],
  penicilina: ['amoxicilina', 'dicloxacilina', 'ampicilina', 'penicilina', 'oxacilina'],
  cefalosporina: ['cefalexina', 'cefadroxilo', 'cefuroxima', 'ceftriaxona'],
  corticoide_topico: ['betametasona', 'clobetasol', 'hidrocortisona', 'mometasona'],
  yodo: ['povidona yodada', 'yodopovidona', 'yodo'],
  anestesico_local: ['lidocaina', 'bupivacaina', 'mepivacaina'],
  paracetamol: ['paracetamol', 'acetaminofen'],
};

/** Familias a las que pertenece un DCI/nombre (puede ser más de una). */
export function familiasDe(nombre: string): string[] {
  const n = norm(nombre);
  return Object.entries(FAMILIAS).filter(([, terms]) => terms.some((t) => n.includes(t))).map(([f]) => f);
}
/** Las formas tópicas casi no se absorben: solo se avisa por vía oral/inyectable salvo que la regla diga lo contrario. */
export const esTopico = (via?: string | null, forma?: string | null) => /topic|cutan/.test(norm(via ?? '')) || /crema|gel|laca|unguento|spray|aplicador/.test(norm(forma ?? ''));

// ── Interacciones entre ítems de la MISMA receta ──────────────────────────────
// `a`/`b` son familias o DCI (el motor prueba ambas cosas). Solo vía sistémica salvo `incluyeTopico`.
export interface ReglaInteraccion { a: string; b: string; nivel: NivelAviso; texto: string; incluyeTopico?: boolean }
export const INTERACCIONES: ReglaInteraccion[] = [
  { a: 'aine', b: 'aine', nivel: 'alto', texto: 'Dos antiinflamatorios a la vez no suman efecto y duplican el riesgo de sangrado digestivo y daño renal.' },
  { a: 'aine', b: 'quinolona', nivel: 'medio', texto: 'AINE + ciprofloxacino aumenta el riesgo de convulsiones y de rotura de tendón (Aquiles).' },
  { a: 'azol_sistemico', b: 'quinolona', nivel: 'medio', texto: 'Azol + quinolona: ambos prolongan el QT (arritmias); evitar en cardiópatas o con otros fármacos que lo prolonguen.' },
  { a: 'azol_sistemico', b: 'etoricoxib', nivel: 'medio', texto: 'Los azoles suben los niveles de etoricoxib; usar la dosis más baja y por pocos días.' },
  { a: 'griseofulvina', b: 'paracetamol', nivel: 'medio', texto: 'Griseofulvina + paracetamol en dosis altas: mayor carga hepática; limitar a 3 g/día de paracetamol.' },
  { a: 'penicilina', b: 'cefalosporina', nivel: 'medio', texto: 'Dos betalactámicos a la vez: normalmente basta uno; revisar el esquema.' },
  { a: 'clindamicina', b: 'antifungico_oral', nivel: 'medio', texto: 'Clindamicina + antifúngico oral: ambos pueden dar molestias digestivas y afectar el hígado; vigilar tolerancia.' },
];

// ── Contraindicaciones / precauciones por condición del paciente ──────────────
// `condicion` = clave de bandera de la ficha previa (fichaPreviaService) o clave propia de este
// módulo (REGLAS_CONDICION). `farmacos` = familias o DCI.
export interface ReglaCondicion { condicion: string; etiqueta: string; farmacos: string[]; nivel: NivelAviso; texto: string; incluyeTopico?: boolean }
export const CONTRAINDICACIONES: ReglaCondicion[] = [
  { condicion: 'anticoagulado', etiqueta: 'Anticoagulado / antiagregado', farmacos: ['aine'], nivel: 'alto', texto: 'AINE en paciente anticoagulado: riesgo alto de sangrado. Preferir paracetamol.' },
  { condicion: 'anticoagulado', etiqueta: 'Anticoagulado / antiagregado', farmacos: ['azol_sistemico', 'griseofulvina', 'terbinafina'], nivel: 'alto', texto: 'Los antifúngicos orales alteran el efecto de la warfarina (INR): coordinar con quien lo controla.' },
  { condicion: 'renal', etiqueta: 'Enfermedad renal', farmacos: ['aine'], nivel: 'alto', texto: 'AINE con enfermedad renal: puede empeorar la función renal. Preferir paracetamol.' },
  { condicion: 'renal', etiqueta: 'Enfermedad renal', farmacos: ['quinolona', 'cefalosporina'], nivel: 'medio', texto: 'Ajustar la dosis del antibiótico a la función renal.' },
  { condicion: 'hepatico', etiqueta: 'Enfermedad del hígado', farmacos: ['antifungico_oral'], nivel: 'alto', texto: 'Antifúngico oral con enfermedad hepática: pedir transaminasas antes y durante el tratamiento, o preferir tratamiento tópico.' },
  { condicion: 'hepatico', etiqueta: 'Enfermedad del hígado', farmacos: ['paracetamol'], nivel: 'medio', texto: 'Paracetamol con enfermedad hepática: no pasar de 2 g al día.' },
  { condicion: 'cardiaco', etiqueta: 'Insuficiencia cardíaca / arritmia', farmacos: ['itraconazol'], nivel: 'alto', texto: 'Itraconazol está contraindicado en insuficiencia cardíaca (efecto inotrópico negativo).' },
  { condicion: 'cardiaco', etiqueta: 'Insuficiencia cardíaca / arritmia', farmacos: ['aine'], nivel: 'medio', texto: 'AINE en cardiópata: retención de líquidos y más riesgo cardiovascular; usar pocos días.' },
  { condicion: 'cardiaco', etiqueta: 'Insuficiencia cardíaca / arritmia', farmacos: ['anestesico_local'], nivel: 'medio', texto: 'Anestésico local en paciente con arritmia: dosis mínima, sin vasoconstrictor si no está indicado.', incluyeTopico: true },
  { condicion: 'hta', etiqueta: 'Hipertensión', farmacos: ['aine'], nivel: 'medio', texto: 'AINE sube la presión arterial y resta efecto a los antihipertensivos; pocos días y con control.' },
  { condicion: 'gastro', etiqueta: 'Gastritis o úlcera gástrica', farmacos: ['aine'], nivel: 'medio', texto: 'AINE con gastritis o úlcera: riesgo de sangrado. Preferir paracetamol o proteger el estómago.' },
  { condicion: 'diabetes', etiqueta: 'Diabetes', farmacos: ['quinolona'], nivel: 'medio', texto: 'Ciprofloxacino en diabético puede alterar la glucosa (hipo o hiperglucemia); avisar al paciente.' },
  { condicion: 'diabetes', etiqueta: 'Diabetes', farmacos: ['corticoide_topico'], nivel: 'medio', texto: 'Corticoide tópico en pie diabético: retrasa la cicatrización y enmascara infección; no usar sobre úlceras.', incluyeTopico: true },
  { condicion: 'embarazo', etiqueta: 'Embarazo', farmacos: ['azol_sistemico', 'griseofulvina', 'terbinafina'], nivel: 'alto', texto: 'Antifúngico oral en el embarazo: evitar (griseofulvina e itraconazol están contraindicados). Tratamiento tópico.' },
  { condicion: 'embarazo', etiqueta: 'Embarazo', farmacos: ['aine'], nivel: 'alto', texto: 'AINE en el embarazo: evitar, sobre todo desde la semana 20. Preferir paracetamol.' },
  { condicion: 'embarazo', etiqueta: 'Embarazo', farmacos: ['quinolona'], nivel: 'alto', texto: 'Quinolonas en el embarazo: evitar; preferir cefalexina o amoxicilina si no hay alergia.' },
  { condicion: 'embarazo', etiqueta: 'Embarazo', farmacos: ['yodo'], nivel: 'medio', texto: 'Povidona yodada en el embarazo: evitar el uso repetido en heridas grandes (tiroides del bebé).', incluyeTopico: true },
  { condicion: 'lactancia', etiqueta: 'Lactancia', farmacos: ['azol_sistemico', 'griseofulvina', 'quinolona'], nivel: 'medio', texto: 'Pasa a la leche: valorar suspender la lactancia o elegir otra opción.' },
  { condicion: 'tiroides', etiqueta: 'Enfermedad tiroidea', farmacos: ['yodo'], nivel: 'medio', texto: 'Povidona yodada repetida en paciente con tiroides: puede alterar la función tiroidea; preferir clorhexidina.', incluyeTopico: true },
  { condicion: 'epilepsia', etiqueta: 'Epilepsia', farmacos: ['quinolona'], nivel: 'medio', texto: 'Ciprofloxacino baja el umbral convulsivo; preferir otro antibiótico.' },
  { condicion: 'ulcera', etiqueta: 'Úlcera en el pie', farmacos: ['corticoide_topico'], nivel: 'medio', texto: 'Corticoide tópico sobre o junto a una úlcera: retrasa la cicatrización.', incluyeTopico: true },
  { condicion: 'eap', etiqueta: 'Enfermedad arterial periférica', farmacos: ['anestesico_local'], nivel: 'medio', texto: 'Bloqueo digital en pie con mala circulación: sin vasoconstrictor y con el mínimo volumen.', incluyeTopico: true },
];

// Condiciones que la ficha previa NO levanta como bandera pero importan al recetar: se buscan en el
// texto de los antecedentes activos del paciente (normalizado, sin tildes).
export const REGLAS_CONDICION: { re: RegExp; clave: string }[] = [
  { re: /embaraz|gestante|gestacion/, clave: 'embarazo' },
  { re: /lactancia|lactando|amamant/, clave: 'lactancia' },
  { re: /hepat|cirrosis|higado/, clave: 'hepatico' },
  { re: /insuficiencia cardiaca|arritmia|fibrilacion|marcapasos|cardiopat/, clave: 'cardiaco' },
  { re: /gastritis|ulcera gastrica|ulcera peptica|reflujo|hemorragia digestiva/, clave: 'gastro' },
  { re: /tiroid|hipotiroid|hipertiroid/, clave: 'tiroides' },
  { re: /epilep|convuls/, clave: 'epilepsia' },
];

// Alergias por familia: «penicilina» también avisa con amoxicilina y dicloxacilina, «AINE» con
// todos los antiinflamatorios, «yodo» con la povidona yodada, etc. (el cruce por texto no lo ve).
export const ALERGIA_FAMILIAS: { re: RegExp; familia: string; nota?: string }[] = [
  { re: /penicilin|amoxicil|ampicil|betalactam/, familia: 'penicilina' },
  { re: /penicilin|betalactam/, familia: 'cefalosporina', nota: 'reacción cruzada posible (cefalosporina)' },
  { re: /\baine|antiinflamator|ibuprofen|naproxen|diclofenac|aspirin|acetilsalic/, familia: 'aine' },
  { re: /\byodo|povidona|iodo/, familia: 'yodo' },
  { re: /lidocain|anestesic|xilocain/, familia: 'anestesico_local' },
  { re: /azol|fluconazol|itraconazol|ketoconazol/, familia: 'azol_sistemico' },
];

export interface ItemReceta { nombre: string; marcaImpresa?: string | null; via?: string | null; formaFarmaceutica?: string | null }
export interface AvisoInteraccion { itemA: string; itemB: string; nivel: NivelAviso; texto: string }
export interface AvisoContraindicacion { item: string; condicion: string; nivel: NivelAviso; texto: string }

const coincide = (item: ItemReceta, clave: string) => familiasDe(item.nombre).includes(clave) || norm(item.nombre).includes(norm(clave));
const aplica = (item: ItemReceta, incluyeTopico?: boolean) => incluyeTopico || !esTopico(item.via, item.formaFarmaceutica);

/** Interacciones entre los ítems de una misma receta (cada par se avisa una vez por regla). */
export function interaccionesEntre(items: ItemReceta[]): AvisoInteraccion[] {
  const out: AvisoInteraccion[] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i]!, b = items[j]!;
    for (const r of INTERACCIONES) {
      if (!aplica(a, r.incluyeTopico) || !aplica(b, r.incluyeTopico)) continue;
      const directo = coincide(a, r.a) && coincide(b, r.b), inverso = coincide(a, r.b) && coincide(b, r.a);
      if (!directo && !inverso) continue;
      // Misma familia (AINE + AINE) solo si son dos fármacos distintos (no la misma tableta repetida).
      if (r.a === r.b && norm(a.nombre) === norm(b.nombre)) continue;
      out.push({ itemA: a.nombre, itemB: b.nombre, nivel: r.nivel, texto: r.texto });
    }
  }
  return out;
}

/** Contraindicaciones de cada ítem frente a las condiciones (claves) del paciente. */
export function contraindicacionesPara(items: ItemReceta[], condiciones: Set<string>): AvisoContraindicacion[] {
  const out: AvisoContraindicacion[] = [];
  for (const it of items) for (const r of CONTRAINDICACIONES) {
    if (!condiciones.has(r.condicion) || !aplica(it, r.incluyeTopico)) continue;
    if (!r.farmacos.some((f) => coincide(it, f))) continue;
    out.push({ item: it.nombre, condicion: r.etiqueta, nivel: r.nivel, texto: r.texto });
  }
  return out;
}

/** Claves de condición a partir de los antecedentes activos (texto libre), para sumar a las banderas. */
export function condicionesDeAntecedentes(antecedentes: { tipo: string; descripcion: string }[]): Set<string> {
  const out = new Set<string>();
  for (const a of antecedentes) {
    if (a.tipo === 'familiar') continue;
    const t = norm(a.descripcion);
    if (/^(no |niega|sin |nunca )/.test(t)) continue;
    for (const r of REGLAS_CONDICION) if (r.re.test(t)) out.add(r.clave);
  }
  return out;
}
