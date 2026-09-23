/**
 * COMPETENCIAS desde la matriz «Colaborador × Tratamiento» que pasó el usuario el 21-sep-2026 (la más
 * actualizada de la clínica). Reemplaza a `importar-competencias.ts` (de otra PC), cuyos CÓDIGOS de servicio no
 * coinciden con esta base (allá POD-01 = Profilaxis; aquí POD-01 = Laserterapia P6): aquí el cruce es por el
 * SERVICIO real del catálogo, verificado contra el historial de cambios de nombre.
 *
 *   npx ts-node --transpile-only scripts/importar-competencias-matriz.ts             → SIMULA
 *   npx ts-node --transpile-only scripts/importar-competencias-matriz.ts --aplicar   → aplica
 *
 * Reglas:
 *  · Solo toca a las personas de la matriz y solo los servicios que la matriz cubre. VERDADERO = habilitado,
 *    FALSO = deshabilitado (no se borra: `activa=false`, se reactiva desde Administración › Competencias).
 *  · Lo que la matriz NO cubre (Uña acrílica, Rodetoplastia, Toma de muestra, todo Fisioterapia y Baro) no se toca.
 *  · Quien no está en la matriz (p. ej. Marilin Oropesa, Nataly Barrios) no se toca. Quien está en la matriz pero no
 *    en el sistema se reporta y se salta («si no tenemos una podóloga es porque ya se retiró»).
 *  · Familia del LÁSER DE HONGOS (regular, P6 y P12): se habilita si la persona tiene «Láser para hongos» O «Láser de
 *    alta». En la matriz solo difieren en Yeccijca (Jessica) Chamorro, que en la agenda real atiende los paquetes P12
 *    todo el día con solo «Láser para hongos»: separarlos la dejaría sin poder recibir sus propias citas.
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
const COL = ['PROFILAXIS', 'PROFILAXIS INFANTIL', 'PROFILAXIS DE MANO', 'LASER PARA HONGOS', 'LASER DE ALTA: HONGOS', 'LASERTERAPIA - FISIOTERAPIA', 'EVALUACION DE PODOLOGIA', 'EXTRACCION DE UÑERO', 'EXTRACCION DE UÑA', 'EXTRACCION DE NUCLEO', 'MATRISECTOMIA', 'ORTONIXIAS', 'CURACION DE HERIDAS', 'CURACION DE EXTRACCION / UÑERO / MATRISECTOMIA', 'ACIDO NITRICO ONICOMICOSIS', 'ACIDO NITRICO VPH', 'ORTESICOS', 'INFILTRACION: CALLOS', 'BLEOMICINA - VPH'] as const;

/** Servicio del catálogo (por código) → columnas de la matriz que lo habilitan (basta UNA en verdadero). */
const SERVICIO_COLUMNAS: Record<string, number[]> = {
  'POD-PRO': [0, 1],                    // Limpieza Clínica del Pie (antes «Profilaxis»); la infantil es una subcategoría suya
  'POD-HEL-SIM': [2],                   // Limpieza Clínica de Manos (antes «Profilaxis de Mano»)
  'POD-LASER': [3, 4],                  // Láser para Hongos Regular
  'POD-01': [3, 4],                     // Laserterapia Onicomicosis P6
  'LASER_DE_ALTA_HONGOS': [3, 4],       // Laserterapia Onicomicosis P12 (antes «Láser de Alta: Hongos»)
  'POD-03': [5], 'POD-04': [5],         // Laserterapia P4 / P6 Fisio
  'POD-CPO': [6],                       // Evaluación PO
  'POD-ONI': [7],                       // Extracción de Uñero
  'POD-LCP-PRE': [8],                   // Extracción de Uña
  'MATRISECTOMIA': [10],
  'POD-QUI': [11],                      // Tratamiento de Uñero - Onyfix (= ortonixia)
  'POD-CUR-ULC': [12],                  // Curación de Úlceras (= curación de heridas)
  'CURACION_DE_EXTRACCION_DE_UNERO': [13], // Curación
  'POD-VER': [15],                      // VPH AN (ácido nítrico)
  'BAR-BIO': [16], 'BAR-PLA': [16],     // Ortésicos
  'INFILTRACION_CALLOS': [17],
  'POD-02': [18],                       // VPH BLE (bleomicina)
};
const SIN_SERVICIO = [9, 14]; // «Extracción de núcleo» y «Ácido nítrico onicomicosis»: no existen como servicio en el catálogo

// nombre | 19 marcas en el orden de COL (1 = VERDADERO)
const MATRIZ: [string, string][] = [
  ['Auris Asca Ivonne Jill', '1111111000010110100'], ['Chamorro Meza Yeccijca Rosario', '0001000000000000000'], ['Chavez Ocampo Lesly Selenne', '1111111000010110100'],
  ['Culquicondor Franco Carmen Ines', '1101111000010010000'], ['Pacco Gutierrez Tania Cleofe', '1101111000000110000'], ['Pisco Panduro Martha Ybelice', '1111111000011110000'],
  ['Rios Peñaherrera Fiorella', '1101101111111111111'], ['Zambrano Cuevas Milagros Maria', '1101111000010010000'], ['Chavez Vazquez Mirtha', '1101101000000000001'],
  ['Escalante Mendoza Laura Kelly', '1101100000000000000'], ['Morote Carmona Gissela Victoria', '1111101000010110110'], ['Saavedra Carbajal Erika Maria', '1111111000111010001'],
  ['Saldaña Mostacero Luz Haydee', '1101111110011111111'], ['Tejada Bazan Sonia Marlene', '1101111111111111111'], ['Chamorro Pacheco Erika Shabell', '1101101000011110100'],
  ['Doy Daniel', '1111111111111111011'], ['Diaz Vergara Sarai Abigail', '1101101000000110101'], ['Doy Yasica', '1101111111111111111'],
  ['Bouisson Carbajal Fiorella Estephany', '1101111000011110000'], ['Castro Valdez Carla Cynthia', '1111101110011110110'], ['Chiclla Suehara Jenny Rosario', '1111111111111111111'],
  ['Flores Paredes Milagros Mercedes', '1111101000010010000'], ['Malasquez Berrocal Dassne Yuleysi', '1111111000010110100'], ['Noteno Jacinto Nelly Juana', '1101100000000000000'],
  ['Paredes Salinas Glenda Milagritos', '1101101000010110000'], ['Puerta Ramos Vanessa Elizabeth', '1101101000000000000'], ['Salinas Ubillus Hayde Milagros', '1101111000010110001'],
  ['Sosa Baquerizo Mayra Estephany', '1101111000010110001'], ['Gutierrez Ñahuis Maximina', '1101111111111111111'], ['Marquina Vasquez Doris Vicenta', '1101101000010110010'],
  ['Rodriguez Haro Raysa Alessandra', '1101111111111111111'], ['Taya Huallpacuna Angelica Isabel', '1101111000010110001'], ['Valencia Chiyuare Miluska Isabel', '1111111000011110000'],
];
const clave = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-ZÑ ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»\n`);
  for (const [n, bits] of MATRIZ) if (bits.length !== COL.length || /[^01]/.test(bits)) throw new Error(`fila mal escrita: ${n}`);
  const servicios = await prisma.servicio.findMany({ where: { codigo: { in: Object.keys(SERVICIO_COLUMNAS) }, deletedAt: null }, select: { id: true, codigo: true, nombre: true, activo: true } });
  const faltanServ = Object.keys(SERVICIO_COLUMNAS).filter((c) => !servicios.some((s) => s.codigo === c)); if (faltanServ.length) console.log(`⚠ servicios que no existen en esta base: ${faltanServ.join(', ')}\n`);
  const profs = await prisma.profesional.findMany({ where: { deletedAt: null, esEquipo: false }, select: { id: true, nombres: true, apellidos: true, activo: true } });
  const porNombre = new Map(profs.map((p) => [clave(`${p.apellidos} ${p.nombres}`), p]));
  let crear = 0, reactivar = 0, desactivar = 0, igual = 0; const noEstan: string[] = [];

  for (const [nombre, bits] of MATRIZ) {
    const p = porNombre.get(clave(nombre)); if (!p) { noEstan.push(nombre); continue; }
    const actuales = await prisma.competenciaProfesional.findMany({ where: { profesionalId: p.id, servicioId: { in: servicios.map((s) => s.id) } }, select: { servicioId: true, activa: true, soloPorSolicitud: true } });
    const cambios: string[] = [];
    for (const s of servicios) {
      const debe = SERVICIO_COLUMNAS[s.codigo!]!.some((i) => bits[i] === '1'); const hoy = actuales.find((a) => a.servicioId === s.id);
      if (debe && !hoy) { crear++; cambios.push(`+ ${s.nombre}`); if (APLICAR) await prisma.competenciaProfesional.create({ data: { profesionalId: p.id, servicioId: s.id, activa: true, habilitadoDesde: new Date() } }); }
      else if (debe && !hoy!.activa) { reactivar++; cambios.push(`+ ${s.nombre} (reactivado)`); if (APLICAR) await prisma.competenciaProfesional.update({ where: { profesionalId_servicioId: { profesionalId: p.id, servicioId: s.id } }, data: { activa: true } }); }
      else if (!debe && hoy?.activa && hoy.soloPorSolicitud) { igual++; cambios.push(`= ${s.nombre} (es «solo por solicitud»: no se toca)`); }
      else if (!debe && hoy?.activa) { desactivar++; cambios.push(`− ${s.nombre}`); if (APLICAR) await prisma.competenciaProfesional.update({ where: { profesionalId_servicioId: { profesionalId: p.id, servicioId: s.id } }, data: { activa: false } }); }
      else igual++;
    }
    console.log(`${p.apellidos}, ${p.nombres}${p.activo ? '' : ' (INACTIVA)'}: ${cambios.length ? cambios.join(' · ') : 'sin cambios'}`);
  }
  console.log(`\n${APLICAR ? 'Hecho' : 'Se haría'}: ${crear} nuevas · ${reactivar} reactivadas · ${desactivar} deshabilitadas · ${igual} ya estaban bien`);
  if (noEstan.length) console.log(`No están en el sistema (se saltan): ${noEstan.join(', ')}`);
  console.log(`Columnas de la matriz sin servicio en el catálogo (no se cargan): ${SIN_SERVICIO.map((i) => COL[i]).join(' · ')}`);
  if (!APLICAR) console.log('\nNada se escribió. Para aplicarlo: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
