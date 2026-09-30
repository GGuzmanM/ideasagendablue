/**
 * Alta del DERMATÓLOGO Wenceslao Javier Castillo Farneschi (25-sep-2026). Caso EXCEPCIONAL y único.
 *
 *   ENV_FILE=… npx ts-node --transpile-only scripts/alta-dermatologo.ts            → SIMULA (no escribe)
 *   ENV_FILE=… npx ts-node --transpile-only scripts/alta-dermatologo.ts --aplicar  → aplica (idempotente)
 *
 * Mismo patrón que Daniel Doy (dos fichas de la misma persona):
 *  · Ficha de PODOLOGÍA (su columna en la agenda): solo hace «Evaluación Dermatológica» (servicio nuevo de Podología,
 *    30 min). Está en DOS sedes a la vez: Paz Soldán y One — una sola agenda: si se ocupa una hora en una sede, esa
 *    hora queda ocupada en la otra (el sistema cruza las citas por persona, no por sede).
 *    Horario: miércoles 11:00–13:00 y viernes 15:00–18:00.
 *  · Ficha de MÉDICO (CMP 022902) vinculada a su usuario (rol médico): toma sus citas y emite recetas a su nombre.
 *  · Usuario: we.castillo@limablue.com · contraseña = su DNI (09166718) · sedes Paz Soldán y One.
 * Las dos sedes a la vez: una asignación indefinida (Paz Soldán) y otra hasta 2099 (One), porque el índice
 * `asignaciones_sede_una_abierta` permite UNA sola abierta por profesional. No moverlo desde Movimientos.
 */
import '../src/cargarEnv';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/db';
import { fechaDb } from '../src/utils/fechaLima';

const APLICAR = process.argv.includes('--aplicar');
const NOMBRES = 'Wenceslao Javier';
const APELLIDOS = 'Castillo Farneschi';
const CMP = '022902';
const DNI = '09166718';
const CORREO = 'we.castillo@limablue.com';
const DESDE = '2026-09-25';
const SERVICIO = { nombre: 'Evaluación Dermatológica', codigo: 'POD-DERM', duracionMinutos: 30, color: '#9333EA' };
// 0=Dom … 6=Sáb. Solo miércoles y viernes; el resto queda inactivo.
const HORARIO: Record<number, [string, string] | null> = { 0: null, 1: null, 2: null, 3: ['11:00', '13:00'], 4: null, 5: ['15:00', '18:00'], 6: null };

async function main() {
  console.log(APLICAR ? '*** APLICANDO en la base ***' : '(simulación: no se escribe nada)');
  console.log('BD:', (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@'));
  const podo = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Podología' }, select: { id: true } });
  const baro = await prisma.unidadNegocio.findFirst({ where: { nombre: 'Baropodometría' }, select: { id: true } });
  const pazSoldan = await prisma.sede.findFirst({ where: { nombre: 'Paz Soldán' }, select: { id: true } });
  const one = await prisma.sede.findFirst({ where: { nombre: 'One' }, select: { id: true } });
  if (!podo || !baro || !pazSoldan || !one) throw new Error('Falta la unidad Podología/Baropodometría o la sede Paz Soldán/One');

  const hayServicio = await prisma.servicio.findUnique({ where: { codigo: SERVICIO.codigo }, select: { id: true } });
  const hayPodo = await prisma.profesional.findFirst({ where: { nombres: NOMBRES, apellidos: APELLIDOS, tipo: 'podologa', deletedAt: null }, select: { id: true } });
  const hayMedico = await prisma.profesional.findFirst({ where: { nombres: NOMBRES, apellidos: APELLIDOS, tipo: 'medico', deletedAt: null }, select: { id: true } });
  const hayUsuario = await prisma.usuario.findUnique({ where: { email: CORREO }, select: { id: true } });
  console.log(`Servicio «${SERVICIO.nombre}»: ${hayServicio ? 'ya existe' : 'se crea'}`);
  console.log(`Ficha de podología: ${hayPodo ? 'ya existe' : 'se crea'} · Ficha de médico: ${hayMedico ? 'ya existe' : 'se crea'} · Usuario ${CORREO}: ${hayUsuario ? 'ya existe (se actualiza)' : 'se crea'}`);
  if (!APLICAR) { console.log('\nSimulación: no se escribió nada. Para aplicar, agrega --aplicar'); return; }

  const hash = await bcrypt.hash(DNI, 12);
  const r = await prisma.$transaction(async (tx) => {
    const servicio = hayServicio ?? await tx.servicio.create({
      data: { ...SERVICIO, unidadNegocioId: podo.id, activo: true },
      select: { id: true },
    });

    // Ficha de podología (columna en la agenda)
    const fichaPodo = hayPodo ?? await tx.profesional.create({
      data: { nombres: NOMBRES, apellidos: APELLIDOS, tipo: 'podologa', unidadNegocioId: podo.id, colorAvatar: SERVICIO.color, activo: true },
      select: { id: true },
    });
    await tx.competenciaProfesional.upsert({
      where: { profesionalId_servicioId: { profesionalId: fichaPodo.id, servicioId: servicio.id } },
      create: { profesionalId: fichaPodo.id, servicioId: servicio.id, habilitadoDesde: fechaDb(DESDE), activa: true, soloPorSolicitud: false },
      update: { activa: true, soloPorSolicitud: false },
    });
    for (const [dia, h] of Object.entries(HORARIO)) {
      const diaSemana = Number(dia);
      const datos = h ? { horaInicio: h[0], horaFin: h[1], activo: true } : { horaInicio: '08:00', horaFin: '20:00', activo: false };
      await tx.horarioProfesional.upsert({
        where: { profesionalId_diaSemana: { profesionalId: fichaPodo.id, diaSemana } },
        create: { profesionalId: fichaPodo.id, diaSemana, ...datos },
        update: datos,
      });
    }
    // Dos sedes a la vez (la de One con fin lejano: el índice solo admite UNA indefinida por profesional)
    const nota = 'Dermatólogo: atiende en Paz Soldán y One a la vez (caso excepcional). No moverlo desde Movimientos.';
    for (const [sedeId, fin] of [[pazSoldan.id, null], [one.id, fechaDb('2099-12-31')]] as const) {
      const ya = await tx.asignacionSede.findFirst({ where: { profesionalId: fichaPodo.id, sedeId, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb(DESDE) } }] } });
      if (!ya) await tx.asignacionSede.create({ data: { profesionalId: fichaPodo.id, sedeId, fechaInicio: fechaDb(DESDE), fechaFin: fin, activa: true, notas: nota } });
    }

    // Ficha de médico (CMP) + usuario médico vinculado
    const fichaMedico = hayMedico
      ? await tx.profesional.update({ where: { id: hayMedico.id }, data: { colegiatura: CMP, activo: true }, select: { id: true } })
      : await tx.profesional.create({
          data: { nombres: NOMBRES, apellidos: APELLIDOS, tipo: 'medico', unidadNegocioId: baro.id, soloPorSolicitud: true, colegiatura: CMP, activo: true },
          select: { id: true },
        });
    const datosUsuario = { nombre: `${NOMBRES} ${APELLIDOS}`, rol: 'medico' as const, activo: true, deletedAt: null, passwordHash: hash, profesionalId: fichaMedico.id };
    const usuario = hayUsuario
      ? await tx.usuario.update({ where: { id: hayUsuario.id }, data: datosUsuario, select: { id: true } })
      : await tx.usuario.create({ data: { ...datosUsuario, email: CORREO }, select: { id: true } });
    for (const sedeId of [pazSoldan.id, one.id]) {
      await tx.usuarioSede.upsert({ where: { usuarioId_sedeId: { usuarioId: usuario.id, sedeId } }, create: { usuarioId: usuario.id, sedeId }, update: {} });
    }
    await tx.auditLog.create({
      data: {
        accion: 'alta_dermatologo', entidad: 'profesional', entidadId: fichaPodo.id,
        despues: { fichaPodologia: fichaPodo.id, fichaMedico: fichaMedico.id, usuario: CORREO, cmp: CMP, servicio: SERVICIO.nombre, sedes: ['Paz Soldán', 'One'], horario: 'Mié 11:00–13:00 · Vie 15:00–18:00' },
      },
    });
    return { servicio: servicio.id, fichaPodo: fichaPodo.id, fichaMedico: fichaMedico.id, usuario: usuario.id };
  });
  console.log('\nListo:', r);
  console.log(`Usuario: ${CORREO} · contraseña: su DNI (entregar en privado)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
