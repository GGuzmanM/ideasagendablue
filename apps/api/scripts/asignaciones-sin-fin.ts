/**
 * Recepción y doctores SIN FECHA DE FIN en Movimientos (24-sep-2026).
 * Hasta hoy, arrastrar o dar de alta a una recepcionista o a un médico creaba su asignación «hasta fin de mes», y el mes
 * siguiente aparecía vacío hasta que la renovación del día 1 lo recreaba. Ahora las nuevas quedan sin fin; este script
 * convierte las VIGENTES que terminan a fin de mes en sin fin, para que sigan apareciendo los meses siguientes.
 *
 * Solo toca la asignación ACTUAL de cada persona (la más reciente, no quitada), y solo si termina el último día de un mes
 * y no hay otra posterior. Las que tienen fin puesto a mano en otra fecha (reemplazos, vacaciones) no se tocan.
 *
 *   npx ts-node --transpile-only scripts/asignaciones-sin-fin.ts              → SIMULA
 *   npx ts-node --transpile-only scripts/asignaciones-sin-fin.ts --aplicar    → ESCRIBE
 *   (con ENV_FILE=… apunta a la base de pruebas)
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const esFinDeMes = (s: string) => { const [y, m, d] = s.split('-').map(Number); return d === new Date(y!, m!, 0).getDate(); };
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}» · hoy ${hoy}\n`);
  let cambios = 0;

  // ── Doctores de baro (baro_medico_sede) ──
  const baro = await prisma.baroMedicoSede.findMany({
    where: { profesional: { activo: true, deletedAt: null, esEquipo: false } },
    select: { id: true, activa: true, fechaInicio: true, fechaFin: true, sede: { select: { nombre: true } }, profesional: { select: { id: true, nombres: true, apellidos: true } } },
    orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
  });
  const vistosB = new Set<string>();
  console.log('DOCTORES (Movimientos › Doctores):');
  for (const b of baro) {
    if (vistosB.has(b.profesional.id)) continue; vistosB.add(b.profesional.id);
    if (!b.activa || b.fechaFin === null) continue;
    const fin = ymd(b.fechaFin);
    if (fin < hoy || !esFinDeMes(fin)) continue;
    console.log(`  ${b.profesional.nombres} ${b.profesional.apellidos} · ${b.sede.nombre} · hasta ${fin} → sin fin`);
    if (APLICAR) await prisma.baroMedicoSede.update({ where: { id: b.id }, data: { fechaFin: null } });
    cambios++;
  }

  // ── Recepcionistas y doctores en asignaciones administrativas ──
  const adm = await prisma.asignacionAdministrativa.findMany({
    where: { OR: [{ recepcionistaId: { not: null }, recepcionista: { deletedAt: null } }, { profesionalId: { not: null }, profesional: { deletedAt: null, activo: true } }] },
    select: { id: true, deletedAt: true, fechaInicio: true, fechaFin: true, recepcionistaId: true, profesionalId: true, sede: { select: { nombre: true } },
      recepcionista: { select: { nombre: true } }, profesional: { select: { nombres: true, apellidos: true } } },
    orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
  });
  const vistosA = new Set<string>();
  console.log('\nRECEPCIÓN y DOCTORES (asignaciones administrativas):');
  for (const a of adm) {
    const clave = a.recepcionistaId ?? `p:${a.profesionalId}`;
    if (vistosA.has(clave)) continue; vistosA.add(clave);
    if (a.deletedAt || a.fechaFin === null) continue;
    const fin = ymd(a.fechaFin);
    if (fin < hoy || !esFinDeMes(fin)) continue;
    const quien = a.recepcionista ? `${a.recepcionista.nombre} (recepción)` : `${a.profesional?.nombres} ${a.profesional?.apellidos} (doctor)`;
    console.log(`  ${quien} · ${a.sede.nombre} · hasta ${fin} → sin fin`);
    if (APLICAR) await prisma.asignacionAdministrativa.update({ where: { id: a.id }, data: { fechaFin: null } });
    cambios++;
  }
  console.log(`\n${cambios} asignación(es) ${APLICAR ? 'pasadas' : 'se pasarían'} a «sin fin».`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
