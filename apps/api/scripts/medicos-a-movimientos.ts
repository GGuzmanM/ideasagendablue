/**
 * Pone en Movimientos › Doctores a los médicos que YA tienen usuario y sede pero no figuran ahí
 * (19-sep-2026). Movimientos › Doctores lee el roster de baro (`baro_medico_sede`); los médicos
 * creados desde Usuarios quedaron solo con su asignación de Composición de sede.
 *
 * Sede de cada médico: su asignación administrativa vigente hoy; si no tiene, su ÚNICA sede de
 * acceso. Con varias sedes y sin asignación no se adivina: se lista para asignarlo a mano.
 * No toca a quien ya tiene un periodo de baro vigente, ni las fichas «Prueba Doctor», ni las máquinas.
 *
 * Uso:  npx ts-node --transpile-only scripts/medicos-a-movimientos.ts            (simula)
 *       npx ts-node --transpile-only scripts/medicos-a-movimientos.ts --aplicar
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';
import { registrarMedicoEnBaroEnTx } from '../src/services/fichaUsuarioService';
import { auditEnTx } from '../src/services/audit';
import { fechaDb, hoyLimaStr } from '../src/utils/fechaLima';

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  const hoy = hoyLimaStr();
  const bd = (process.env.DATABASE_URL ?? '').split('/').pop();
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${bd}» · ${hoy}\n`);

  const medicos = await prisma.profesional.findMany({
    where: { tipo: 'medico', activo: true, deletedAt: null, esEquipo: false, NOT: { apellidos: { contains: 'Prueba Doctor' } } },
    select: {
      id: true, nombres: true, apellidos: true,
      usuario: { select: { activo: true, deletedAt: true, sedes: { select: { sedeId: true } } } },
    },
    orderBy: [{ nombres: 'asc' }],
  });
  const sedes = new Map((await prisma.sede.findMany({ select: { id: true, nombre: true } })).map((s) => [s.id, s.nombre]));

  let puestos = 0, yaEstaban = 0;
  const sinSede: string[] = [];
  for (const m of medicos) {
    const nombre = `${m.nombres} ${m.apellidos}`.trim();
    if (/^baro\s*\d+$/i.test(nombre)) continue;
    const asig = await prisma.asignacionAdministrativa.findFirst({
      where: { profesionalId: m.id, deletedAt: null, fechaInicio: { lte: fechaDb(hoy) }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb(hoy) } }] },
      orderBy: { fechaInicio: 'desc' }, select: { sedeId: true },
    });
    const deUsuario = m.usuario && !m.usuario.deletedAt && m.usuario.sedes.length === 1 ? m.usuario.sedes[0]!.sedeId : null;
    const sedeId = asig?.sedeId ?? deUsuario;
    if (!sedeId) { sinSede.push(nombre); continue; }

    if (!APLICAR) {
      const vigente = await prisma.baroMedicoSede.findFirst({
        where: { profesionalId: m.id, activa: true, fechaInicio: { lte: new Date(`${hoy}T23:59:59`) }, OR: [{ fechaFin: null }, { fechaFin: { gte: new Date(`${hoy}T00:00:00`) } }] },
        select: { sede: { select: { nombre: true } } },
      });
      if (vigente) { yaEstaban++; console.log(`  = ${nombre.padEnd(28)} ya está en ${vigente.sede.nombre}`); }
      else { puestos++; console.log(`  + ${nombre.padEnd(28)} → ${sedes.get(sedeId)}`); }
      continue;
    }
    const hecho = await prisma.$transaction(async (tx) => {
      const ok = await registrarMedicoEnBaroEnTx(tx, { profesionalId: m.id, sedeId });
      if (ok) await auditEnTx(tx, { accion: 'baro_solicitud_agregar', entidad: 'profesional', entidadId: m.id, despues: { sede: sedes.get(sedeId), soloPorSolicitud: true, origen: 'sistema' }, sedeId });
      return ok;
    });
    if (hecho) { puestos++; console.log(`  + ${nombre.padEnd(28)} → ${sedes.get(sedeId)}`); }
    else { yaEstaban++; console.log(`  = ${nombre.padEnd(28)} ya estaba en Movimientos`); }
  }
  console.log(`\n${APLICAR ? 'Puestos' : 'Se pondrían'} en Movimientos: ${puestos} · ya estaban: ${yaEstaban} · sin sede clara: ${sinSede.length}`);
  if (sinSede.length) console.log('  Sin sede clara (asignar a mano en Movimientos › Doctores): ' + sinSede.join(', '));
  if (!APLICAR) console.log('\nNada se escribió. Para aplicarlo: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
