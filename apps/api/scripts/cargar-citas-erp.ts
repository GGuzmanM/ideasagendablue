/**
 * CARGA DE CITAS DESDE LA LISTA DEL SISTEMA ANTERIOR (21-sep-2026).
 * TSV: empresa-sede · hora · paciente · profesional · tratamiento · canal · estado · comentario · folio.
 *
 *   npx ts-node --transpile-only scripts/cargar-citas-erp.ts --archivo="…tsv" --fecha=AAAA-MM-DD                       → ANALIZA (no escribe)
 *   ENV_FILE=…carga.env npx ts-node … --archivo=… --fecha=… --aplicar --api=http://localhost:3005 [--informe="…txt"]   → CARGA
 *
 * La cita se crea POR EL API (mismas reglas que recepción: turno, almuerzo, solape, competencia…). El API de carga debe
 * correr con MAIL_DRY_RUN=true y RECORDATORIOS/VIDEOS apagados para que ningún paciente reciba correos de esta carga.
 *
 * Reglas dadas por el usuario:
 *  · La SEDE es el número con que empieza el profesional (1 Paz Soldán · 2 Lince · 3 Los Olivos · 4 San Miguel · 5 One);
 *    la 1ª columna es la empresa. Si el comentario dice «CITA EN ONE» (o en otra sede), manda el comentario.
 *  · «Baropodometría <sede>» = la máquina Baro 1 de esa sede, servicio «Evaluación de Baropodometría».
 *  · Paciente: el que coincide; si hay varios, el MÁS CERCANO; si no existe, se CREA solo con su nombre (documento y
 *    teléfono provisionales, marcado «requiere actualizar datos») para no frenar la agenda.
 *  · «… Sesion 7» → subcategoría «Sesión 7» del servicio; si no existe, se crea EN ORDEN (1…12).
 *  · Anuladas en el ERP no se cargan. Re-ejecutable: la llave de idempotencia es el folio + fila.
 */
import '../src/cargarEnv';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { prisma } from '../src/db';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ARCHIVO = arg('archivo'); const FECHA = arg('fecha'); const API = arg('api'); const INFORME = arg('informe');
const APLICAR = process.argv.includes('--aplicar');
if (!ARCHIVO || !FECHA || !/^\d{4}-\d{2}-\d{2}$/.test(FECHA) || (APLICAR && !API)) { console.error('Uso: --archivo="ruta.tsv" --fecha=AAAA-MM-DD [--aplicar --api=http://localhost:3005] [--informe="ruta.txt"]'); process.exit(2); }

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-zñ0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
const SEDE_POR_PREFIJO: Record<string, string> = { '1': 'Paz Soldán', '2': 'Lince', '3': 'Los Olivos', '4': 'San Miguel', '5': 'One' };
const CANAL: Record<string, string> = { 'recepcion': 'recepcion', 'central telefonica': 'central_telefonica', 'whatsapp': 'whatsapp', 'administracion directo': 'administracion_directo' };
const SESIONES_LASER = 12;

function mapearServicio(t: string): { codigo: string; sub?: string; nota?: string } | null {
  const n = norm(t); let m: RegExpExecArray | null;
  if (/^limpieza clinica del pie/.test(n)) return { codigo: 'POD-PRO', sub: /adulto mayor/.test(n) ? 'Adulto mayor' : /premium/.test(n) ? 'Premium' : /infantil/.test(n) ? 'Infantil' : /diabet/.test(n) ? 'Pie Diabético' : 'Regular' };
  if (/membres.*evaluacion de la pisada/.test(n)) return { codigo: 'BAR-COMP', nota: 'MEMBRESÍA (evaluación de la pisada)' };
  if (/profi regular|profilaxis/.test(n)) return { codigo: 'POD-PRO', sub: 'Regular', nota: /membres/.test(n) ? `MEMBRESÍA: ${t}` : `Convenio: ${t}` };
  if (/^membresias .* sesion/.test(n)) return { codigo: 'POD-PRO', sub: 'Regular', nota: `MEMBRESÍA: ${t}` };
  if (/laserterapia p12 onicomicosis/.test(n)) return { codigo: 'LASER_DE_ALTA_HONGOS', sub: (m = /sesion (\d+)/.exec(n)) ? `Sesión ${m[1]}` : undefined };
  if (/laserterapia sesion individual/.test(n)) return { codigo: 'POD-LASER' };
  if (/^matricectomia/.test(n)) return { codigo: 'MATRISECTOMIA', sub: (m = /curacion (\d+)/.exec(n)) ? `Curación ${m[1]}` : 'Base' };
  if (/^extraccion de una/.test(n)) return { codigo: 'POD-LCP-PRE', sub: (m = /curacion (\d+)/.exec(n)) ? `Curación ${m[1]}` : 'Extracción de Uña' };
  if (/evaluacion de la pisada/.test(n)) return { codigo: 'BAR-COMP' };
  if (/^fisioterapia p12/.test(n)) return { codigo: 'FIS-03', sub: (m = /sesion (\d+)/.exec(n)) ? `Sesión ${m[1]}` : undefined };
  if (/evaluacion de fisioterapia/.test(n)) return { codigo: 'FIS-SES' };
  if (n === 'evaluacion') return { codigo: 'POD-CPO' };
  return null;
}

type Pac = { id: string; nombres: string; apellidoPaterno: string; apellidoMaterno: string | null; numeroDocumento: string | null };
/** Exacto → el más cercano (todas las palabras del nombre y el 1er apellido coinciden; gana el que comparte más) → null. */
async function buscarPaciente(crudo: string): Promise<{ pac?: Pac; como: string; ape: string[]; nom: string[] }> {
  const [apeCrudo, nomCrudo = ''] = crudo.split(/,(?!,)/).map((x) => x.replace(/,/g, ' '));
  const ape = norm(apeCrudo ?? '').split(' ').filter(Boolean); const nom = norm(nomCrudo).split(' ').filter(Boolean);
  if (!ape.length || !nom.length) return { como: 'nombre ilegible', ape, nom };
  const pliega = (col: string) => `translate(lower(${col}), 'áéíóúüàèìòù', 'aeiouuaeiou')`;
  const filas = await prisma.$queryRawUnsafe<Pac[]>(
    `SELECT id, nombres, "apellidoPaterno", "apellidoMaterno", "numeroDocumento" FROM pacientes WHERE "deletedAt" IS NULL AND ${pliega('"apellidoPaterno"')} LIKE $1 AND ${pliega('nombres')} LIKE $2 LIMIT 80`,
    `${ape[0]}%`, `%${nom[0]}%`);
  const tokA = (p: Pac) => norm(`${p.apellidoPaterno} ${p.apellidoMaterno ?? ''}`).split(' '); const tokN = (p: Pac) => norm(p.nombres).split(' ');
  const exactos = filas.filter((p) => ape.every((w) => tokA(p).includes(w)) && nom.every((w) => tokN(p).includes(w)));
  if (exactos.length === 1) return { pac: exactos[0], como: 'coincide', ape, nom };
  // Más cercano: mismo 1er apellido y TODOS los nombres; se puntúa por apellidos compartidos y por no tener palabras de más.
  const cerca = (exactos.length ? exactos : filas.filter((p) => tokA(p)[0] === ape[0] && nom.every((w) => tokN(p).includes(w)) && (ape.length < 2 || tokA(p).includes(ape[1]!))))
    .map((p) => ({ p, pts: ape.filter((w) => tokA(p).includes(w)).length * 3 - Math.abs(tokN(p).length - nom.length) - Math.abs(tokA(p).length - ape.length) }))
    .sort((a, b) => b.pts - a.pts);
  if (cerca.length && (cerca.length === 1 || cerca[0]!.pts > cerca[1]!.pts)) return { pac: cerca[0]!.p, como: `el más cercano de ${cerca.length} (${cerca[0]!.p.apellidoPaterno} ${cerca[0]!.p.apellidoMaterno ?? ''}, ${cerca[0]!.p.nombres})`, ape, nom };
  return { como: cerca.length ? `${cerca.length} parecidos sin uno claramente más cercano` : 'no existe', ape, nom };
}

async function main() {
  const fechaDb = new Date(`${FECHA}T12:00:00.000Z`); const out: string[] = []; const log = (s = '') => { console.log(s); out.push(s); };
  log(`${APLICAR ? 'CARGANDO' : 'ANÁLISIS (no escribe)'} · ${FECHA} · base «${(process.env.DATABASE_URL ?? '').split('/').pop()}»${APLICAR ? ` · API ${API}` : ''}\n`);
  const lineas = fs.readFileSync(ARCHIVO!, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const sedes = await prisma.sede.findMany({ select: { id: true, nombre: true } });
  const admin = await prisma.usuario.findFirst({ where: { email: 'admin@limablue.pe' }, select: { id: true } });
  const H = () => ({ Authorization: 'Bearer ' + jwt.sign({ userId: admin!.id, rol: 'admin', sedes: [], permisos: [] }, process.env.JWT_SECRET!, { expiresIn: '2h' }), 'Content-Type': 'application/json' });

  // ── Preparación (solo al aplicar): sesiones del láser P12 como subcategorías, en orden ──
  if (APLICAR) {
    const hc = await fetch(new URL(API!).origin + '/health').catch(() => null);
    if (!hc?.ok) throw new Error(`El API de carga no responde en ${API}`);
    const laser = await prisma.servicio.findFirst({ where: { codigo: 'LASER_DE_ALTA_HONGOS' }, select: { id: true, subcategorias: { where: { deletedAt: null }, select: { nombre: true } } } });
    if (laser) for (let i = 1; i <= SESIONES_LASER; i++) if (!laser.subcategorias.some((x) => norm(x.nombre) === norm(`Sesión ${i}`))) {
      await prisma.subcategoriaServicio.create({ data: { servicioId: laser.id, nombre: `Sesión ${i}`, orden: i, activo: true, creadoPor: admin?.id } }); log(`  + subcategoría «Sesión ${i}» en Laserterapia Onicomicosis P12`);
    }
  }
  // Dos personas que HOY atienden esos tratamientos en la agenda real y no estaban en la matriz de competencias:
  // Marilin Oropesa (láser de hongos todo el día) y Mónica Valdez (fisioterapeuta: Fisioterapia P12 y evaluación).
  if (APLICAR) for (const [apellido, codigos] of [['Oropesa Tapia', ['POD-LASER', 'POD-01', 'LASER_DE_ALTA_HONGOS']], ['Valdez', ['FIS-03', 'FIS-SES', 'FIS-01', 'FIS-02']]] as [string, string[]][]) {
    const pr = await prisma.profesional.findFirst({ where: { apellidos: apellido, deletedAt: null }, select: { id: true } }); if (!pr) continue;
    for (const sv of await prisma.servicio.findMany({ where: { codigo: { in: codigos }, deletedAt: null }, select: { id: true, nombre: true } })) {
      const k = await prisma.competenciaProfesional.findUnique({ where: { profesionalId_servicioId: { profesionalId: pr.id, servicioId: sv.id } }, select: { activa: true } });
      if (k?.activa) continue;
      if (k) await prisma.competenciaProfesional.update({ where: { profesionalId_servicioId: { profesionalId: pr.id, servicioId: sv.id } }, data: { activa: true } });
      else await prisma.competenciaProfesional.create({ data: { profesionalId: pr.id, servicioId: sv.id, activa: true, habilitadoDesde: new Date() } });
      log(`  + ${apellido}: habilitado «${sv.nombre}»`);
    }
  }
  const servicios = await prisma.servicio.findMany({ where: { activo: true, deletedAt: null }, select: { id: true, codigo: true, nombre: true, duracionMinutos: true, unidadNegocioId: true, subcategorias: { where: { activo: true, deletedAt: null }, select: { id: true, nombre: true } } } });
  const profs = await prisma.profesional.findMany({ where: { deletedAt: null, activo: true }, select: { id: true, nombres: true, apellidos: true, esEquipo: true } });
  const cuenta = { cargadas: 0, yaEstaban: 0, rechazadas: 0, omitidas: 0, pacientesCreados: 0, listas: 0 };
  const rechazos: string[] = []; const decisiones: string[] = [];

  for (const [i, l] of lineas.entries()) {
    const [grupo, hora, pacCrudo, profCrudo, trat, canalCrudo, estado, comentario = '', folio = ''] = l.split('\t').map((x) => (x ?? '').trim());
    const et = `#${String(i + 1).padStart(2, '0')} ${hora} ${pacCrudo} · ${(profCrudo ?? '').replace(/\s+/g, ' ')}`;
    if (/anulad/i.test(estado ?? '')) { cuenta.omitidas++; log(`  · ${et} → ANULADA en el ERP: no se carga`); continue; }
    const errs: string[] = [];

    // Sede: prefijo del profesional; el comentario «CITA EN <SEDE>» manda.
    const pref = /^(\d)\s/.exec(profCrudo ?? '')?.[1]; let sede = sedes.find((s) => s.nombre === (pref ? SEDE_POR_PREFIJO[pref] : ''));
    const enOtra = /cita en ([a-zñ ]+)/i.exec(norm(comentario)); const sedeComentario = enOtra ? sedes.find((s) => norm(s.nombre) === enOtra[1]!.trim() || norm(s.nombre).startsWith(enOtra[1]!.trim())) : undefined;
    if (sedeComentario && sedeComentario.id !== sede?.id) { decisiones.push(`${et}: el comentario dice «${comentario}» → se cita en ${sedeComentario.nombre} (no en ${sede?.nombre})`); sede = sedeComentario; }
    if (!sede) errs.push(`sede no reconocida (${grupo} / ${pref})`);

    // Profesional: se busca por NOMBRE (sin el «1 Pod», «Asis.», etc.).
    const pn = norm((profCrudo ?? '').replace(/^\d\s+/, '').replace(/\b(asis|asist|pod|podologa|ft)\b\.?/gi, ' '));
    let prof: (typeof profs)[number] | undefined;
    if (/baropodometr/.test(pn)) {
      const asig = sede ? await prisma.asignacionSede.findMany({ where: { sedeId: sede.id, fechaInicio: { lte: fechaDb }, OR: [{ fechaFin: null }, { fechaFin: { gte: fechaDb } }], profesional: { esEquipo: true, activo: true, deletedAt: null } }, select: { profesional: { select: { id: true, nombres: true, apellidos: true, esEquipo: true } } } }) : [];
      prof = asig.map((a) => a.profesional).sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))[0];
      if (!prof) errs.push(`no hay máquina de baro asignada a ${sede?.nombre}`);
    } else if (/^sede .*doctor/.test(pn)) errs.push('columna «Doctor» de la sede: no dice qué persona atiende');
    else {
      const w = pn.split(' ').filter((x) => x.length > 1);
      const igual = (x: string, y: string) => y === x || (x === 'jessica' && y === 'yeccijca') || (x === 'machi' && y === 'maximina') || (x === 'selene' && y === 'selenne');
      const tok = (p: (typeof profs)[number]) => norm(`${p.apellidos} ${p.nombres}`).split(' ');
      let cand = profs.filter((p) => !p.esEquipo && w.every((x) => tok(p).some((y) => igual(x, y))));
      if (!cand.length) cand = profs.filter((p) => !p.esEquipo && tok(p).length >= 2 && tok(p).every((y) => w.some((x) => igual(x, y))));
      if (cand.length === 1) prof = cand[0]; else errs.push(cand.length ? `profesional ambiguo (${cand.map((c) => c.apellidos).join(' / ')})` : `«${pn}» no está registrada en el sistema`);
    }

    // Servicio y subcategoría
    const ms = mapearServicio(trat ?? ''); const srv = ms ? servicios.find((s) => s.codigo === ms.codigo) : undefined;
    const sub = srv && ms?.sub ? srv.subcategorias.find((x) => norm(x.nombre) === norm(ms.sub!)) : undefined;
    if (!srv) errs.push(`tratamiento sin equivalente: «${trat}»`);
    else if (srv.subcategorias.length && !sub && (APLICAR || srv.codigo !== 'LASER_DE_ALTA_HONGOS')) errs.push(`«${srv.nombre}» no tiene la subcategoría «${ms?.sub ?? '?'}»`);

    const canal = CANAL[norm(canalCrudo ?? '')]; if (!canal) errs.push(`canal desconocido «${canalCrudo}»`);

    // Paciente (al final: solo se crea si todo lo demás está bien)
    const bp = await buscarPaciente(pacCrudo ?? ''); let pacienteId = bp.pac?.id;
    if (bp.pac && bp.como !== 'coincide') decisiones.push(`${et}: paciente → ${bp.como}`);
    if (!bp.pac && bp.como === 'nombre ilegible') errs.push('nombre del paciente ilegible');

    if (errs.length) { cuenta.rechazadas++; rechazos.push(`${et}\n        ${errs.join('\n        ')}`); continue; }
    if (!APLICAR) { cuenta.listas++; if (!bp.pac) decisiones.push(`${et}: paciente ${bp.como} → se CREARÍA solo con su nombre`); continue; }

    if (!pacienteId) {
      const apellidos = (pacCrudo ?? '').split(/,(?!,)/)[0]!.replace(/[.,\-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
      const nombres = titulo(((pacCrudo ?? '').split(/,(?!,)/)[1] ?? '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
      const doc = `PEND-${FECHA!.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;
      const ya = await prisma.paciente.findFirst({ where: { numeroDocumento: doc, deletedAt: null }, select: { id: true } });
      pacienteId = ya?.id ?? (await prisma.paciente.create({ data: { nombres, apellidoPaterno: titulo(apellidos[0] ?? '-'), apellidoMaterno: titulo(apellidos.slice(1).join(' ')) || '-', tipoDocumento: 'DNI', numeroDocumento: doc, telefono: '000000000', requiereActualizacionDatos: true, origenImportacion: 'ERP_AGENDA', notas: `Creado solo con su nombre al cargar la agenda del ${FECHA} desde el sistema anterior (${bp.como}). Completar documento y teléfono.`, creadoPor: admin?.id }, select: { id: true } })).id;
      if (!ya) { cuenta.pacientesCreados++; decisiones.push(`${et}: paciente ${bp.como} → CREADO solo con su nombre (documento provisional ${doc})`); }
    }

    const cuerpo = { pacienteId, sedeId: sede!.id, unidadNegocioId: srv!.unidadNegocioId, servicioId: srv!.id, subcategoriaId: sub?.id ?? null, profesionalId: prof!.id, fecha: FECHA, horaInicio: hora, canal,
      comentarioRecepcion: [`[ERP ${folio}]`, comentario, ms?.nota].filter(Boolean).join(' · ').slice(0, 1900) };
    const r = await fetch(`${API}/citas`, { method: 'POST', headers: { ...H(), 'Idempotency-Key': `erp-${FECHA}-${folio}-${i + 1}` }, body: JSON.stringify(cuerpo) });
    const j = (await r.json().catch(() => ({}))) as { code?: string; error?: string; message?: string };
    if (r.status === 201) { cuenta.cargadas++; log(`  ✔ ${et} → ${srv!.nombre}${sub ? ' · ' + sub.nombre : ''} · ${sede!.nombre}`); }
    else if (r.status === 200) { cuenta.yaEstaban++; log(`  = ${et} → ya estaba cargada`); }
    else { cuenta.rechazadas++; rechazos.push(`${et}\n        el sistema la rechazó: ${j.message ?? j.error ?? r.status} (${j.code ?? j.error ?? ''})`); }
  }

  log(APLICAR ? `\nCARGADAS: ${cuenta.cargadas} · ya estaban: ${cuenta.yaEstaban} · NO entraron: ${cuenta.rechazadas} · anuladas omitidas: ${cuenta.omitidas} · pacientes creados: ${cuenta.pacientesCreados}`
    : `\nListas: ${cuenta.listas} · con problema: ${cuenta.rechazadas} · anuladas: ${cuenta.omitidas}`);
  if (decisiones.length) log('\nDECISIONES TOMADAS:\n  ' + decisiones.join('\n  '));
  if (rechazos.length) log('\nNO ENTRARON:\n  ' + rechazos.join('\n  '));
  if (INFORME) { fs.writeFileSync(INFORME, out.join('\n'), 'utf8'); console.log(`\nInforme: ${INFORME}`); }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
