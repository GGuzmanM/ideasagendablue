/**
 * Sincroniza CompetenciaProfesional (qué tratamiento sabe hacer cada profesional)
 * desde la matriz "Colaborador × Tratamiento" pegada en MATRIZ_TSV más abajo.
 *
 * DRY-RUN por defecto: solo imprime el plan, no escribe nada. Pasa --aplicar
 * para ejecutar.
 *
 * Reglas:
 *  - El matching de servicio es por CÓDIGO (columna `codigo`, estable), no por
 *    nombre — así que si en esta máquina "PROFILAXIS" ya se renombró a otra
 *    cosa ("Limpieza clínica del pie", etc.), el script igual la encuentra.
 *    Si además cambió el CÓDIGO, hay que ajustar COLUMNA_A_CODIGOS más abajo
 *    (el script lista los códigos que no encuentre, para corregir rápido).
 *  - Por defecto SOLO agrega/reactiva competencias marcadas VERDADERO. Nunca
 *    desactiva una existente aunque la celda diga FALSO (evita romper algo que
 *    no está en esta matriz). Para además desactivar las FALSO, usa
 *    --sincronizar-falsos (revisa el plan impreso en dry-run antes de aplicar).
 *  - Fisioterapeutas: se les asigna automáticamente TODO servicio activo de la
 *    unidad "Fisioterapia" (la matriz no las cubre, saben hacer todos).
 *  - Médicos reales de Baropodometría (no los "equipo" tipo Baro 1/Baro 2, que
 *    son máquinas, no personas): se les asigna automáticamente todo servicio
 *    de la unidad "Baropodometría".
 *  - Profesional o columna que no se encuentre en la BD → se reporta como
 *    advertencia y se SALTA (no aborta el resto), salvo --estricto.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/importar-competencias.ts                              # dry-run
 *   npx ts-node --transpile-only scripts/importar-competencias.ts --aplicar                     # aplica (solo agrega/reactiva)
 *   npx ts-node --transpile-only scripts/importar-competencias.ts --aplicar --sincronizar-falsos # aplica y además desactiva las FALSO
 *   npx ts-node --transpile-only scripts/importar-competencias.ts --estricto                     # aborta si algo no matchea
 */
import '../src/cargarEnv'; // respeta ENV_FILE: sin esto SIEMPRE escribía en la base de .env (la real), aun queriendo probar en la copia
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── 1. Columna de la hoja → código(s) de Servicio en la BD ───────────────────
// Una columna puede mapear a VARIOS servicios (ej. la curación combinada).
const COLUMNA_A_CODIGOS: Record<string, string[]> = {
  'PROFILAXIS': ['POD-01'],
  'PROFILAXIS INFANTIL': ['POD-02'],
  'PROFILAXIS DE MANO': ['POD-03'],
  'LASER PARA HONGOS': ['POD-04'],
  'LASER DE ALTA: HONGOS': ['POD-05'],
  'LASERTERAPIA - FISIOTERAPIA': ['POD-06'],
  'EVALUACION DE PODOLOGÍA': ['POD-07'],
  'EXTRACCION DE UÑERO': ['POD-08'],
  'EXTRACCION DE UÑA': ['POD-09'],
  'EXTRACCION DE NUCLEO': ['POD-10'],
  'MATRISECTOMIA': ['POD-11'],
  'ORTONIXIAS': ['POD-12'],
  'CURACION DE HERIDAS': ['POD-13'], // en BD: "CURACION DE HERIDAS (PIE DIABETICO)"
  'CURACION: DE EXTRACCION DE UÑA, DE UÑERO, MATRISECTOMIA': ['POD-14', 'POD-22', 'POD-23'],
  'APLICACION ACIDO NITRICO ONICOMICOSIS': ['POD-15'],
  'APLICAC ACIDO NITRICO VPH': ['POD-16'],
  'ORTESICOS': ['POD-17'],
  'INFILTRACION: CALLOS': ['POD-18'],
  'APLICACIÓN DE BLEOMICINA - VPH': ['POD-19'],
};

// ─── 2. Matriz pegada tal cual de la hoja de cálculo (TSV) ────────────────────
const MATRIZ_TSV = `
Colaborador - Nombre Completo\tTrabajo - Cargo\tSEDE\tPROFILAXIS\tPROFILAXIS INFANTIL\tPROFILAXIS DE MANO\tLASER PARA HONGOS\tLASER DE ALTA: HONGOS\tLASERTERAPIA - FISIOTERAPIA\tEVALUACION DE PODOLOGÍA\tEXTRACCION DE UÑERO\tEXTRACCION DE UÑA\tEXTRACCION DE NUCLEO\tMATRISECTOMIA\tORTONIXIAS\tCURACION DE HERIDAS\tCURACION: DE EXTRACCION DE UÑA, DE UÑERO, MATRISECTOMIA\tAPLICACION ACIDO NITRICO ONICOMICOSIS\tAPLICAC ACIDO NITRICO VPH\tORTESICOS\tINFILTRACION: CALLOS\tAPLICACIÓN DE BLEOMICINA - VPH
Auris Asca Ivonne Jill\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO
Chamorro Meza Yeccijca Rosario\tPodólogo\tLINCE\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO
Chavez Ocampo Lesly Selenne\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO
Culquicondor Franco Carmen Ines\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Pacco Gutierrez Tania Cleofe\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Pisco Panduro Martha Ybelice\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Rios Peñaherrera Fiorella\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Zambrano Cuevas Milagros Maria\tPodólogo\tLINCE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Chavez Vasquez Mirtha\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO
Escalante Mendoza Laura Kelly\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO
Morote Carmona Gissela Victoria\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO
Saavedra Carbajal Erika Maria\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tVERDADERO
Saldaña Mostacero Luz Haydee\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Tejada Bazan Sonia Marlene\tPodólogo\tLOS OLIVOS\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Chamorro Pacheco Erika Shabell\tPodólogo\tONE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO
Daniel Doy\tPodólogo\tONE\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO
Diaz Vergara Sarai Abigail\tPodólogo\tONE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tVERDADERO
Yasica Doy\tPodólogo\tONE\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Bouisson Carbajal Fiorella Estephany\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Castro Valdez Carla Cynthia\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO
Chiclla Suehara Jenny Rosario\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Flores Paredes Milagros Mercedes\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
MALASQUEZ BERROCAL DASSNE YULEYSI\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO
Noteno Jacinto Nelly Juana\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO
Paredes Salinas Glenda Milagritos\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
Puerta Ramos Vanessa Elizabeth\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO\tFALSO
Salinas Ubillus Hayde Milagros\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tVERDADERO
Sosa Baquerizo Mayra Estephany\tPodólogo\tPAZ SOLDAN\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tVERDADERO
Gutierrez Ñahuis Maximina\tPodólogo\tSAN MIGUEL\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Marquina Vasquez Doris Vicenta\tPodólogo\tSAN MIGUEL\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tVERDADERO\tFALSO
Rodriguez Haro Raysa Alessandra\tPodólogo\tSAN MIGUEL\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO
Taya Huallpacuna Angelica Isabel\tPodólogo\tSAN MIGUEL\tVERDADERO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tFALSO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tVERDADERO
Valencia Chiuyare Miluska Isabel\tPodólogo\tSAN MIGUEL\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO\tVERDADERO\tVERDADERO\tVERDADERO\tVERDADERO\tFALSO\tFALSO\tFALSO\tFALSO
`.trim();

// ─── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const SINCRONIZAR_FALSOS = argv.includes('--sincronizar-falsos');
const ESTRICTO = argv.includes('--estricto');

// ─── Normalización de nombres (insensible a orden/mayúsculas/tildes) ─────────
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}
function claveNombre(...partes: string[]): string {
  return normalizar(partes.join(' '))
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

interface FilaMatriz {
  nombreCompleto: string;
  sede: string;
  marcas: Record<string, boolean>; // columna de la hoja -> VERDADERO/FALSO
}

function parsearMatriz(tsv: string): FilaMatriz[] {
  const lineas = tsv.split('\n').map((l) => l.trimEnd());
  const encabezado = lineas[0].split('\t').map((h) => h.trim());
  const columnasTratamiento = encabezado.slice(3); // tras Nombre, Cargo, SEDE

  return lineas.slice(1).filter(Boolean).map((linea) => {
    const celdas = linea.split('\t').map((c) => c.trim());
    const [nombreCompleto, , sede] = celdas;
    const valores = celdas.slice(3);
    const marcas: Record<string, boolean> = {};
    columnasTratamiento.forEach((col, i) => {
      marcas[col] = valores[i] === 'VERDADERO';
    });
    return { nombreCompleto, sede, marcas };
  });
}

async function main() {
  console.log(`Modo: ${APLICAR ? 'APLICAR (escribe en la BD)' : 'DRY-RUN (solo muestra el plan)'}`);
  if (APLICAR && SINCRONIZAR_FALSOS) {
    console.log('⚠️  --sincronizar-falsos activo: también DESACTIVARÁ competencias marcadas FALSO.');
  }

  // ── Cargar catálogo de servicios y resolver códigos de la matriz ───────────
  // select explícito: evita depender de columnas ajenas a esta tarea (ej. el
  // campo `colegiatura`, que en algunas BD locales quedó sin migración).
  const servicios = await prisma.servicio.findMany({
    where: { deletedAt: null },
    select: { id: true, codigo: true, nombre: true, activo: true, unidadNegocioId: true },
  });
  const porCodigo = new Map(servicios.map((s) => [s.codigo, s]));

  const codigosFaltantes = new Set<string>();
  for (const codigos of Object.values(COLUMNA_A_CODIGOS)) {
    for (const c of codigos) if (!porCodigo.has(c)) codigosFaltantes.add(c);
  }
  if (codigosFaltantes.size > 0) {
    console.error(`\n❌ Códigos de servicio no encontrados en esta BD: ${[...codigosFaltantes].join(', ')}`);
    console.error('   Servicios disponibles (código → nombre):');
    servicios.forEach((s) => console.error(`     ${s.codigo} → ${s.nombre}`));
    if (ESTRICTO) process.exit(1);
  }

  // ── Cargar profesionales y armar índice por nombre normalizado ─────────────
  const profesionales = await prisma.profesional.findMany({
    where: { deletedAt: null },
    select: { id: true, nombres: true, apellidos: true, tipo: true, esEquipo: true },
  });
  const porNombre = new Map(profesionales.map((p) => [claveNombre(p.apellidos, p.nombres), p]));

  // ── Cargar competencias existentes (para saber qué ya está activo) ─────────
  const competenciasExistentes = await prisma.competenciaProfesional.findMany({
    select: { profesionalId: true, servicioId: true, activa: true },
  });
  const existente = new Map(
    competenciasExistentes.map((c) => [`${c.profesionalId}:${c.servicioId}`, c])
  );

  type Cambio =
    | { tipo: 'crear'; profesionalId: string; servicioId: string }
    | { tipo: 'reactivar'; profesionalId: string; servicioId: string }
    | { tipo: 'desactivar'; profesionalId: string; servicioId: string };
  const cambios: Cambio[] = [];
  const sinCambio: string[] = [];
  const noEncontrados: string[] = [];

  function planificar(profesionalId: string, servicioId: string, marcarActivo: boolean, etiqueta: string) {
    const clave = `${profesionalId}:${servicioId}`;
    const actual = existente.get(clave);
    if (marcarActivo) {
      if (!actual) cambios.push({ tipo: 'crear', profesionalId, servicioId });
      else if (!actual.activa) cambios.push({ tipo: 'reactivar', profesionalId, servicioId });
      else sinCambio.push(etiqueta);
    } else if (SINCRONIZAR_FALSOS && actual?.activa) {
      cambios.push({ tipo: 'desactivar', profesionalId, servicioId });
    }
  }

  // ── 1) Matriz de podólogos/as ───────────────────────────────────────────────
  const filas = parsearMatriz(MATRIZ_TSV);
  for (const fila of filas) {
    const prof = porNombre.get(claveNombre(fila.nombreCompleto));
    if (!prof) {
      noEncontrados.push(`Profesional no encontrado en BD: "${fila.nombreCompleto}" (sede hoja: ${fila.sede})`);
      continue;
    }
    for (const [columna, marcado] of Object.entries(fila.marcas)) {
      const codigos = COLUMNA_A_CODIGOS[columna];
      if (!codigos) {
        noEncontrados.push(`Columna sin mapear: "${columna}" (agregar a COLUMNA_A_CODIGOS)`);
        continue;
      }
      for (const codigo of codigos) {
        const servicio = porCodigo.get(codigo);
        if (!servicio) continue; // ya reportado arriba en codigosFaltantes
        planificar(prof.id, servicio.id, marcado, `${fila.nombreCompleto} ↔ ${servicio.nombre}`);
      }
    }
  }

  // ── 2) Fisioterapeutas: todos los servicios activos de Fisioterapia ────────
  const serviciosFisio = servicios.filter((s) => s.activo);
  const unidadesFisio = await prisma.unidadNegocio.findMany({
    where: { nombre: 'Fisioterapia' },
    select: { id: true },
  });
  const idsUnidadFisio = new Set(unidadesFisio.map((u) => u.id));
  const serviciosFisioActivos = serviciosFisio.filter((s) => idsUnidadFisio.has(s.unidadNegocioId));
  const fisioterapeutas = profesionales.filter((p) => p.tipo === 'fisioterapeuta' && !p.esEquipo);
  for (const fisio of fisioterapeutas) {
    for (const servicio of serviciosFisioActivos) {
      planificar(fisio.id, servicio.id, true, `${fisio.apellidos} ${fisio.nombres} ↔ ${servicio.nombre}`);
    }
  }

  // ── 3) Médicos reales (no equipo): todos los servicios de Baropodometría ───
  const unidadesBaro = await prisma.unidadNegocio.findMany({
    where: { nombre: 'Baropodometría' },
    select: { id: true },
  });
  const idsUnidadBaro = new Set(unidadesBaro.map((u) => u.id));
  const serviciosBaro = servicios.filter((s) => idsUnidadBaro.has(s.unidadNegocioId));
  const medicos = profesionales.filter((p) => p.tipo === 'medico' && !p.esEquipo);
  const idsMedicos = new Set(medicos.map((m) => m.id));
  for (const medico of medicos) {
    for (const servicio of serviciosBaro) {
      planificar(medico.id, servicio.id, true, `${medico.apellidos} ${medico.nombres} ↔ ${servicio.nombre}`);
    }
  }

  // ── Reporte ──────────────────────────────────────────────────────────────
  const crear = cambios.filter((c) => c.tipo === 'crear');
  const reactivar = cambios.filter((c) => c.tipo === 'reactivar');
  const desactivar = cambios.filter((c) => c.tipo === 'desactivar');

  console.log(`\n── Plan ──`);
  console.log(`  Crear:      ${crear.length}`);
  console.log(`  Reactivar:  ${reactivar.length}`);
  console.log(`  Desactivar: ${desactivar.length}${SINCRONIZAR_FALSOS ? '' : ' (omitido, falta --sincronizar-falsos)'}`);
  console.log(`  Sin cambio: ${sinCambio.length}`);

  if (noEncontrados.length > 0) {
    console.log(`\n⚠️  ${noEncontrados.length} advertencia(s):`);
    noEncontrados.forEach((n) => console.log(`  - ${n}`));
    if (ESTRICTO) {
      console.error('\n❌ --estricto: abortando por advertencias sin resolver.');
      process.exit(1);
    }
  }

  if (!APLICAR) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --aplicar para confirmar.');
    await prisma.$disconnect();
    return;
  }

  if (cambios.length === 0) {
    console.log('\nNada que aplicar.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const c of crear) {
      await tx.competenciaProfesional.create({
        // Médico-persona: SIEMPRE «solo por solicitud» (no es columna de la agenda; la columna es la máquina Baro).
        data: { profesionalId: c.profesionalId, servicioId: c.servicioId, activa: true, habilitadoDesde: new Date(), soloPorSolicitud: idsMedicos.has(c.profesionalId) },
      });
    }
    for (const c of [...reactivar, ...desactivar]) {
      await tx.competenciaProfesional.update({
        where: { profesionalId_servicioId: { profesionalId: c.profesionalId, servicioId: c.servicioId } },
        data: { activa: c.tipo === 'reactivar' },
      });
    }
  });

  console.log(`\n✅ Aplicado: ${crear.length} creadas, ${reactivar.length} reactivadas, ${desactivar.length} desactivadas.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
