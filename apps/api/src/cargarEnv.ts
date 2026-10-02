// Carga del entorno — debe ser el PRIMER import de index.ts.
// Por defecto carga `.env` (producción). Con ENV_FILE=<archivo> carga ese archivo en su lugar
// (útil para instancias aisladas). Prod-neutral: sin ENV_FILE, comportamiento idéntico.
// Vive en su propio módulo porque en dev (swc) los `import` se ejecutan antes que el cuerpo de
// index.ts: si esto quedaba ahí, Prisma (db.ts) cargaba antes el `.env` por su cuenta y, como
// dotenv no pisa variables ya definidas, ENV_FILE no tenía efecto.
import fs from 'fs';
import dotenv from 'dotenv';

// 30-sep-2026: si ENV_FILE apunta a un archivo que NO existe, dotenv no dice nada y luego Prisma carga el
// `.env` real → una instancia «de pruebas» corría sus tareas de fondo contra la BD real. Ahora se detiene.
if (process.env.ENV_FILE && !fs.existsSync(process.env.ENV_FILE)) {
  console.error(`[env] ENV_FILE=${process.env.ENV_FILE} no existe: no se arranca (evita usar el .env real por error).`);
  process.exit(1);
}

dotenv.config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);
