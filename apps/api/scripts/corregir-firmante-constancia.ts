/**
 * Corrige quién FIRMA una constancia de atención ya emitida (29-sep-2026): pasa al médico de la cita, con su CMP.
 * Antes la constancia salía a nombre de la podóloga que atendió, en el espacio donde sella el médico. Conserva el
 * número y el código de verificación; el texto no cambia (dice quién atendió). Queda auditado.
 *
 *   npx ts-node --transpile-only scripts/corregir-firmante-constancia.ts --numero 6            → muestra qué haría
 *   npx ts-node --transpile-only scripts/corregir-firmante-constancia.ts --numero 6 --aplicar  → escribe
 */
import '../src/cargarEnv';
import { prisma } from '../src/db';
import { auditEnTx } from '../src/services/audit';

const APLICAR = process.argv.includes('--aplicar');
const numero = Number(process.argv[process.argv.indexOf('--numero') + 1]);

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN (no escribe)'} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0]}»`);
  if (!Number.isInteger(numero) || numero < 1) throw new Error('Indica --numero <N° de constancia>');
  const c = await prisma.constanciaClinica.findUnique({
    where: { numero },
    select: { id: true, tipo: true, estado: true, sedeId: true, emisorProfesionalId: true, emisorNombre: true, emisorRegistro: true, atencion: { select: { citaId: true, cita: { select: { medicoId: true } } } } },
  });
  if (!c || c.estado !== 'emitida') throw new Error(`Constancia ${numero} no encontrada o anulada`);
  if (c.tipo !== 'constancia_atencion') throw new Error('Solo aplica a constancias de atención');
  const medicoId = c.atencion.cita?.medicoId;
  if (!medicoId) throw new Error('La cita no tiene médico asignado: asígnalo primero');
  const m = await prisma.profesional.findUniqueOrThrow({ where: { id: medicoId }, select: { id: true, nombres: true, apellidos: true, colegiatura: true, tipo: true, activo: true } });
  const cmp = (m.colegiatura ?? '').trim();
  if (m.tipo !== 'medico' || !m.activo || !cmp) throw new Error('El médico de la cita no es un médico activo con CMP');
  const nombre = `${m.nombres} ${m.apellidos}`.trim();
  console.log(`Constancia ${String(numero).padStart(5, '0')}: firma «${c.emisorNombre}» → «${nombre}» (CMP ${cmp})`);
  if (!APLICAR) return;
  await prisma.$transaction(async (tx) => {
    await tx.constanciaClinica.update({ where: { id: c.id }, data: { emisorProfesionalId: m.id, emisorNombre: nombre, emisorRegistro: cmp } });
    await auditEnTx(tx, {
      accion: 'corregir_firmante_constancia', entidad: 'constancia', entidadId: c.id, citaId: c.atencion.citaId, sedeId: c.sedeId,
      antes: { emisorProfesionalId: c.emisorProfesionalId, emisorNombre: c.emisorNombre, emisorRegistro: c.emisorRegistro },
      despues: { emisorProfesionalId: m.id, emisorNombre: nombre, emisorRegistro: cmp, motivo: 'La constancia la firma y sella el médico de la cita' },
    });
  });
  console.log('✔ Corregida');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
