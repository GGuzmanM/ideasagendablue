/**
 * Arrastres de podólogas que quedaron «hasta fin de mes» (19-sep-2026): antes, arrastrar una podóloga
 * a otra sede en Movimientos guardaba el cambio hasta fin de mes y creaba su RETORNO automático el
 * día 1 → la agenda la devolvía sola a la sede anterior sin que coordinación lo pidiera. Ahora el
 * arrastre se queda hasta que lo cambien; este script arregla los que ya estaban guardados así:
 * el movimiento pasa a SIN fecha de fin y se borra su retorno (lo mismo que hace «Editar movimiento»
 * al quitarle la fecha de fin).
 *
 * Solo toca lo que claramente fue un arrastre VIGENTE: motivo «Otro», sin notas, que termina justo
 * el último día del mes de hoy o después, con su retorno automático al día siguiente y sin ningún
 * otro movimiento programado más adelante. Un préstamo registrado con «Nuevo movimiento» (otro
 * motivo o con notas) NO se toca. No mueve ni altera citas.
 *
 * Uso:  npx ts-node --transpile-only scripts/arrastres-sin-fin-de-mes.ts            (simula)
 *       npx ts-node --transpile-only scripts/arrastres-sin-fin-de-mes.ts --aplicar
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';
import { auditEnTx } from '../src/services/audit';
import { fechaDb, hoyLimaStr } from '../src/utils/fechaLima';

const APLICAR = process.argv.includes('--aplicar');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const masUnDia = (d: Date) => new Date(d.getTime() + 86_400_000);
const esFinDeMes = (d: Date) => masUnDia(d).getUTCDate() === 1;

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»\n`);
  const hoy = fechaDb(hoyLimaStr());
  const movs = await prisma.asignacionSede.findMany({
    where: { esRetorno: false, motivo: 'OTRO', fechaFin: { gte: hoy }, OR: [{ notas: null }, { notas: '' }] },
    include: { profesional: { select: { nombres: true, apellidos: true } }, sede: { select: { nombre: true } } },
    orderBy: [{ fechaFin: 'asc' }],
  });
  let n = 0;
  for (const m of movs) {
    const nombre = `${m.profesional.nombres} ${m.profesional.apellidos}`;
    if (!m.fechaFin || !esFinDeMes(m.fechaFin)) continue;
    const despues = await prisma.asignacionSede.findMany({
      where: { profesionalId: m.profesionalId, id: { not: m.id }, fechaInicio: { gt: m.fechaFin } },
      include: { sede: { select: { nombre: true } } },
    });
    const retorno = despues.find((r) => r.esRetorno && ymd(r.fechaInicio) === ymd(masUnDia(m.fechaFin!)));
    if (!retorno) { console.log(`  · se deja (no tiene retorno automático): ${nombre}`); continue; }
    if (despues.length > 1) { console.log(`  · se deja (tiene otro movimiento programado después): ${nombre}`); continue; }
    n++;
    console.log(`  ${APLICAR ? '✔' : '+'} ${nombre}: se queda en ${m.sede.nombre} (ya no vuelve sola a ${retorno.sede.nombre} el ${ymd(retorno.fechaInicio)})`);
    if (!APLICAR) continue;
    await prisma.$transaction(async (tx) => {
      // Primero el retorno: el índice «una sola asignación abierta por profesional» no admite dos sin fin.
      await tx.asignacionSede.delete({ where: { id: retorno.id } });
      await tx.asignacionSede.update({ where: { id: m.id }, data: { fechaFin: null, activa: true } });
      await auditEnTx(tx, {
        accion: 'editar_movimiento', entidad: 'asignacion_sede', entidadId: m.id, sedeId: m.sedeId,
        antes: { sedeId: m.sedeId, fechaFin: ymd(m.fechaFin!), motivo: m.motivo, notas: m.notas },
        despues: { sedeId: m.sedeId, fechaFin: null, motivo: m.motivo, notas: m.notas, origen: 'arrastre sin fin de mes (retorno automático eliminado)' },
      });
    });
  }
  console.log(`\n${APLICAR ? 'Movimientos corregidos' : 'Se corregirían'}: ${n}`);
  if (!APLICAR) console.log('Nada se escribió. Para aplicarlo: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
