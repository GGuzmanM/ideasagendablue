/**
 * Alta de los usuarios de CONTACT CENTER (21-sep-2026), de la lista del sistema anterior (rol 10).
 *
 *   npx ts-node --transpile-only scripts/alta-contact-center.ts                    → SIMULA (no escribe)
 *   npx ts-node --transpile-only scripts/alta-contact-center.ts --aplicar          → crea los usuarios
 *   … --excel="C:\ruta\Relacion de usuarios.xlsx"                                  → dónde dejar la relación
 *
 * Reglas (las mismas del alta de producción):
 *  · Solo PERSONAS y solo las ACTIVAS en el sistema anterior. «Plantillas» no es una persona; Yaritza
 *    Frias y Mario (Gustavo) Velasquez figuran inactivos: no se crean (quedan anotados en la relación).
 *  · Contraseña inicial = su DNI de 8 dígitos. Correo = 2 letras del nombre + apellido @limablue.com.
 *  · Rol «contact_center»: ve y agenda en TODAS las sedes por su rol (no necesita sedes marcadas).
 *  · No toca a nadie más: no desactiva ni cambia a ningún otro usuario. Si el correo ya existe, solo lo
 *    reactiva con este rol y NO le cambia la contraseña.
 * La relación en Excel lleva contraseñas: entregarla en privado y borrarla después (no va al repositorio).
 */
import '../src/cargarEnv';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import path from 'path';
import { prisma } from '../src/db';

const APLICAR = process.argv.includes('--aplicar');
const argExcel = process.argv.find((a) => a.startsWith('--excel='))?.slice('--excel='.length);

interface Persona { usuario: string; nombre: string; dni: string; activoAntes: boolean }
const LISTA: Persona[] = [
  { usuario: 'JOAQUIN.OCHOA', nombre: 'Joaquin Ochoa', dni: '72385957', activoAntes: true },
  { usuario: 'JEREMY.TREBEJO', nombre: 'Jeremy Trebejo', dni: '70997654', activoAntes: true },
  { usuario: 'YARITZA.FRIAS', nombre: 'Yaritza Frias', dni: '73338789', activoAntes: false },
  { usuario: 'GUSTAVO.VELASQUEZ', nombre: 'Mario Velasquez', dni: '40494467', activoAntes: false },
  { usuario: 'GARY.CALERO', nombre: 'Gary Calero', dni: '46628310', activoAntes: true },
  { usuario: 'ELENA.DOY', nombre: 'Elena Doy', dni: '07840096', activoAntes: true },
  { usuario: 'CARMEN.MAMANI', nombre: 'Carmen Mamani', dni: '27071991', activoAntes: true },
  { usuario: 'JESSENIA.JIMENEZ', nombre: 'Jessenia Jimenez', dni: '73107915', activoAntes: true },
  { usuario: 'ANDREA.GAMARRA', nombre: 'Andrea Alejandra Gamarra Rodriguez', dni: '72709930', activoAntes: true },
  { usuario: 'ANGELA.SALE', nombre: 'Angela Gabriela Sale Lopez', dni: '73459777', activoAntes: true },
  { usuario: 'ALISON.CASTILLO', nombre: 'Alison Castillo', dni: '74432096', activoAntes: true },
];

const sinTildes = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const correoDe = (p: Persona) => { const [nom, ape] = p.usuario.split('.'); return `${sinTildes(nom!).slice(0, 2)}${sinTildes(ape!).replace(/[^a-z]/g, '')}@limablue.com`; };

async function main() {
  console.log(`${APLICAR ? 'APLICANDO' : 'SIMULACIÓN'} en «${(process.env.DATABASE_URL ?? '').split('/').pop()}»\n`);
  const filas: { nombre: string; correo: string; clave: string; rol: string; sedes: string; accion: string }[] = [];
  for (const p of LISTA) {
    const correo = correoDe(p);
    if (!p.activoAntes) { filas.push({ nombre: p.nombre, correo: '—', clave: '—', rol: 'Contact center', sedes: '—', accion: 'NO se creó: figura INACTIVO en el sistema anterior' }); console.log(`  · ${p.nombre}: inactivo en el sistema anterior → no se crea`); continue; }
    if (!/^\d{8}$/.test(p.dni)) throw new Error(`DNI inesperado para ${p.nombre}`);
    const existente = await prisma.usuario.findUnique({ where: { email: correo }, select: { id: true, activo: true, rol: true, deletedAt: true } });
    let accion: string; let clave = p.dni;
    if (existente) {
      accion = `Ya existía (${existente.rol}${existente.activo ? '' : ', inactivo'}): queda activo como contact center; su contraseña NO se cambió`; clave = '(la que ya tenía)';
      if (APLICAR) await prisma.usuario.update({ where: { id: existente.id }, data: { nombre: p.nombre, rol: 'contact_center', activo: true, deletedAt: null, area: 'CONTACT_CENTER' } });
    } else {
      accion = 'Creado';
      if (APLICAR) await prisma.usuario.create({ data: { nombre: p.nombre, email: correo, passwordHash: await bcrypt.hash(p.dni, 12), rol: 'contact_center', activo: true, area: 'CONTACT_CENTER' } });
    }
    filas.push({ nombre: p.nombre, correo, clave, rol: 'Contact center', sedes: 'Todas (por su rol)', accion });
    console.log(`  ${APLICAR ? '✔' : '+'} ${p.nombre.padEnd(38)} ${correo.padEnd(28)} ${accion}`);
  }

  // ── Relación TOTAL de usuarios del sistema (sin contraseñas: están cifradas; la inicial fue su DNI) ──
  const todos = await prisma.usuario.findMany({
    where: { deletedAt: null },
    select: { nombre: true, email: true, rol: true, activo: true, sedes: { select: { sede: { select: { nombre: true } } } }, recepcionistaId: true, profesionalId: true },
    orderBy: [{ activo: 'desc' }, { rol: 'asc' }, { nombre: 'asc' }],
  });
  const ROL: Record<string, string> = { admin: 'Administrador', coordinadora_sedes: 'Coordinación', recepcionista: 'Recepción', contact_center: 'Contact center', medico: 'Médico', podologa: 'Podóloga' };
  const TODAS = ['admin', 'coordinadora_sedes', 'contact_center'];

  if (APLICAR || argExcel) {
    const wb = new ExcelJS.Workbook();
    const estilo = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; ws.eachRow((r, i) => { if (i > 1) r.font = { name: 'Arial' }; }); ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    const h1 = wb.addWorksheet('Contact center (nuevos)');
    h1.columns = [{ header: 'Nombre', key: 'nombre', width: 40 }, { header: 'Correo (usuario)', key: 'correo', width: 30 }, { header: 'Contraseña inicial', key: 'clave', width: 20 }, { header: 'Rol', key: 'rol', width: 16 }, { header: 'Sedes', key: 'sedes', width: 20 }, { header: 'Qué se hizo', key: 'accion', width: 70 }];
    filas.forEach((f) => h1.addRow(f)); estilo(h1);
    const h2 = wb.addWorksheet('Todos los usuarios');
    h2.columns = [{ header: 'Nombre', key: 'nombre', width: 40 }, { header: 'Correo (usuario)', key: 'correo', width: 32 }, { header: 'Rol', key: 'rol', width: 16 }, { header: 'Activo', key: 'activo', width: 9 }, { header: 'Sedes', key: 'sedes', width: 46 }, { header: 'Contraseña', key: 'clave', width: 44 }];
    for (const u of todos) {
      const sedes = TODAS.includes(u.rol) ? 'Todas (por su rol)' : u.recepcionistaId || (u.rol === 'podologa' && u.profesionalId) ? 'Según Movimientos' : u.sedes.map((s) => s.sede.nombre).sort().join(', ') || '—';
      h2.addRow({ nombre: u.nombre, correo: u.email, rol: ROL[u.rol] ?? u.rol, activo: u.activo ? 'Sí' : 'No', sedes, clave: u.email === 'admin@limablue.pe' ? '(la del administrador)' : 'Su DNI, si no la cambió (guardada cifrada)' });
    }
    estilo(h2);
    const destino = argExcel ?? path.join(__dirname, `Relacion de usuarios (${new Date().toISOString().slice(0, 10)}).xlsx`);
    await wb.xlsx.writeFile(destino);
    console.log(`\nRelación escrita en: ${destino}`);
  }
  console.log(`\nUsuarios en el sistema: ${todos.length} (${todos.filter((u) => u.activo).length} activos)`);
  if (!APLICAR) console.log('Nada se escribió en la base. Para crear los usuarios: agrega --aplicar');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
