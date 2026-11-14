// Limablue Agenda - prepara la base para la reserva web (lo usa reserva-prueba.ps1).
//   node reserva-servicios.js            → cuenta los servicios que la reserva web ofrece (NO marca ni desmarca ninguno:
//                                          eso se decide en Administración › Reserva web)
//   node reserva-servicios.js llave      → además crea la llave interna con la que la reserva registra la cita
//   node reserva-servicios.js sin-llave  → desactiva la llave interna
//   node reserva-servicios.js llave-whatsapp → crea (y reemplaza la anterior) la llave de la API de WHATSAPP: permiso
//                                              «reservas:whatsapp», solo sirve en /api/v1/integraciones/whatsapp.
//   node reserva-servicios.js llave-web      → crea (y reemplaza la anterior) la llave de la API WEB: permiso «reservas:write»,
//                                              solo sirve en /api/v1/integraciones/reservas.
//   node reserva-servicios.js sin-llave-whatsapp | sin-llave-web → desactiva esa llave
//   Las llaves se imprimen UNA vez; en la base solo queda su huella. Se reemplazan por PERMISO, no por nombre: la llave web
//   creada antes del 12-nov-2026 se llama «Chat de WhatsApp (reservas)» pero tiene «reservas:write», así que es la web.
// Imprime el resultado en JSON. Necesita DATABASE_URL en el entorno.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const NOMBRE_LLAVE = 'Reserva web (interna)';
// Llaves de las APIs de integración (routes/reservaChat.ts): nombre, permiso y prefijo.
const LLAVES_API = {
  whatsapp: { nombre: 'API WhatsApp (reservas)', scope: 'reservas:whatsapp', prefijo: 'lbwsp_' },
  web: { nombre: 'API web (reservas)', scope: 'reservas:write', prefijo: 'lbweb_' },
};

(async () => {
  const prisma = new PrismaClient();
  const accion = process.argv[2] || '';
  try {
    const api = /^(sin-)?llave-(whatsapp|web)$/.exec(accion);
    if (api) {
      const l = LLAVES_API[api[2]];
      await prisma.apiKey.updateMany({ where: { scopes: { has: l.scope }, activa: true }, data: { activa: false } });
      if (api[1]) { console.log(JSON.stringify({ ok: true })); return; }
      const llaveApi = `${l.prefijo}${crypto.randomBytes(24).toString('base64url')}`;
      await prisma.apiKey.create({ data: { nombre: l.nombre, keyHash: await bcrypt.hash(llaveApi, 10), scopes: [l.scope] } });
      console.log(JSON.stringify({ ok: true, llave: llaveApi }));
      return;
    }
    if (accion === 'sin-llave' || accion === 'llave') {
      await prisma.apiKey.updateMany({ where: { nombre: NOMBRE_LLAVE, activa: true }, data: { activa: false } });
    }
    if (accion === 'sin-llave') { console.log(JSON.stringify({ ok: true })); return; }

    let llave = null;
    if (accion === 'llave') {
      llave = `lbrw_${crypto.randomBytes(24).toString('base64url')}`;
      await prisma.apiKey.create({ data: { nombre: NOMBRE_LLAVE, keyHash: await bcrypt.hash(llave, 10), scopes: ['appointments:write'] } });
    }
    // Solo se CUENTA: qué servicios se ofrecen en la web lo decide la clínica en Administración › Reserva web (nunca este script).
    const servicios = await prisma.servicio.count({ where: { reservaOnline: true, activo: true, deletedAt: null } });
    console.log(JSON.stringify({ ok: true, servicios, llave }));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
