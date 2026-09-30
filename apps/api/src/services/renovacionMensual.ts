import { prisma } from '../db';

// ─── Auto-renovación mensual de asignaciones ─────────────────────────────────────
// Al cambiar de mes, el personal CONTINÚA en su misma sede salvo que lo hayan movido o dado de
// baja. Desde el 24-sep-2026 los arrastres y altas de recepción y doctores quedan SIN fecha de fin
// (siguen hasta que alguien los cambie a mano), así que este job es solo una RED DE SEGURIDAD para
// periodos viejos que terminaban a fin de mes: al entrar el mes nuevo los continúa, ya sin fin.
//
// Es IDEMPOTENTE (si ya existe cobertura del mes, no duplica) y hace CATCH-UP (si el server estuvo
// caído varios meses, restaura la cobertura del mes ACTUAL — los meses pasados sin citas no importan).
// NO renueva a quien:
//   · esté de baja (profesional/recepcionista inactivo o eliminado),
//   · haya sido quitado con la ✕ (su periodo quedó activa=false → no es candidato),
//   · tenga como último periodo uno NO mensual (one-off que no termina en fin de mes),
//   · ya tenga cobertura del mes (movido/renovado a mano).

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ymdLima = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// ¿La fecha (YYYY-MM-DD) es el último día de su mes?
function esFinDeMes(ymdStr: string): boolean {
  const [y, m, d] = ymdStr.split('-').map(Number);
  return d === new Date(y, m, 0).getDate();
}

const esMaquinaBaro = (nombres: string, apellidos: string) => /^baro\s*\d+$/i.test(`${nombres} ${apellidos}`.trim());

export async function renovarAsignacionesMensuales(): Promise<{ renovadosBaro: number; renovadosRecep: number; renovadosAlmuerzo: number; mes: string }> {
  const hoyStr = ymdLima(new Date());
  const [Y, M] = hoyStr.split('-').map(Number);
  const mesIniStr = `${Y}-${pad(M)}-01`;
  const finDia = new Date(Y, M, 0).getDate();
  const mesFinStr = `${Y}-${pad(M)}-${pad(finDia)}`;

  let renovadosBaro = 0;
  let renovadosRecep = 0;

  // ── BARO (baro_medico_sede, DateTime local) ──
  const baroIni = new Date(`${mesIniStr}T00:00:00`);
  const baroFin = new Date(`${mesFinStr}T00:00:00`);
  // Traemos TODOS los periodos (incluidos activa=false) de profesionales NO dados de baja, ordenados
  // por fechaInicio desc: el 1° de cada profesional es su ESTADO ACTUAL. Incluir los inactivos es
  // clave: si su último periodo fue quitado (✕ → activa=false), NO debe renovarse (no resucitar).
  const periodosBaro = await prisma.baroMedicoSede.findMany({
    where: { profesional: { activo: true, deletedAt: null } },
    select: {
      profesionalId: true, sedeId: true, activa: true, fechaInicio: true, fechaFin: true,
      profesional: { select: { nombres: true, apellidos: true } },
    },
    orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
  });
  const ultimoBaro = new Map<string, (typeof periodosBaro)[number]>();
  for (const p of periodosBaro) if (!ultimoBaro.has(p.profesionalId)) ultimoBaro.set(p.profesionalId, p); // 1° = fechaInicio más reciente

  for (const [profId, ult] of ultimoBaro) {
    if (!ult.activa) continue;                                                          // su último periodo fue quitado (✕) → no resucitar
    if (ult.fechaFin === null) continue;                                               // indefinido → no necesita renovación
    if (esMaquinaBaro(ult.profesional.nombres, ult.profesional.apellidos)) continue;   // máquina, no doctor
    const finStr = ymd(ult.fechaFin);
    if (finStr >= mesIniStr) continue;                                                 // aún vigente este mes o futuro
    if (!esFinDeMes(finStr)) continue;                                                 // one-off, no era mensual
    const cubre = await prisma.baroMedicoSede.count({
      where: { profesionalId: profId, activa: true, fechaInicio: { lte: baroIni }, OR: [{ fechaFin: null }, { fechaFin: { gte: baroIni } }] },
    });
    if (cubre > 0) continue;                                                            // ya movido/renovado a mano
    await prisma.baroMedicoSede.create({
      data: { profesionalId: profId, sedeId: ult.sedeId, activa: true, fechaInicio: baroIni, fechaFin: null, motivo: null }, // sin fin: ya no se renueva cada mes
    });
    renovadosBaro++;
  }

  // ── RECEPCIÓN (asignaciones_administrativas, @db.Date = medianoche UTC) ──
  const recIni = new Date(mesIniStr);
  const recFin = new Date(mesFinStr);
  // Igual que baro: la asignación más reciente por fechaInicio (incluidas las borradas) es el estado
  // actual. Si su última fue quitada (deletedAt), no se renueva → no resucita en la sede vieja.
  const asigsRecep = await prisma.asignacionAdministrativa.findMany({
    where: { recepcionistaId: { not: null }, recepcionista: { deletedAt: null } },
    select: { sedeId: true, recepcionistaId: true, deletedAt: true, fechaInicio: true, fechaFin: true },
    orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
  });
  const ultimoRecep = new Map<string, (typeof asigsRecep)[number]>();
  for (const a of asigsRecep) if (a.recepcionistaId && !ultimoRecep.has(a.recepcionistaId)) ultimoRecep.set(a.recepcionistaId, a);

  for (const [recId, ult] of ultimoRecep) {
    if (ult.deletedAt) continue;                                                        // su última asignación fue quitada → no resucitar
    if (ult.fechaFin === null) continue;                                               // indefinida → no necesita renovación
    const finStr = ymd(ult.fechaFin);
    if (finStr >= mesIniStr) continue;
    if (!esFinDeMes(finStr)) continue;
    const cubre = await prisma.asignacionAdministrativa.count({
      where: { recepcionistaId: recId, deletedAt: null, fechaInicio: { lte: recIni }, OR: [{ fechaFin: null }, { fechaFin: { gte: recIni } }] },
    });
    if (cubre > 0) continue;
    await prisma.asignacionAdministrativa.create({
      data: { sedeId: ult.sedeId, recepcionistaId: recId, fechaInicio: recIni, fechaFin: null, notas: 'Renovación automática (sin fin)' },
    });
    renovadosRecep++;
  }

  // ── ALMUERZOS (bloqueos_agenda tipo ALMUERZO recurrente, vigentes «hasta fin de mes») ──
  // Sin esto, el día 1 TODAS las podólogas amanecían sin almuerzo y la franja quedaba agendable.
  // Mismo criterio: manda el ÚLTIMO almuerzo recurrente de cada profesional (incluidos los borrados:
  // si lo quitaron, no resucita); solo se renueva el que terminó justo a fin de mes, y en la sede
  // donde la persona está HOY (si la movieron de sede, el almuerzo la acompaña).
  // 28-sep-2026 (pedido de la clínica): el almuerzo se ve siempre hasta el fin del MES SIGUIENTE. El vigente que termina a
  // fin de este mes se ALARGA (no espera al día 1) para que la agenda del mes que viene ya lo muestre y bloquee.
  let renovadosAlmuerzo = 0;
  const almIni = new Date(`${mesIniStr}T00:00:00.000Z`);
  const finSig = new Date(Y, M + 1, 0).getDate();
  const [YS, MS] = M === 12 ? [Y + 1, 1] : [Y, M + 1];
  const horizonteStr = `${YS}-${pad(MS)}-${pad(finSig)}`;
  const almFin = new Date(`${horizonteStr}T23:59:59.999Z`);
  const hoyDb = new Date(`${hoyStr}T12:00:00.000Z`);
  const almuerzos = await prisma.bloqueoAgenda.findMany({
    where: { tipo: 'ALMUERZO', esRecurrente: true, profesional: { activo: true, deletedAt: null } },
    select: { id: true, profesionalId: true, sedeId: true, deletedAt: true, fechaFin: true, horaInicio: true, horaFin: true, duracionMin: true, motivo: true },
    orderBy: [{ fechaInicio: 'desc' }, { creadoEn: 'desc' }],
  });
  const almuerzosPorProf = new Map<string, (typeof almuerzos)[number][]>();
  for (const a of almuerzos) almuerzosPorProf.set(a.profesionalId, [...(almuerzosPorProf.get(a.profesionalId) ?? []), a]);
  for (const [profId, lista] of almuerzosPorProf) {
    const sedeHoy = await prisma.asignacionSede.findFirst({
      where: { profesionalId: profId, fechaInicio: { lte: hoyDb }, OR: [{ fechaFin: null }, { fechaFin: { gte: hoyDb } }] },
      orderBy: { fechaInicio: 'desc' }, select: { sedeId: true },
    });
    if (!sedeHoy) continue;
    // 24-sep-2026: manda el último almuerzo de la sede donde está HOY; uno que quedó en otra sede (p. ej. puesto por
    // error) ya no dicta la hora del mes siguiente. Si no tiene ninguno en su sede, el último que haya (se mudó).
    const ult = lista.find((a) => a.sedeId === sedeHoy.sedeId) ?? lista[0]!;
    if (ult.deletedAt || !ult.horaInicio || !ult.horaFin) continue;
    const finStr = ymd(ult.fechaFin);
    if (finStr >= horizonteStr || !esFinDeMes(finStr)) continue;                     // ya llega al horizonte / no era mensual
    if (finStr >= mesIniStr) {
      // Vigente y termina a fin de este mes: se alarga hasta el horizonte (solo el de la sede donde está hoy).
      if (ult.sedeId !== sedeHoy.sedeId) continue;
      await prisma.bloqueoAgenda.update({ where: { id: ult.id }, data: { fechaFin: almFin } });
      renovadosAlmuerzo++;
      continue;
    }
    const cubre = await prisma.bloqueoAgenda.count({
      where: { profesionalId: profId, tipo: 'ALMUERZO', deletedAt: null, fechaFin: { gte: almIni }, OR: [{ sedeId: null }, { sedeId: sedeHoy.sedeId }] },
    });
    if (cubre > 0) continue;
    await prisma.bloqueoAgenda.create({
      data: {
        profesionalId: profId, sedeId: sedeHoy.sedeId, tipo: 'ALMUERZO', esRecurrente: true, horaInicio: ult.horaInicio, horaFin: ult.horaFin,
        duracionMin: ult.duracionMin, motivo: ult.motivo, fechaInicio: almIni, fechaFin: almFin,
      },
    });
    renovadosAlmuerzo++;
  }

  return { renovadosBaro, renovadosRecep, renovadosAlmuerzo, mes: `${Y}-${pad(M)}` };
}

// Arranca el job: corre ahora (catch-up) y luego cada 15 min (idempotente; cubre el cambio de mes).
export function iniciarRenovacionMensual() {
  const correr = () =>
    renovarAsignacionesMensuales()
      .then((r) => {
        if (r.renovadosBaro || r.renovadosRecep || r.renovadosAlmuerzo)
          console.log(`[renovacion-mensual] ${r.mes}: baro=${r.renovadosBaro}, recepción=${r.renovadosRecep}, almuerzos=${r.renovadosAlmuerzo} renovados`);
      })
      .catch((e) => console.error('[renovacion-mensual] error:', e?.message ?? e));
  correr();
  // Cada 15 min (antes 12 h): el día 1 a las 00:00 nadie debe quedarse horas sin sede. Las recepcionistas
  // derivan su ACCESO de esta asignación: con 12 h de espera podían no poder entrar la mañana del 1°.
  setInterval(correr, 15 * 60 * 1000);
}
