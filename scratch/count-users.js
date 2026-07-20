const { PrismaClient } = require('@prisma/client');
const path = require('path');

// Load env variables manually if needed, PrismaClient reads process.env.DATABASE_URL
require('dotenv').config({ path: path.join(__dirname, '../apps/api/.env') });

const prisma = new PrismaClient();

async function main() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  try {
    const userCount = await prisma.usuario.count();
    console.log('Total users in DB:', userCount);
    if (userCount > 0) {
      const users = await prisma.usuario.findMany({ select: { email: true, rol: true } });
      console.log('Users in DB:', users);
    }
  } catch (err) {
    console.error('Error connecting to DB or counting users:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
