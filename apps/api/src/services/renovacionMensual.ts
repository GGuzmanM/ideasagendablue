import { prisma } from '../db';

// ─── Auto-renovación mensual de asignaciones ─────────────────────────────────────
// Al cambiar de mes, el personal CONTINÚA en su misma sede salvo que lo hayan movido o dado de
// baja. Un arrastre/asignación fija `fechaFin` = fin de mes (ver MovimientosPage); este job, al
// entrar el mes nuevo (o al arrancar el server si se lo perdió), crea el periodo del mes actual
// [1° … fin de mes] en la ÚLTIMA sede conocida de cada persona.
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

export async function renovarAsignacionesMensuales(): Promise<{ renovadosBaro: number; renovadosRecep: number; mes: string }> {
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
      data: { profesionalId: profId, sedeId: ult.sedeId, activa: true, fechaInicio: baroIni, fechaFin: baroFin, motivo: null },
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
      data: { sedeId: ult.sedeId, recepcionistaId: recId, fechaInicio: recIni, fechaFin: recFin, notas: 'Renovación automática' },
    });
    renovadosRecep++;
  }

  return { renovadosBaro, renovadosRecep, mes: `${Y}-${pad(M)}` };
}

// Arranca el job: corre ahora (catch-up) y luego cada 12 h (idempotente; cubre el cambio de mes).
export function iniciarRenovacionMensual() {
  const correr = () =>
    renovarAsignacionesMensuales()
      .then((r) => {
        if (r.renovadosBaro || r.renovadosRecep)
          console.log(`[renovacion-mensual] ${r.mes}: baro=${r.renovadosBaro}, recepción=${r.renovadosRecep} renovados`);
      })
      .catch((e) => console.error('[renovacion-mensual] error:', e?.message ?? e));
  correr();
  setInterval(correr, 12 * 60 * 60 * 1000);
}
