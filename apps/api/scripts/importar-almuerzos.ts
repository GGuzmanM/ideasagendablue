/**
 * Carga los BREAKS (almuerzos) de los profesionales desde la tabla TURNOS de abajo.
 *
 * Pensado para trasladar los almuerzos del ERP viejo (las celdas GRISES de su grilla) al sistema
 * nuevo. Usa el MISMO servicio que la UI (`crearAlmuerzo`), así que el resultado es idéntico a
 * cargarlos a mano desde Agenda › horarios: bloqueo recurrente, vigente hasta fin de mes, y
 * desactivando/acortando cualquier almuerzo previo que se traslape.
 *
 * REGLAS IMPORTANTES
 *  · Solo actúa sobre profesionales REGISTRADOS en la BD de esta máquina. Al que no encuentre,
 *    lo reporta y lo salta — nunca lo crea.
 *  · La SEDE no se escribe a mano: se toma de la asignación de sede VIGENTE del profesional en
 *    la BD (Movimientos). Si no tiene asignación vigente, se reporta y se salta.
 *  · El sistema solo admite 3 turnos: 12:00, 13:00 y 14:00 (ver TURNOS_ALMUERZO en
 *    packages/shared). Cualquier otro valor se rechaza antes de tocar la BD.
 *  · DRY-RUN por defecto: imprime el plan sin escribir. Pasa --aplicar para ejecutar.
 *
 * Uso:
 *   npm run importar:almuerzos              # dry-run, muestra el plan
 *   npm run importar:almuerzos -- --aplicar # aplica
 *   npm run importar:almuerzos -- --fecha 2026-09-22 --aplicar   # rige desde esa fecha
 */
import '../src/cargarEnv'; // respeta ENV_FILE: sin esto SIEMPRE escribía en la base de .env (la real), aun queriendo probar en la copia
import { PrismaClient } from '@prisma/client';
import { crearAlmuerzo } from '../src/services/almuerzoService';

const prisma = new PrismaClient();

// ─── TABLA DE BREAKS ──────────────────────────────────────────────────────────
// CÓMO SE LEYÓ LA GRILLA DEL ERP VIEJO (reglas dadas por Gustavo, 20-09-2026):
//   · Las columnas arrancan en 08-09, así que la celda Nº5 = 12-13, la Nº6 = 13-14, la Nº7 = 14-15.
//   · El break SIEMPRE cae en una de esas tres (coincide con TURNOS_ALMUERZO del sistema).
//   · Gris AL INICIO de la fila = entra más tarde, NO es break.
//   · Fila TODA gris = no habilitado ese día, NO lleva break.
//   → Por eso varias filas quedan como "sin break" y eso es una respuesta, no un dato faltante.
//
// CONFIANZA de cada lectura:
//   [ALTA]  leído de la captura de Lince, la única que traía la fila de encabezados de horas.
//   [MEDIA] inferido contando la posición de la celda gris en capturas SIN encabezado. La regla
//           de las 3 horas valida el resultado, pero conviene una mirada antes de aplicar.
//   null    no se pudo leer → no se toca.
//
// Si un break sale mal, no es grave: volver a correr el script con la hora corregida REEMPLAZA
// el anterior (crearAlmuerzo desactiva el que se traslape), no se duplica.
// 'SIN_BREAK' = resuelto por regla (fila gris/entrada tardía): no lleva almuerzo, no hay nada que hacer.
// null        = no se pudo leer de la captura: requiere confirmación.
type Hora = '12:00' | '13:00' | '14:00' | 'SIN_BREAK' | null;

const TURNOS: { nombre: string; hora: Hora }[] = [
  // RELEÍDO el 21-sep-2026 de las 6 capturas del ERP que SÍ traen el encabezado de horas (08-09 … 19-20).
  // Break = la celda gris EN MEDIO de la fila. Gris al inicio = entra más tarde; gris hasta el final = sale antes
  // o no está habilitada → sin break. Corrige dos lecturas de la versión anterior (hecha sin encabezados):
  // Culquicondor y Pacco son 12-13, no 13-14 / 14-15. Máquinas de baro, «Citas adicionales», «Rebote» y
  // «Sede … Doctor» no son personas: no llevan almuerzo.
  // ── Sede 1 (San Isidro / Paz Soldán) ──
  { nombre: 'Escalante Mendoza Laura Kelly', hora: '12:00' },
  { nombre: 'Perez Mallqui Norma Esperanza', hora: '12:00' },
  { nombre: 'Flores Luz', hora: '13:00' },
  { nombre: 'Cisneros Mija Alicia Maribel', hora: '13:00' },
  { nombre: 'Valdez Monica', hora: '14:00' },
  { nombre: 'Castro Valdez Carla Cynthia', hora: '14:00' },
  { nombre: 'Taya Huallpacuna Angelica Isabel', hora: '12:00' },
  { nombre: 'Tejada Bazan Sonia Marlene', hora: '13:00' },            // gris 08-09 = entra a las 9; su break es 13-14
  { nombre: 'Noteno Jacinto Nelly Juana', hora: 'SIN_BREAK' },          // solo 08-11, el resto gris
  { nombre: 'Paredes Salinas Glenda Milagritos', hora: 'SIN_BREAK' },   // gris 08-13: entra a las 13:00
  { nombre: 'Sosa Baquerizo Mayra Estephany', hora: 'SIN_BREAK' },      // solo 08-10, el resto gris
  // ── Sede 2 (Lince) ──
  { nombre: 'Chamorro Meza Yeccijca Rosario', hora: '13:00' },          // en el ERP figura «Asis. Pod Chamorro, Jessica»
  { nombre: 'Culquicondor Franco Carmen Ines', hora: '12:00' },
  { nombre: 'Pacco Gutierrez Tania Cleofe', hora: '12:00' },
  { nombre: 'Pisco Panduro Martha Ybelice', hora: '13:00' },
  { nombre: 'Rodriguez Haro Raysa Alessandra', hora: '13:00' },
  { nombre: 'Salinas Ubillus Hayde Milagros', hora: '14:00' },
  { nombre: 'Zambrano Cuevas Milagros Maria', hora: '12:00' },
  { nombre: 'Auris Asca Ivonne Jill', hora: 'SIN_BREAK' },              // fila toda gris
  { nombre: 'Rios Peñaherrera Fiorella', hora: 'SIN_BREAK' },           // solo 08-11, el resto gris
  // ── Sede 3 (Los Olivos) ──
  { nombre: 'Vargas Villanueva Elizabeth', hora: '12:00' },
  { nombre: 'Oropesa Tapia Marilin Leidi', hora: '14:00' },
  { nombre: 'Flores Paredes Milagros Mercedes', hora: '14:00' },
  { nombre: 'Chavez Vazquez Mirtha', hora: '12:00' },                   // gris 08-09 = entra a las 9; su break es 12-13
  { nombre: 'Chiclla Suehara Jenny Rosario', hora: '12:00' },
  { nombre: 'Saldaña Mostacero Luz Haydee', hora: '13:00' },
  // ── Sede 4 (San Miguel) ──
  { nombre: 'Puerta Ramos Vanessa Elizabeth', hora: '12:00' },
  // ── NO aparecen en estas capturas (faltan el resto de San Miguel y la sede One): sin tocar hasta verlas ──
  { nombre: 'Chavez Ocampo Lesly Selenne', hora: null },
  { nombre: 'Morote Carmona Gissela Victoria', hora: null },
  { nombre: 'MALASQUEZ BERROCAL DASSNE YULEYSI', hora: null },
  { nombre: 'Gutierrez Ñahuis Maximina', hora: '13:00' },              // «Machi» en el ERP. Gris 08-09 = entra a las 9; break 13-14 (2ª tanda de capturas, 21-sep)
  { nombre: 'Saavedra Carbajal Erika Maria', hora: '14:00' },         // gris 08-09 = entra a las 9; break 14-15
  { nombre: 'Valencia Chiyuare Miluska Isabel', hora: '14:00' },      // break 14-15
  { nombre: 'Bouisson Carbajal Fiorella Estephany', hora: null },
  { nombre: 'Diaz Vergara Sarai Abigail', hora: '13:00' },            // break 13-14
  { nombre: 'Chamorro Pacheco Erika Shabell', hora: '12:00' },        // break 12-13
  { nombre: 'Doy Daniel', hora: 'SIN_BREAK' },                        // sin gris en medio (solo 19-20 al final = sale antes)
  { nombre: 'Doy Yasica', hora: null },                               // la celda 13-14 sale en blanco en la captura: por confirmar
];

// ─── CLI ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APLICAR = argv.includes('--aplicar');
const iFecha = argv.indexOf('--fecha');
const FECHA = iFecha !== -1 ? argv[iFecha + 1] : undefined;

if (FECHA && !/^\d{4}-\d{2}-\d{2}$/.test(FECHA)) {
  console.error(`--fecha debe ser YYYY-MM-DD (recibido: "${FECHA}")`);
  process.exit(2);
}

// ─── Matching de nombres (insensible a orden/mayúsculas/tildes) ───────────────
function claveNombre(...partes: string[]): string {
  return partes
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

async function main() {
  console.log(`Modo: ${APLICAR ? 'APLICAR (escribe en la BD)' : 'DRY-RUN (solo muestra el plan)'}`);
  if (FECHA) console.log(`Rige desde: ${FECHA}`);

  const usuarioSistema = await prisma.usuario.findFirst({
    where: { rol: 'admin', activo: true, deletedAt: null },
    select: { id: true },
  });
  if (!usuarioSistema) {
    console.error('No hay un usuario admin activo para registrar la autoría del bloqueo.');
    process.exit(1);
  }

  const profesionales = await prisma.profesional.findMany({
    where: { deletedAt: null, activo: true, esEquipo: false },
    select: { id: true, nombres: true, apellidos: true },
  });
  const porNombre = new Map(profesionales.map((p) => [claveNombre(p.apellidos, p.nombres), p]));

  const fechaConsulta = new Date(`${FECHA ?? new Date().toISOString().split('T')[0]}T12:00:00Z`);

  const aplicar: { nombre: string; profesionalId: string; sedeId: string; sede: string; hora: string }[] = [];
  const pendientes: string[] = [];
  const sinBreak: string[] = [];
  const problemas: string[] = [];
  const yaTienen: string[] = [];

  for (const fila of TURNOS) {
    // El nombre se valida SIEMPRE, aunque la hora esté pendiente: así se sabe de antemano
    // cuáles no van a matchear, sin esperar a haber completado toda la tabla.
    const prof = porNombre.get(claveNombre(fila.nombre));
    if (!prof) {
      problemas.push(`No está registrado en esta BD: "${fila.nombre}" — se salta`);
      continue;
    }
    if (fila.hora === 'SIN_BREAK') {
      sinBreak.push(`${prof.apellidos}, ${prof.nombres}`);
      continue;
    }
    if (!fila.hora) {
      pendientes.push(`${prof.apellidos}, ${prof.nombres}`);
      continue;
    }
    // La sede sale de la asignación VIGENTE (Movimientos), no de la tabla de arriba.
    const asignacion = await prisma.asignacionSede.findFirst({
      where: {
        profesionalId: prof.id, // por RANGO, sin `activa`: una base reemplazada por un movimiento futuro sigue vigente
        fechaInicio: { lte: fechaConsulta },
        OR: [{ fechaFin: null }, { fechaFin: { gte: fechaConsulta } }],
      },
      orderBy: { fechaInicio: 'desc' },
      select: { sedeId: true, sede: { select: { nombre: true } } },
    });
    if (!asignacion) {
      problemas.push(`Sin asignación de sede vigente: "${fila.nombre}" — se salta`);
      continue;
    }
    // Si ya tiene ESE mismo almuerzo vigente, no se toca (evita borrar y recrear lo que ya está bien).
    const yaIgual = await prisma.bloqueoAgenda.findFirst({ where: { profesionalId: prof.id, tipo: 'ALMUERZO', deletedAt: null, horaInicio: fila.hora, sedeId: asignacion.sedeId, fechaInicio: { lte: fechaConsulta }, fechaFin: { gte: fechaConsulta } }, select: { id: true } });
    if (yaIgual) { yaTienen.push(`${prof.apellidos}, ${prof.nombres} — ${fila.hora}`); continue; }
    aplicar.push({
      nombre: `${prof.apellidos}, ${prof.nombres}`,
      profesionalId: prof.id,
      sedeId: asignacion.sedeId,
      sede: asignacion.sede.nombre,
      hora: fila.hora,
    });
  }

  console.log(`\n── Plan ──`);
  for (const a of aplicar) {
    console.log(`  ${a.hora} – ${a.hora === '12:00' ? '13:00' : a.hora === '13:00' ? '14:00' : '15:00'}  ${a.nombre}  (${a.sede})`);
  }
  console.log(`\n  A aplicar: ${aplicar.length}`);
  console.log(`  Ya lo tienen igual (no se tocan): ${yaTienen.length}`);
  console.log(`  Sin break por regla (no requieren acción): ${sinBreak.length}`);
  console.log(`  Por confirmar (no se pudo leer la captura): ${pendientes.length}`);
  console.log(`  Con problema: ${problemas.length}`);

  if (sinBreak.length > 0) {
    console.log(`\nSin break — fila gris completa o entrada tardía en el ERP viejo:`);
    sinBreak.forEach((n) => console.log(`  · ${n}`));
  }
  if (pendientes.length > 0) {
    console.log(`\n⚠️  Falta confirmar la hora de (editar TURNOS en este script):`);
    pendientes.forEach((n) => console.log(`  - ${n}`));
  }
  if (problemas.length > 0) {
    console.log(`\nProblemas:`);
    problemas.forEach((p) => console.log(`  - ${p}`));
  }

  if (!APLICAR) {
    console.log('\nDry-run: no se escribió nada. Ejecuta con --aplicar para confirmar.');
    await prisma.$disconnect();
    return;
  }

  // Uno por uno: si alguien tiene pacientes agendados en esa hora (409 CITAS_EN_RANGO) se anota y sigue.
  let cargados = 0;
  for (const a of aplicar) {
    try {
      await crearAlmuerzo({ profesionalId: a.profesionalId, sedeId: a.sedeId, horaInicio: a.hora, creadoPor: usuarioSistema.id, ...(FECHA ? { fecha: FECHA } : {}) });
      console.log(`  ✓ ${a.nombre} — ${a.hora}`);
      cargados++;
    } catch (e) {
      console.log(`  ✘ ${a.nombre} — ${a.hora}: ${(e as Error).message}`);
    }
  }
  console.log(`\n✅ ${cargados} de ${aplicar.length} almuerzo(s) cargado(s).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
