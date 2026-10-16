// Limablue Agenda - prepara la base para la reserva web (lo usa reserva-prueba.ps1).
//   node reserva-servicios.js            → marca los servicios que se muestran (si ninguno está marcado)
//   node reserva-servicios.js llave      → además crea la llave interna con la que la reserva registra la cita
//   node reserva-servicios.js sin-llave  → desactiva la llave interna
// Imprime el resultado en JSON. Necesita DATABASE_URL en el entorno.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const NOMBRE_LLAVE = 'Reserva web (interna)';
// Los mismos de las pruebas del 05-oct (sus variantes ya vienen habilitadas por defecto).
const SERVICIOS_PRUEBA = ['Limpieza Clínica del Pie', 'Curación', 'Evaluación PO', 'Evaluación de Baropodometría'];

(async () => {
  const prisma = new PrismaClient();
  const accion = process.argv[2] || '';
  try {
    if (accion === 'sin-llave' || accion === 'llave') {
      await prisma.apiKey.updateMany({ where: { nombre: NOMBRE_LLAVE, activa: true }, data: { activa: false } });
    }
    if (accion === 'sin-llave') { console.log(JSON.stringify({ ok: true })); return; }

    let llave = null;
    if (accion === 'llave') {
      llave = `lbrw_${crypto.randomBytes(24).toString('base64url')}`;
      await prisma.apiKey.create({ data: { nombre: NOMBRE_LLAVE, keyHash: await bcrypt.hash(llave, 10), scopes: ['appointments:write'] } });
    }
    let servicios = await prisma.servicio.count({ where: { reservaOnline: true, deletedAt: null } });
    if (servicios === 0) {
      const r = await prisma.servicio.updateMany({ where: { nombre: { in: SERVICIOS_PRUEBA }, deletedAt: null }, data: { reservaOnline: true } });
      servicios = r.count;
    }
    console.log(JSON.stringify({ ok: true, servicios, llave }));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
