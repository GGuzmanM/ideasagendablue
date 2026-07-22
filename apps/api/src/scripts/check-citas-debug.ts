import { PrismaClient } from '@prisma/client';
import { fechaDb } from '../utils/fechaLima';

const prisma = new PrismaClient();

async function testQueryPazSoldan14Julio() {
  const sedeId = 'de18c68d-796a-49b4-a101-ccd43e3a01e5'; // Paz Soldán
  const fechaStr = '2026-07-14';

  console.log(`\n=== SIMULATING BACKEND API QUERY FOR SEDE PAZ SOLDAN ON ${fechaStr} ===`);

  // 1. Query Citas (same logic as GET /api/citas)
  const citas = await prisma.cita.findMany({
    where: {
      sedeId,
      fecha: fechaDb(fechaStr),
      deletedAt: null,
    },
    include: {
      paciente: { select: { id: true, nombres: true, apellidoPaterno: true, apellidoMaterno: true } },
      profesional: { select: { id: true, nombres: true, apellidos: true, colorAvatar: true } },
      solicitadoProfesional: { select: { id: true, nombres: true, apellidos: true, tipo: true } },
      sede: { select: { id: true, nombre: true, color: true } },
      unidadNegocio: { select: { id: true, nombre: true, color: true } },
      servicio: { select: { id: true, nombre: true, duracionMinutos: true, color: true } },
      subcategoria: { select: { id: true, nombre: true } },
    },
    orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
  });

  console.log(`CITAS FOUND FROM API LOGIC: ${citas.length}`);
  citas.forEach((c) => {
    console.log(`- Cita ID: ${c.id}`);
    console.log(`  Paciente: ${c.paciente?.nombres} ${c.paciente?.apellidoPaterno}`);
    console.log(`  ProfesionalId: ${c.profesionalId} (${c.profesional?.nombres} ${c.profesional?.apellidos})`);
    console.log(`  HoraInicio: ${c.horaInicio}`);
    console.log(`  Duración: ${c.duracionMinutos}m`);
  });

  // 2. Query Profesionales (same logic as GET /api/profesionales)
  const fechaDate = new Date(fechaStr + 'T00:00:00');
  fechaDate.setHours(0, 0, 0, 0);

  const asignaciones = await prisma.asignacionSede.findMany({
    where: {
      sedeId,
      fechaInicio: { lte: fechaDate },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDate } }],
    },
    select: { profesionalId: true },
  });

  const idsConCita = new Set<string>();
  const citasDelDia = await prisma.cita.findMany({
    where: {
      sedeId,
      fecha: new Date(fechaStr + 'T12:00:00'),
      deletedAt: null,
      profesionalId: { not: null },
      estado: { notIn: ['cancelada', 'reprogramada'] },
    },
    select: { profesionalId: true },
    distinct: ['profesionalId'],
  });

  for (const c of citasDelDia) if (c.profesionalId) idsConCita.add(c.profesionalId);
  const ids = [...new Set([...asignaciones.map((a) => a.profesionalId), ...[...idsConCita]])];

  const profesionales = await prisma.profesional.findMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      activo: true,
    },
    select: { id: true, nombres: true, apellidos: true, tipo: true },
  });

  console.log(`\nPROFESIONALES FOUND FOR SEDE PAZ SOLDAN (${profesionales.length}):`);
  profesionales.forEach((p) => {
    console.log(`- Prof ID: ${p.id} | ${p.nombres} ${p.apellidos}`);
  });

  console.log('\n=== MATCHING CHECK ===');
  citas.forEach((c) => {
    const pId = c.profesionalId || c.solicitadoProfesional?.id;
    const match = profesionales.find((p) => p.id === pId);
    console.log(`Cita ${c.id} (Paciente: ${c.paciente?.nombres}) -> doctorId: ${pId} -> Matched Doctor Column: ${match ? `${match.nombres} ${match.apellidos}` : 'NOT FOUND IN PROFESIONALES!'}`);
  });
}

testQueryPazSoldan14Julio()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
