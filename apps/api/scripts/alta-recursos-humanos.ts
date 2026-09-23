/**
 * Alta de las usuarias de RECURSOS HUMANOS (21-sep-2026). Misma lógica de siempre: correo = 2 letras del nombre +
 * apellido @limablue.com, contraseña inicial = DNI, rol «recursos_humanos» (todas las sedes por su rol).
 *   npx ts-node --transpile-only scripts/alta-recursos-humanos.ts             → SIMULA
 *   npx ts-node --transpile-only scripts/alta-recursos-humanos.ts --aplicar
 */
import '../src/cargarEnv';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
const LISTA = [
  { nombre: 'Leydy Gonzalez Guevara', correo: 'legonzalez@limablue.com', dni: '76530005' },
  { nombre: 'Evelin Gonzales Tarazona', correo: 'evgonzales@limablue.com', dni: '77436632' },
];
async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»`);
  const rol = await prisma.rol.findUnique({ where: { nombre: 'recursos_humanos' }, select: { permisos: true } });
  if (!rol) throw new Error('Falta el rol recursos_humanos: corre primero `prisma migrate deploy`');
  console.log(`Rol Recursos Humanos: ${rol.permisos.join(', ')}`);
  for (const p of LISTA) {
    const ya = await prisma.usuario.findUnique({ where: { email: p.correo }, select: { id: true } });
    if (ya) { console.log(`  = ${p.nombre} (${p.correo}) ya existe: no se toca`); continue; }
    if (APLICAR) await prisma.usuario.create({ data: { nombre: p.nombre, email: p.correo, passwordHash: await bcrypt.hash(p.dni, 12), rol: 'recursos_humanos', activo: true } });
    console.log(`  ${APLICAR ? '✔' : '+'} ${p.nombre} → ${p.correo} · contraseña inicial: su DNI`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
