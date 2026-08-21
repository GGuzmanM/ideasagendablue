// ─── Guard de arranque de secretos ───────────────────────────────────────────
// El API se NIEGA a levantar si algún secreto de firma está vacío, es demasiado corto,
// es un valor por defecto PÚBLICO conocido, o coincide con otro (deben ser distintos).
// Corre SIEMPRE (no depende de NODE_ENV) → es imposible desplegar a producción con un
// secreto débil o con el placeholder del repo. Usa process.exit(1) para cortar en seco
// (un throw sería atrapado por el handler de uncaughtException de index.ts y la API seguiría viva).

// Valores por defecto/placeholder que jamás deben usarse como secreto real.
const DEFAULTS_PUBLICOS = new Set<string>([
  'limablue-dev-secret-only',
  'limablue-jwt-secret-change-in-production',
  'limablue-confirm-dev-secret-only',
  'change-in-production',
  'changeme',
  'secret',
  'dev-secret',
]);

const MIN_LEN = 32;

// Cada secreto crítico: nombre de la variable y si es obligatorio distinto de JWT_SECRET.
const SECRETOS = [
  { env: 'JWT_SECRET', distintoDeJwt: false },
  { env: 'CONFIRM_TOKEN_SECRET', distintoDeJwt: true },
  { env: 'ARCHIVO_FIRMA_SECRET', distintoDeJwt: true },
] as const;

export function verificarSecretosAlArranque(): void {
  const errores: string[] = [];
  const jwt = process.env.JWT_SECRET;

  for (const { env, distintoDeJwt } of SECRETOS) {
    const val = process.env[env];
    if (!val) {
      errores.push(`${env} no está definido`);
      continue;
    }
    if (DEFAULTS_PUBLICOS.has(val)) {
      errores.push(`${env} usa un valor por defecto PÚBLICO (inseguro) — genera uno propio`);
      continue;
    }
    if (val.length < MIN_LEN) {
      errores.push(`${env} es demasiado corto (${val.length} < ${MIN_LEN} caracteres)`);
      continue;
    }
    if (distintoDeJwt && jwt && val === jwt) {
      errores.push(`${env} no debe ser IGUAL a JWT_SECRET — usa una llave distinta`);
    }
  }

  if (errores.length > 0) {
    console.error(
      '\n🚫 ARRANQUE ABORTADO — secretos inseguros:\n' +
        errores.map((e) => '   • ' + e).join('\n') +
        '\n\nGenera secretos fuertes y DISTINTOS, y ponlos en apps/api/.env:\n' +
        '   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n',
    );
    process.exit(1);
  }
}
