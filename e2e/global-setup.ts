// Global setup: valida las GUARDAS del entorno aislado y asegura el catálogo sembrado.
// Solo toca la BD e2e, independiente de los webServers que arranca Playwright.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { E2E_DB_NAME, E2E_REDIS_DB } from './fixtures/db';

export default async function globalSetup() {
  console.log(`[e2e] guardas OK → BD=${E2E_DB_NAME} · Redis db=${E2E_REDIS_DB}`);

  const apiDir = path.resolve(__dirname, '../apps/api');
  const envContent = readFileSync(path.join(apiDir, '.env.e2e'), 'utf8');
  const dbUrlMatch = envContent.match(/^DATABASE_URL="?([^"\n]*)"?/m);
  const dbUrl = dbUrlMatch ? dbUrlMatch[1] : '';

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  let nSedes = 0;
  try {
    nSedes = await prisma.sede.count({ where: { deletedAt: null } });
  } catch {
    nSedes = 0;
  } finally {
    await prisma.$disconnect();
  }

  if (nSedes === 0) {
    console.log('[e2e] catálogo vacío → sembrando (db:seed)…');
    execSync('npx cross-env ENV_FILE=.env.e2e FORCE_SEED=true npx ts-node --transpile-only prisma/seed.ts', {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: dbUrl, FORCE_SEED: 'true' },
      stdio: 'inherit',
    });
  } else {
    console.log(`[e2e] catálogo presente (${nSedes} sedes) — no se re-siembra.`);
  }

  // Canales de reserva
  const prisma2 = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  try {
    const nCanales = await prisma2.canal.count({ where: { deletedAt: null } });
    if (nCanales === 0) {
      await prisma2.canal.createMany({
        data: [
          { valor: 'recepcion', etiqueta: 'Recepción', activo: true, orden: 0 },
          { valor: 'web', etiqueta: 'Chat WEB', activo: true, orden: 1 },
          { valor: 'whatsapp', etiqueta: 'WhatsApp', activo: true, orden: 2 },
        ],
      });
      console.log('[e2e] canales sembrados (recepcion/web/whatsapp).');
    }
  } finally {
    await prisma2.$disconnect();
  }
}
