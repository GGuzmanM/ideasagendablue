/**
 * RELACIÓN DE USUARIOS CON SU CONTRASEÑA INICIAL (solo lectura: no cambia nada en la base).
 *
 * Las contraseñas se guardan cifradas (bcrypt): no se pueden leer. Lo que se hace es tomar la contraseña
 * INICIAL que se le dio a cada persona (su DNI, de las listas de alta de `alta-usuarios-produccion.ts` y
 * `alta-contact-center.ts`) y COMPROBAR contra la base si sigue siendo la vigente. Si alguien ya la cambió,
 * o si el usuario se creó a mano desde Administración › Usuarios, se indica y se restablece desde ahí.
 *
 *   npx ts-node --transpile-only scripts/relacion-usuarios-claves.ts --excel="C:\ruta\archivo.xlsx"
 * El Excel lleva contraseñas: entregar en privado y borrar después (no va al repositorio).
 */
import '../src/cargarEnv';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/db';

const CLAVES_DEMO = (process.env.CLAVES_DEMO ?? '').split('|').filter(Boolean); // se pasan por variable de entorno: no se escriben en el repo
const argExcel = process.argv.find((a) => a.startsWith('--excel='))?.slice('--excel='.length);
const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

/** DNIs de las listas de alta: { nombre normalizado → [dni…] } y { correo → dni }. */
function dnisDeLasListas(): { porNombre: Map<string, string[]>; porCorreo: Map<string, string[]> } {
  const porNombre = new Map<string, string[]>(); const porCorreo = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string) => { if (!k || !v) return; const l = m.get(k) ?? []; if (!l.includes(v)) l.push(v); m.set(k, l); };
  for (const f of ['alta-usuarios-produccion.ts', 'alta-contact-center.ts']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const m of src.matchAll(/\{\s*usuario:\s*'([^']+)',\s*nombre:\s*'([^']+)',\s*dni:\s*'([^']*)'([^}]*)\}/g)) {
      const [, usuario, nombre, dniCrudo, resto] = m;
      const correo = /correo:\s*'([^']+)'/.exec(resto ?? '')?.[1];
      // Variantes razonables del DNI (algunos venían con un dígito de más en la lista original).
      const d = (dniCrudo ?? '').trim(); const variantes = new Set<string>();
      if (/^\d{8}$/.test(d)) variantes.add(d);
      if (/^\d{9}$/.test(d)) { variantes.add(d.slice(1)); variantes.add(d.slice(0, 8)); }
      const [nom, ape] = usuario!.split('.');
      const correoFormato = `${sinTildes(nom ?? '').replace(/ /g, '').slice(0, 2)}${sinTildes(ape ?? '').replace(/ /g, '')}@limablue.com`;
      for (const v of variantes) { add(porNombre, sinTildes(nombre!), v); add(porCorreo, (correo ?? correoFormato).toLowerCase(), v); add(porCorreo, correoFormato, v); }
    }
  }
  return { porNombre, porCorreo };
}

async function main() {
  const { porNombre, porCorreo } = dnisDeLasListas();
  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: { nombre: true, email: true, rol: true, activo: true, passwordHash: true, recepcionistaId: true, profesionalId: true, sedes: { select: { sede: { select: { nombre: true } } } } },
    orderBy: [{ activo: 'desc' }, { rol: 'asc' }, { nombre: 'asc' }],
  });
  const ROL: Record<string, string> = { admin: 'Administrador', coordinadora_sedes: 'Coordinación', recepcionista: 'Recepción', contact_center: 'Contact center', medico: 'Médico', podologa: 'Podóloga' };
  const TODAS = ['admin', 'coordinadora_sedes', 'contact_center'];
  const filas: { nombre: string; correo: string; rol: string; activo: string; sedes: string; clave: string; nota: string }[] = [];
  let vigentes = 0;
  for (const u of usuarios) {
    // Candidatos: por correo exacto, por nombre exacto, o por nombre contenido (la lista traía nombres cortos).
    const n = sinTildes(u.nombre); const cand = new Set<string>([...(porCorreo.get(u.email.toLowerCase()) ?? []), ...(porNombre.get(n) ?? [])]);
    for (const [k, v] of porNombre) { const pk = k.split(' '), pn = n.split(' '); if (pk.length >= 2 && (pk.every((w) => pn.includes(w)) || pn.every((w) => pk.includes(w)))) v.forEach((x) => cand.add(x)); }
    let clave = ''; for (const c of cand) if (await bcrypt.compare(c, u.passwordHash)) { clave = c; break; }
    // Cuentas genéricas antiguas (@limablue.pe): ¿siguen con la contraseña de DEMOSTRACIÓN que estuvo escrita en la
    // pantalla de login (y por tanto en el historial de git)? Si es así, cualquiera que vio el código puede entrar.
    let esDemo = false;
    if (!clave && u.email.endsWith('@limablue.pe') && u.email !== 'admin@limablue.pe') {
      for (const c of CLAVES_DEMO) if (await bcrypt.compare(c, u.passwordHash)) { clave = c; esDemo = true; break; }
    }
    let nota: string;
    if (esDemo) { nota = 'RIESGO: cuenta genérica con la contraseña de demostración que estuvo visible en el login. Desactívala o cámbiale la contraseña.'; vigentes++; }
    else if (clave) { nota = 'Vigente: es su DNI (contraseña inicial). Pedirle que la cambie al entrar.'; vigentes++; }
    else if (u.email === 'admin@limablue.pe') nota = 'Tu cuenta de administrador: la que tú definiste (no se toca).';
    else if (cand.size) nota = 'Ya NO es su DNI: la cambió. Si la olvidó → Administración › Usuarios › editar › nueva contraseña.';
    else nota = 'Creado a mano desde Administración › Usuarios: la contraseña la puso quien lo creó. Se restablece ahí mismo.';
    const sedes = TODAS.includes(u.rol) ? 'Todas (por su rol)' : u.recepcionistaId || (u.rol === 'podologa' && u.profesionalId) ? 'Según Movimientos' : u.sedes.map((s) => s.sede.nombre).sort().join(', ') || '—';
    filas.push({ nombre: u.nombre, correo: u.email, rol: ROL[u.rol] ?? u.rol, activo: u.activo ? 'Sí' : 'No', sedes, clave: clave || '—', nota });
  }
  console.log(`Usuarios: ${usuarios.length} · con contraseña inicial (DNI) comprobada y vigente: ${vigentes} · sin poder determinar: ${usuarios.length - vigentes}`);
  for (const f of filas) console.log(`  ${f.activo === 'Sí' ? ' ' : '×'} ${f.rol.padEnd(15)} ${f.nombre.padEnd(40).slice(0, 40)} ${f.correo.padEnd(30)} ${f.clave === '—' ? '(no determinable)' : 'DNI comprobado'}`);
  if (argExcel) {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Usuarios y contraseñas');
    ws.columns = [{ header: 'Nombre', key: 'nombre', width: 40 }, { header: 'Correo (usuario)', key: 'correo', width: 32 }, { header: 'Rol', key: 'rol', width: 16 }, { header: 'Activo', key: 'activo', width: 8 }, { header: 'Sedes', key: 'sedes', width: 40 }, { header: 'Contraseña', key: 'clave', width: 16 }, { header: 'Estado de la contraseña', key: 'nota', width: 95 }];
    filas.forEach((f) => ws.addRow(f));
    ws.getRow(1).font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    ws.eachRow((r, i) => { if (i > 1) { r.font = { name: 'Arial' }; r.getCell('clave').numFmt = '@'; } }); ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:G1';
    await wb.xlsx.writeFile(argExcel); console.log(`\nExcel: ${argExcel}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
