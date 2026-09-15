// Carga del entorno — debe ser el PRIMER import de index.ts.
// Por defecto carga `.env` (producción). Con ENV_FILE=<archivo> carga ese archivo en su lugar
// (útil para instancias aisladas). Prod-neutral: sin ENV_FILE, comportamiento idéntico.
// Vive en su propio módulo porque en dev (swc) los `import` se ejecutan antes que el cuerpo de
// index.ts: si esto quedaba ahí, Prisma (db.ts) cargaba antes el `.env` por su cuenta y, como
// dotenv no pisa variables ya definidas, ENV_FILE no tenía efecto.
import dotenv from 'dotenv';

dotenv.config(process.env.ENV_FILE ? { path: process.env.ENV_FILE } : undefined);
