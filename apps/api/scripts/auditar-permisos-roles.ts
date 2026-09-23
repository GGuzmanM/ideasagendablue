/**
 * Auditoría SOLO LECTURA de los permisos guardados en la tabla `roles` contra la
 * matriz de `src/permisos.ts` (única fuente de verdad, la que leen los candados
 * `requirePermiso` del API y los `tiene(...)` del front).
 *
 * No escribe nada. Sirve para saber, en CUALQUIER máquina, si esa base tiene los
 * roles al día o se quedó con los nombres de permisos viejos (`agenda.*`,
 * `herramientas.*`, `admin.ver`) que ningún candado reconoce.
 *
 * Uso:  npm run auditar:permisos
 */
import '../src/cargarEnv'; // respeta ENV_FILE: sin esto SIEMPRE escribía en la base de .env (la real), aun queriendo probar en la copia
import { PrismaClient } from '@prisma/client';
import { PERMISOS_VALIDOS, ROLES_SISTEMA } from '../src/permisos';

const prisma = new PrismaClient();

async function main() {
  const validos = new Set<string>(PERMISOS_VALIDOS);
  const esperadoPorRol = new Map(ROLES_SISTEMA.map((r) => [r.nombre, new Set<string>(r.permisos)]));

  const roles = await prisma.rol.findMany({ orderBy: { nombre: 'asc' } });
  let rolesConProblema = 0;

  for (const rol of roles) {
    const guardados = new Set(rol.permisos);
    const huerfanos = [...guardados].filter((p) => !validos.has(p)); // no los reconoce ningún candado
    const esperado = esperadoPorRol.get(rol.nombre);
    const faltantes = esperado ? [...esperado].filter((p) => !guardados.has(p)) : [];

    const ok = huerfanos.length === 0 && faltantes.length === 0;
    if (!ok) rolesConProblema++;

    console.log(`\n${ok ? 'OK ' : '>> '} ${rol.nombre} (${rol.permisos.length} guardados${esperado ? ` / ${esperado.size} esperados` : ', rol personalizado'})`);
    if (huerfanos.length > 0) {
      console.log(`   Permisos MUERTOS (no existen en permisos.ts, ningún candado los reconoce): ${huerfanos.join(', ')}`);
    }
    if (faltantes.length > 0) {
      console.log(`   Permisos FALTANTES respecto a la matriz del código: ${faltantes.join(', ')}`);
    }
  }

  console.log(`\n${'─'.repeat(70)}`);
  if (rolesConProblema === 0) {
    console.log('Todos los roles están alineados con src/permisos.ts.');
  } else {
    console.log(`${rolesConProblema} rol(es) desalineados con src/permisos.ts.`);
    console.log('');
    console.log('OJO: `npm run db:seed` NO los arregla — siembra con createMany({skipDuplicates})');
    console.log('y por eso nunca actualiza un rol que ya existe. Hace falta una migración de DATOS');
    console.log('(el patrón que ya usa el proyecto, ver 20260919120100_permisos_medico_de_la_cita)');
    console.log('o ajustarlos a mano desde Administración › Roles.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
