// Escalas del pie: índice tobillo-brazo con pulsos (2.4), OSI de onicomicosis (2.6), Manchester de
// hallux valgus (2.7) y examen del pie estructurado (1.5: piel, uñas, deformidades y calzado, con la
// guía de desgaste de la suela). Cálculos PUROS: la vista muestra el resultado en vivo y el backend
// (bloque3Service.calcularResultadoEscala) aplica la misma regla al guardar.

export type EstadoPulso = 'presente' | 'disminuido' | 'ausente';
export const PULSO_LABEL: Record<EstadoPulso, string> = { presente: 'Presente', disminuido: 'Disminuido', ausente: 'Ausente' };

// ── 2.4 · Índice tobillo-brazo (presiones sistólicas en mmHg) ──
export interface CamposItb { braqIzq: string; braqDer: string; pediaIzq: string; tibialIzq: string; pediaDer: string; tibialDer: string }
export const ITB_VACIO: CamposItb = { braqIzq: '', braqDer: '', pediaIzq: '', tibialIzq: '', pediaDer: '', tibialDer: '' };
export interface PulsosPie { pedioIzq: EstadoPulso | ''; tibialIzq: EstadoPulso | ''; pedioDer: EstadoPulso | ''; tibialDer: EstadoPulso | '' }
export const PULSOS_VACIOS: PulsosPie = { pedioIzq: '', tibialIzq: '', pedioDer: '', tibialDer: '' };

/** Presión escrita → número positivo o null. */
export function numOrNull(v: string | number | null | undefined): number | null {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** ITB de un pie = mayor presión del tobillo (pedia o tibial posterior) ÷ mayor presión braquial (2 decimales). */
export function itbPie(pedia: number | null, tibial: number | null, braqIzq: number | null, braqDer: number | null): number | null {
  const tobillo = Math.max(pedia ?? 0, tibial ?? 0);
  const brazo = Math.max(braqIzq ?? 0, braqDer ?? 0);
  return tobillo && brazo ? Math.round((tobillo / brazo) * 100) / 100 : null;
}

export type NivelItb = 'normal' | 'limite' | 'leve' | 'moderada' | 'grave' | 'no_compresible';
/** Lectura del ITB (AHA/ACC 2016). Mismos textos que el servidor (bloque3Service.textoItb). */
export function interpretarItb(v: number): { nivel: NivelItb; texto: string } {
  if (v > 1.4) return { nivel: 'no_compresible', texto: 'no compresible (arterias rígidas): no descarta mala circulación' };
  if (v >= 1) return { nivel: 'normal', texto: 'normal' };
  if (v >= 0.91) return { nivel: 'limite', texto: 'limítrofe' };
  if (v >= 0.7) return { nivel: 'leve', texto: 'mala circulación leve (EAP)' };
  if (v >= 0.4) return { nivel: 'moderada', texto: 'mala circulación moderada (EAP)' };
  return { nivel: 'grave', texto: 'mala circulación grave (EAP), posible isquemia crítica' };
}

/** EAP sugerida por una medición guardada: ITB ≤ 0,90 en algún pie o algún pulso ausente. */
export function eapDeItb(datos: Record<string, unknown>): boolean {
  const itbs = [datos.itbIzq, datos.itbDer].filter((v): v is number => typeof v === 'number');
  const pulsos = datos.pulsos && typeof datos.pulsos === 'object' ? Object.values(datos.pulsos as Record<string, unknown>) : [];
  return itbs.some((v) => v <= 0.9) || pulsos.includes('ausente');
}

// ── 2.6 · OSI (Onychomycosis Severity Index, Carney 2011) ──
export const OSI_UNAS: { id: string; label: string }[] = [
  { id: 'hallux', label: 'Hallux (1er dedo)' }, { id: '2', label: '2º dedo' }, { id: '3', label: '3er dedo' }, { id: '4', label: '4º dedo' }, { id: '5', label: '5º dedo' },
];
/** Área de la uña afectada: el índice es el puntaje (0–5). */
export const OSI_AREA = ['0 %', '1–10 %', '11–25 %', '26–50 %', '51–75 %', '76–100 %'];
/** Cercanía a la matriz: la clave es el puntaje (1–5). */
export const OSI_PROXIMIDAD: Record<number, string> = { 1: 'Menos de 1/4', 2: '1/4 a 1/2', 3: '1/2 a 3/4', 4: 'Más de 3/4', 5: 'Llega a la matriz' };

/** Área × proximidad, +10 si hay dermatofitoma o hiperqueratosis subungueal > 2 mm. 0–35. */
export function puntajeOsi(area: number, proximidad: number, dermatofitoma: boolean, hiperqueratosis: boolean): number {
  if (!area) return 0;
  return area * proximidad + (dermatofitoma || hiperqueratosis ? 10 : 0);
}
export function severidadOsi(p: number): { texto: string; nivel: 'nula' | 'leve' | 'moderada' | 'grave' } {
  if (p === 0) return { texto: 'Sin compromiso', nivel: 'nula' };
  if (p <= 5) return { texto: 'Leve', nivel: 'leve' };
  if (p <= 15) return { texto: 'Moderada', nivel: 'moderada' };
  return { texto: 'Grave', nivel: 'grave' };
}

// ── 2.7 · Manchester (hallux valgus): grado por pie según las fotos de referencia ──
export const MANCHESTER: { grado: 1 | 2 | 3 | 4; label: string; angulo: number }[] = [
  { grado: 1, label: 'Sin deformidad', angulo: 4 },
  { grado: 2, label: 'Leve', angulo: 18 },
  { grado: 3, label: 'Moderada', angulo: 32 },
  { grado: 4, label: 'Grave', angulo: 48 },
];
/** Hallux valgus moderado o grave cuenta como deformidad para el IWGDF. */
export const manchesterSugiereDeformidad = (d: Record<string, unknown>) => [d.izquierdo, d.derecho].some((g) => typeof g === 'number' && g >= 3);

// ── 1.5 · Examen del pie estructurado ──
export type GrupoExamen = 'piel' | 'unas' | 'deformidades';
export const GRUPOS_EXAMEN: { id: GrupoExamen; titulo: string; icono: string; items: [string, string][] }[] = [
  { id: 'piel', titulo: 'Piel', icono: 'dermatology', items: [
    ['seca', 'Piel seca (xerosis)'], ['fisuras', 'Fisuras / grietas'], ['hiperqueratosis', 'Hiperqueratosis'], ['maceracion', 'Maceración interdigital'],
    ['eritema', 'Eritema / enrojecimiento'], ['palidez', 'Palidez o cianosis'], ['edema', 'Edema'], ['infeccion', 'Signos de infección'],
    ['sin_vello', 'Piel trófica (sin vello, brillante)'],
  ] },
  { id: 'unas', titulo: 'Uñas', icono: 'back_hand', items: [
    ['engrosadas', 'Engrosadas'], ['micosis', 'Aspecto de onicomicosis'], ['encarnada', 'Uñero (onicocriptosis)'], ['onicogrifosis', 'Onicogrifosis'],
    ['distrofia', 'Distrofia / estrías'], ['color', 'Cambio de color'], ['hematoma', 'Hematoma subungueal'], ['corte', 'Corte inadecuado'],
  ] },
  { id: 'deformidades', titulo: 'Deformidades', icono: 'footprint', items: [
    ['hallux_valgus', 'Hallux valgus (juanete)'], ['garra', 'Dedos en garra'], ['martillo', 'Dedos en martillo'], ['sastre', 'Juanete de sastre (5º dedo)'],
    ['hallux_rigidus', 'Hallux rigidus'], ['plano', 'Pie plano'], ['cavo', 'Pie cavo'], ['prominencias', 'Prominencias óseas (cabezas metatarsales)'],
    ['charcot', 'Pie de Charcot'], ['amputacion', 'Amputación parcial'],
  ] },
];
export type LadoHallazgo = 'izquierdo' | 'derecho' | 'ambos';
export const combinarLado = (izq: boolean, der: boolean): LadoHallazgo | null => (izq && der ? 'ambos' : izq ? 'izquierdo' : der ? 'derecho' : null);
/** Algún hallazgo del grupo Deformidades cuenta como deformidad para el IWGDF. */
export const examenSugiereDeformidad = (d: Record<string, unknown>) =>
  !!d.hallazgos && typeof d.hallazgos === 'object' && Object.keys(d.hallazgos as object).some((k) => k.startsWith('deformidades.'));

export const CALZADO_TIPOS: [string, string][] = [
  ['deportivo', 'Deportivo'], ['vestir', 'De vestir'], ['sandalia', 'Sandalia / abierto'], ['seguridad', 'De seguridad'], ['ortopedico', 'Ortopédico / terapéutico'], ['otro', 'Otro'],
];
export const CALZADO_PROBLEMAS: [string, string][] = [
  ['punta_estrecha', 'Punta estrecha'], ['tacon', 'Tacón alto'], ['talla', 'Talla incorrecta'], ['costuras', 'Costuras o relieves internos'],
  ['sin_sujecion', 'Sin sujeción (abierto, sin cordones)'], ['gastado', 'Muy gastado'], ['suela', 'Suela rígida o muy delgada'],
];
export type ZonaDesgaste = 'punta' | 'antepie_int' | 'antepie_ext' | 'talon_int' | 'talon_ext';
export const ZONAS_DESGASTE: [ZonaDesgaste, string][] = [
  ['punta', 'Punta'], ['antepie_int', 'Antepié interno'], ['antepie_ext', 'Antepié externo'], ['talon_int', 'Talón interno'], ['talon_ext', 'Talón externo'],
];
export interface CalzadoForm { adecuado: boolean | null; tipo: string; problemas: string[]; plantillas: boolean | null; desgasteIzq: ZonaDesgaste[]; desgasteDer: ZonaDesgaste[] }
export const CALZADO_VACIO: CalzadoForm = { adecuado: null, tipo: '', problemas: [], plantillas: null, desgasteIzq: [], desgasteDer: [] };

/** Guía de desgaste de la suela: qué sugiere el patrón (lo confirma el médico). */
export function lecturaDesgaste(zonas: string[]): string | null {
  const s = new Set(zonas);
  const out: string[] = [];
  if (s.has('talon_int') || s.has('antepie_int')) out.push('sugiere pronación');
  else if (s.has('antepie_ext')) out.push('sugiere supinación');
  else if (s.has('talon_ext')) out.push('patrón habitual (apoyo por el talón externo)');
  if (s.has('punta')) out.push('arrastre de la punta (calzado corto o marcha en equino)');
  return out.length ? out.join('; ') : null;
}
