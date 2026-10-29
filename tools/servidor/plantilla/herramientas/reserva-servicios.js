// Limablue Agenda - prepara la base para la reserva web (lo usa reserva-prueba.ps1).
//   node reserva-servicios.js            → cuenta los servicios que la reserva web ofrece (NO marca ni desmarca ninguno:
//                                          eso se decide en Administración › Reserva web)
//   node reserva-servicios.js llave      → además crea la llave interna con la que la reserva registra la cita
//   node reserva-servicios.js sin-llave  → desactiva la llave interna
//   node reserva-servicios.js llave-chat → crea (y reemplaza la anterior) la llave del CHAT DE WHATSAPP: permiso «reservas:write»,
//                                          solo sirve en /api/v1/integraciones/reservas. Se imprime UNA vez; en la base solo queda su huella.
//   node reserva-servicios.js sin-llave-chat → desactiva la llave del chat
// Imprime el resultado en JSON. Necesita DATABASE_URL en el entorno.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const NOMBRE_LLAVE = 'Reserva web (interna)';
const NOMBRE_LLAVE_CHAT = 'Chat de WhatsApp (reservas)';

(async () => {
  const prisma = new PrismaClient();
  const accion = process.argv[2] || '';
  try {
    if (accion === 'llave-chat' || accion === 'sin-llave-chat') {
      await prisma.apiKey.updateMany({ where: { nombre: NOMBRE_LLAVE_CHAT, activa: true }, data: { activa: false } });
      if (accion === 'sin-llave-chat') { console.log(JSON.stringify({ ok: true })); return; }
      const llaveChat = `lbchat_${crypto.randomBytes(24).toString('base64url')}`;
      await prisma.apiKey.create({ data: { nombre: NOMBRE_LLAVE_CHAT, keyHash: await bcrypt.hash(llaveChat, 10), scopes: ['reservas:write'] } });
      console.log(JSON.stringify({ ok: true, llave: llaveChat }));
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
