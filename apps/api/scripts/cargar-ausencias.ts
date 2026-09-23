/**
 * AUSENCIAS DE PLANILLA → bloqueo de la agenda (21-sep-2026).
 * Lee el Excel «Ausencias - planilla» de RR. HH. y registra SOLO las ausencias de DÍA COMPLETO (columna «Días
 * Tomados»): permisos de un día, inasistencias, descansos médicos y subsidios. Las de HORAS no se cargan todavía
 * (pedido del usuario). Se guardan igual que Permisos › Vacaciones: un bloqueo de día completo (08:00–20:00) por
 * día y persona, en la sede donde Movimientos la tiene ese día, con el tipo real de la ausencia en el motivo.
 *
 * Regla dura del sistema (la misma de la pantalla): NO se bloquea un día que ya tiene pacientes agendados con
 * esa persona; ese día se reporta y se salta para que coordinación mueva primero las citas.
 * Re-ejecutable: un día que ya está bloqueado no se duplica.
 *
 *   npx ts-node --transpile-only scripts/cargar-ausencias.ts --archivo="…xlsx"             → SIMULA
 *   npx ts-node --transpile-only scripts/cargar-ausencias.ts --archivo="…xlsx" --aplicar   → registra
 */
import '../src/cargarEnv';
import ExcelJS from 'exceljs';
import { prisma } from '../src/db';

const ARCHIVO = process.argv.find((a) => a.startsWith('--archivo='))?.slice(10);
const APLICAR = process.argv.includes('--aplicar');
if (!ARCHIVO) { console.error('Uso: --archivo="ruta.xlsx" [--aplicar]'); process.exit(2); }

const clave = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-ZÑ ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const ymd = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const diasEntre = (a: string, b: string) => { const out: string[] = []; for (let d = new Date(`${a}T12:00:00Z`); ymd(d) <= b; d = new Date(d.getTime() + 86_400_000)) out.push(ymd(d)); return out; };
const ALIAS: Record<string, string> = { 'CHIUYARE ISABEL MILUSKA VALENCIA': 'CHIYUARE ISABEL MILUSKA VALENCIA' };

async function main() {
  console.log(`${APLICAR ? 'REGISTRANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»\n`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(ARCHIVO!); const ws = wb.worksheets[0]!;
  let filaCab = 0; ws.eachRow((r, i) => { if (!filaCab && String(r.getCell(2).value ?? '').includes('Nombre Completo')) filaCab = i; });
  if (!filaCab) throw new Error('No encuentro la fila de encabezados');
  const profs = await prisma.profesional.findMany({ where: { deletedAt: null, esEquipo: false }, select: { id: true, nombres: true, apellidos: true, activo: true } });
  const porNombre = new Map(profs.map((p) => [clave(`${p.apellidos} ${p.nombres}`), p]));
  const admin = await prisma.usuario.findFirst({ where: { email: 'admin@limablue.pe' }, select: { id: true } });
  let creados = 0, yaEstaban = 0, saltadosPorCitas = 0, deHoras = 0; const avisos: string[] = [];

  for (let i = filaCab + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i); const nombre = String(r.getCell(2).value ?? '').trim(); if (!nombre) continue;
    const tipo = String(r.getCell(5).value ?? '').trim(); const licencia = String(r.getCell(6).value ?? '').trim();
    const ini = ymd(r.getCell(7).value); const fin = ymd(r.getCell(8).value); const diasTomados = r.getCell(9).value; const horas = r.getCell(10).value; const estado = String(r.getCell(12).value ?? '');
    const etiqueta = `${nombre} · ${licencia || tipo} · ${ini}${fin !== ini ? ' → ' + fin : ''}`;
    if (!diasTomados) { deHoras++; console.log(`  · ${etiqueta}: es de HORAS (${Number(horas ?? 0).toFixed(1)} h) → no se carga todavía`); continue; }
    if (!/aprobad/i.test(estado)) { avisos.push(`${etiqueta}: estado «${estado}» (no aprobado) → no se carga`); continue; }
    const k = clave(nombre); const p = porNombre.get(ALIAS[k] ?? k);
    if (!p) { avisos.push(`${etiqueta}: la persona no está registrada en el sistema → se salta`); continue; }
    const motivo = `${licencia || tipo} (planilla RR. HH.)`.slice(0, 200);
    const hechos: string[] = []; const conCitas: string[] = []; const repetidos: string[] = []; const sinSede: string[] = [];

    for (const dia of diasEntre(ini, fin)) {
      if (new Date(`${dia}T12:00:00Z`).getUTCDay() === 0) continue; // domingo: la clínica no atiende
      const dIni = new Date(`${dia}T00:00:00.000Z`), dFin = new Date(`${dia}T23:59:59.999Z`), dMed = new Date(`${dia}T12:00:00.000Z`);
      const ya = await prisma.bloqueoAgenda.findFirst({ where: { profesionalId: p.id, deletedAt: null, esRecurrente: false, tipo: 'PERMISO', fechaInicio: { gte: dIni, lte: dFin }, OR: [{ esVacaciones: true }, { esEnfermedad: true }] }, select: { id: true } });
      if (ya) { repetidos.push(dia); continue; }
      const citas = await prisma.cita.count({ where: { OR: [{ profesionalId: p.id }, { solicitadoProfesionalId: p.id }], fecha: dMed, deletedAt: null, estado: { in: ['agendada', 'confirmada', 'llego', 'en_atencion'] } } });
      if (citas) { conCitas.push(`${dia} (${citas} cita${citas > 1 ? 's' : ''})`); continue; }
      const asig = await prisma.asignacionSede.findFirst({ where: { profesionalId: p.id, fechaInicio: { lte: dMed }, OR: [{ fechaFin: null }, { fechaFin: { gte: dMed } }] }, orderBy: { fechaInicio: 'desc' }, select: { sedeId: true } });
      if (!asig) { sinSede.push(dia); continue; }
      hechos.push(dia);
      if (APLICAR) await prisma.bloqueoAgenda.create({ data: { profesionalId: p.id, sedeId: asig.sedeId, tipo: 'PERMISO', esRecurrente: false, esVacaciones: true, horaInicio: '08:00', horaFin: '20:00',
        fechaInicio: new Date(`${dia}T08:00:00.000Z`), fechaFin: new Date(`${dia}T20:00:00.000Z`), motivo, creadoPor: admin?.id } });
    }
    creados += hechos.length; yaEstaban += repetidos.length; saltadosPorCitas += conCitas.length;
    console.log(`  ${APLICAR ? '✔' : '+'} ${etiqueta}: ${hechos.length} día(s) bloqueado(s)${repetidos.length ? ` · ${repetidos.length} ya estaban` : ''}`);
    if (conCitas.length) avisos.push(`${etiqueta}: NO se bloqueó ${conCitas.join(', ')} porque tiene pacientes agendados → mover esas citas y volver a correr`);
    if (sinSede.length) avisos.push(`${etiqueta}: sin sede en Movimientos el ${sinSede.join(', ')} → no se bloqueó`);
  }
  console.log(`\n${APLICAR ? 'Registrados' : 'Se registrarían'}: ${creados} días · ya estaban: ${yaEstaban} · saltados por tener citas: ${saltadosPorCitas} · ausencias de horas (pendientes): ${deHoras}`);
  if (avisos.length) console.log('\nAVISOS:\n  ' + avisos.join('\n  '));
  if (!APLICAR) console.log('\nNada se escribió. Para registrarlo: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
