/**
 * Habilita TODO el catálogo activo de su área a las fichas «Adicional <sede>» (columna extra de la sede, no una
 * persona). Sin competencias la agenda no las muestra como columna. Las fichas nuevas ya lo reciben al crearse
 * (POST /profesionales); esto es para las que se crearon antes (22-sep-2026: Adicional Lince / LO / One / Paz Soldan).
 *
 *   npx ts-node --transpile-only scripts/habilitar-adicionales.ts            → muestra qué haría
 *   npx ts-node --transpile-only scripts/habilitar-adicionales.ts --aplicar  → escribe
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»\n`);
  const fichas = await prisma.profesional.findMany({
    where: { deletedAt: null, activo: true, OR: [{ nombres: { startsWith: 'Adicional', mode: 'insensitive' } }, { nombres: { startsWith: 'Adiconal', mode: 'insensitive' } }] },
    select: { id: true, nombres: true, apellidos: true, unidadNegocioId: true, unidadNegocio: { select: { nombre: true } }, competencias: { where: { activa: true }, select: { servicioId: true } } },
  });
  if (!fichas.length) { console.log('No hay fichas «Adicional».'); return; }
  let total = 0;
  for (const f of fichas) {
    const servicios = await prisma.servicio.findMany({ where: { unidadNegocioId: f.unidadNegocioId, activo: true, deletedAt: null }, select: { id: true, nombre: true } });
    const ya = new Set(f.competencias.map((c) => c.servicioId));
    const faltan = servicios.filter((s) => !ya.has(s.id));
    console.log(`${f.nombres} ${f.apellidos} (${f.unidadNegocio.nombre}): tiene ${ya.size}, faltan ${faltan.length}${faltan.length ? ' → ' + faltan.map((s) => s.nombre).join(', ') : ''}`);
    if (APLICAR && faltan.length) {
      // Reactiva las que existan inactivas y crea el resto.
      await prisma.competenciaProfesional.updateMany({ where: { profesionalId: f.id, servicioId: { in: faltan.map((s) => s.id) } }, data: { activa: true } });
      await prisma.competenciaProfesional.createMany({ data: faltan.map((s) => ({ profesionalId: f.id, servicioId: s.id, activa: true, habilitadoDesde: new Date() })), skipDuplicates: true });
    }
    total += faltan.length;
  }
  console.log(`\n${APLICAR ? 'Habilitadas' : 'Se habilitarían'}: ${total} competencias en ${fichas.length} fichas.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
