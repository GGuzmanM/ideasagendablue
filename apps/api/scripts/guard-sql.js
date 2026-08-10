#!/usr/bin/env node
/**
 * Guardrail anti SQL injection.
 *
 * Falla (exit 1) si aparece `$queryRawUnsafe` o `$executeRawUnsafe` en `src/`. Esos métodos
 * arman la consulta CONCATENANDO strings crudos → vulnerables a inyección SQL. La regla del
 * proyecto es usar SIEMPRE `$queryRaw`...${var}...`` o `Prisma.sql` (parametrizados, seguros).
 *
 * Se corre en `npm run build` (y puede ir en CI / pre-commit). Reemplaza a una regla ESLint
 * porque el repo no tiene ESLint configurado; el efecto es el mismo: bloquea la API peligrosa.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src');
const BANNED = /\$(queryRawUnsafe|executeRawUnsafe)\b/;
const hits = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) {
      fs.readFileSync(p, 'utf8').split('\n').forEach((ln, i) => {
        if (BANNED.test(ln)) hits.push(`${path.relative(ROOT, p)}:${i + 1}:  ${ln.trim()}`);
      });
    }
  }
}
walk(ROOT);

if (hits.length) {
  console.error('\n❌  SQL-injection guard: uso PROHIBIDO de $queryRawUnsafe / $executeRawUnsafe:\n');
  hits.forEach((h) => console.error('   ' + h));
  console.error('\n   Usa  $queryRaw`... ${var} ...`  o  Prisma.sql(...)  (parametrizados). Nunca concatenes strings en la consulta.\n');
  process.exit(1);
}
console.log('✅  SQL-injection guard: sin $queryRawUnsafe / $executeRawUnsafe en src/.');
