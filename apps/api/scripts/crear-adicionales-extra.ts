/**
 * Agrega una columna «Adicional» MÁS en cada sede (26-sep-2026, pedido del usuario), menos en Paz Soldán, que ya tiene
 * dos. Cada nueva es un CLON del Adicional que la sede ya tiene: mismo tipo/unidad/color, mismos servicios habilitados,
 * mismo horario por día y sede base desde hoy (sin fin). Se llama igual con « 2» al final (ej. «Adicional LO 2»).
 * Es idempotente: si la sede ya tiene su «… 2», no hace nada.
 *
 *   npx ts-node --transpile-only scripts/crear-adicionales-extra.ts            → muestra qué haría
 *   npx ts-node --transpile-only scripts/crear-adicionales-extra.ts --aplicar  → escribe
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';
import { esFichaAdicional } from '../src/utils/fichaAdicional';
import { fijarSedeBaseEnTx } from '../src/services/asignacionService';
import { auditEnTx } from '../src/services/audit';
import { hoyLimaStr, fechaDb } from '../src/utils/fechaLima';

const APLICAR = process.argv.includes('--aplicar');
const EXCLUIR = /paz\s*sold/i; // Paz Soldán ya tiene 2 Adicionales

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»\n`);
  const hoy = fechaDb(hoyLimaStr());
  const sedes = await prisma.sede.findMany({ where: { activa: true }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } });
  for (const sede of sedes) {
    if (EXCLUIR.test(sede.nombre)) { console.log(`· ${sede.nombre}: se omite (ya tiene 2).`); continue; }
    // Adicionales vigentes en la sede (asignación abierta hoy).
    const asign = await prisma.asignacionSede.findMany({
      where: { sedeId: sede.id, fechaInicio: { lte: hoy }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoy } }], profesional: { deletedAt: null, activo: true } },
      select: { profesional: { select: { id: true, nombres: true, apellidos: true, tipo: true, unidadNegocioId: true, colorAvatar: true, esEquipo: true } } },
    });
    const adicionales = [...new Map(asign.map((a) => [a.profesional.id, a.profesional])).values()]
      .filter((p) => esFichaAdicional(p.nombres) && !p.esEquipo)
      .sort((a, b) => a.apellidos.localeCompare(b.apellidos));
    if (!adicionales.length) { console.log(`· ${sede.nombre}: no tiene Adicional que copiar — se omite.`); continue; }
    if (adicionales.length >= 2) { console.log(`· ${sede.nombre}: ya tiene ${adicionales.length} (${adicionales.map((p) => `${p.nombres} ${p.apellidos}`).join(', ')}) — nada que hacer.`); continue; }
    const base = adicionales[0]!;
    const apellidos = `${base.apellidos.trim()} 2`;
    const competencias = await prisma.competenciaProfesional.findMany({ where: { profesionalId: base.id, activa: true }, select: { servicioId: true, soloPorSolicitud: true } });
    const horarios = await prisma.horarioProfesional.findMany({ where: { profesionalId: base.id }, select: { diaSemana: true, horaInicio: true, horaFin: true, turno: true, activo: true }, orderBy: { diaSemana: 'asc' } });
    console.log(`· ${sede.nombre}: crear «Adicional ${apellidos}» copiando «${base.nombres} ${base.apellidos}» → ${competencias.length} servicios, ${horarios.length} días de horario`);
    if (!APLICAR) continue;
    await prisma.$transaction(async (tx) => {
      const p = await tx.profesional.create({
        data: { nombres: 'Adicional', apellidos, tipo: base.tipo, unidadNegocioId: base.unidadNegocioId, colorAvatar: base.colorAvatar, activo: true },
      });
      await fijarSedeBaseEnTx(tx, { profesionalId: p.id, sedeId: sede.id });
      if (competencias.length) await tx.competenciaProfesional.createMany({ data: competencias.map((c) => ({ profesionalId: p.id, servicioId: c.servicioId, soloPorSolicitud: c.soloPorSolicitud, activa: true, habilitadoDesde: hoy })) });
      if (horarios.length) await tx.horarioProfesional.createMany({ data: horarios.map((h) => ({ profesionalId: p.id, ...h })) });
      await auditEnTx(tx, {
        accion: 'crear', entidad: 'profesional', entidadId: p.id, sedeId: sede.id,
        despues: { nombres: p.nombres, apellidos: p.apellidos, tipo: p.tipo, copiaDe: base.id, servicios: competencias.length, horarios: horarios.length, origen: 'scripts/crear-adicionales-extra.ts' },
      });
      console.log(`    ✔ creada (${p.id})`);
    });
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
