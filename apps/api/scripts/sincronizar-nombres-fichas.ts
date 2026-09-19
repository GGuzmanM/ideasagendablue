/**
 * Pone al día las FICHAS cuyo nombre quedó distinto al de su usuario (19-sep-2026): antes, cambiar el
 * nombre en Administración › Usuarios no tocaba la ficha, así que Movimientos y la agenda seguían
 * mostrando el nombre viejo. Manda el nombre del USUARIO (es el que se corrigió a mano).
 * No toca las fichas de prueba («Prueba Doctor») ni las máquinas.
 *
 * Uso:  npx ts-node --transpile-only scripts/sincronizar-nombres-fichas.ts            (simula)
 *       npx ts-node --transpile-only scripts/sincronizar-nombres-fichas.ts --aplicar
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';
import { nombreDeUsuarioAFichaEnTx } from '../src/services/fichaUsuarioService';

const APLICAR = process.argv.includes('--aplicar');
const limpio = (s: string) => s.trim().replace(/\s+/g, ' ');

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»\n`);
  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null, OR: [{ recepcionistaId: { not: null } }, { profesionalId: { not: null } }] },
    select: {
      id: true, nombre: true, recepcionistaId: true, profesionalId: true,
      recepcionista: { select: { nombre: true } },
      profesional: { select: { nombres: true, apellidos: true, esEquipo: true } },
    },
    orderBy: { nombre: 'asc' },
  });
  let n = 0;
  for (const u of usuarios) {
    const ficha = u.recepcionista ? limpio(u.recepcionista.nombre) : u.profesional ? limpio(`${u.profesional.nombres} ${u.profesional.apellidos}`) : null;
    if (!ficha || ficha === limpio(u.nombre)) continue;
    if (u.profesional?.esEquipo || /prueba/i.test(ficha) || /prueba/i.test(u.nombre)) { console.log(`  · se deja (prueba/equipo): ${ficha}`); continue; }
    n++;
    console.log(`  ${APLICAR ? '✔' : '+'} ficha «${ficha}»  →  «${limpio(u.nombre)}»`);
    if (APLICAR) await prisma.$transaction((tx) => nombreDeUsuarioAFichaEnTx(tx, { nombre: u.nombre, recepcionistaId: u.recepcionistaId, profesionalId: u.profesionalId }));
  }
  console.log(`\n${APLICAR ? 'Fichas renombradas' : 'Se renombrarían'}: ${n}`);
  if (!APLICAR) console.log('Nada se escribió. Para aplicarlo: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
