/**
 * Diagnóstico rápido de la conexión Microsoft Graph (calendario de las profesionales).
 *
 * Úsalo DESPUÉS de pegar AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET en
 * apps/api/.env, para confirmar que el registro de Entra quedó bien ANTES de crear citas
 * reales. Comprueba, en orden:
 *   1) que las 3 variables estén presentes,
 *   2) que se obtenga un token (client credentials),
 *   3) que el permiso Calendars.ReadWrite funcione leyendo el calendario del buzón dado.
 *
 * Ejecutar (desde apps/api):
 *   npx tsx scripts/test-graph.ts                      → prueba danieldoy@limablue.com
 *   npx tsx scripts/test-graph.ts otrobuzon@limablue.com
 *
 * NO crea ni modifica eventos: solo lee. Si todo sale ✅, el canal Graph está listo.
 */
import 'dotenv/config';

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const buzon = process.argv[2] || 'danieldoy@limablue.com';

async function main(): Promise<void> {
  // 1) Variables presentes
  const faltan = [
    !tenantId && 'AZURE_TENANT_ID',
    !clientId && 'AZURE_CLIENT_ID',
    !clientSecret && 'AZURE_CLIENT_SECRET',
  ].filter(Boolean);
  if (faltan.length) {
    console.error(`❌ Faltan variables en .env: ${faltan.join(', ')}`);
    console.error('   Pégalas (sin el # de comentario) y reintenta.');
    process.exit(1);
  }
  console.log('✅ 1/3  Variables AZURE_* presentes.');

  // 2) Token (client credentials)
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!tokenRes.ok) {
    console.error(`❌ 2/3  No se obtuvo token (${tokenRes.status}): ${await tokenRes.text()}`);
    console.error('   Revisa TENANT_ID / CLIENT_ID / CLIENT_SECRET (¿copiaste el "Valor" del secreto, no el Id?).');
    process.exit(1);
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  console.log('✅ 2/3  Token obtenido correctamente.');

  // 3) Lectura del calendario (verifica Calendars.ReadWrite + consentimiento admin)
  const calRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(buzon)}/calendar`,
    { headers: { Authorization: `Bearer ${access_token}` } },
  );
  if (!calRes.ok) {
    const txt = await calRes.text();
    console.error(`❌ 3/3  No se pudo leer el calendario de ${buzon} (${calRes.status}).`);
    if (calRes.status === 403) console.error('   → Falta el permiso Calendars.ReadWrite o el CONSENTIMIENTO DE ADMIN (paso 4 de la guía).');
    else if (calRes.status === 404) console.error(`   → El buzón ${buzon} no existe en el tenant o no tiene licencia de Exchange.`);
    else console.error(`   → Respuesta: ${txt}`);
    process.exit(1);
  }
  console.log(`✅ 3/3  Calendario de ${buzon} accesible. Graph está LISTO. 🎉`);
  console.log('   Las citas de buzones @limablue.com aparecerán en su calendario en 1-3 s.');
}

main().catch((e) => { console.error('❌ Error inesperado:', e); process.exit(1); });
