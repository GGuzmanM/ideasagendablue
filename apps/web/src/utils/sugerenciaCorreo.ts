// Sugerencia de corrección del correo del paciente (13-oct-2026). Mismas reglas que la limpieza de la base: había ~300
// correos con el dominio mal escrito (gamil.com, gmail.con, hotmial.com…) o con signos sobrantes, y nunca les llegaba
// nada. Solo corrige proveedores públicos conocidos: un dominio de empresa o universidad no se toca.
const PUBLICOS = ['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'icloud.com', 'live.com'];
const FIJOS: Record<string, string> = {
  'gamil.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmaiil.com': 'gmail.com',
  'gmnail.com': 'gmail.com', 'igmail.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmil.com': 'gmail.com', 'gnail.com': 'gmail.com',
  'gimail.com': 'gmail.com', 'gmaail.com': 'gmail.com', 'gamail.com': 'gmail.com', 'gmsil.com': 'gmail.com', 'ggmail.com': 'gmail.com',
  'hormail.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'otmail.com': 'hotmail.com', 'hotmil.com': 'hotmail.com',
  'hitmail.com': 'hotmail.com', 'hotamil.com': 'hotmail.com', 'hoymail.com': 'hotmail.com', 'homail.com': 'hotmail.com', 'hotnail.com': 'hotmail.com',
  'hotmaill.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outook.com': 'outlook.com',
  'yahoot.com': 'yahoo.com', 'yaho.com': 'yahoo.com', 'iclud.com': 'icloud.com',
};
// Terminación mal escrita de un proveedor conocido: gmail.con, hotmail.cm, gmail.co, yahoo.comn…
const TERMINACION = /^(gmail|hotmail|outlook|yahoo|icloud|live)\.(con|cm|co|om|coom|comm|comn|vom|xom|cpm|copm|coim|com\.com)$/;

/** Correo corregido si el escrito tiene un error evidente; null si está bien o si no hay una corrección segura. */
export function sugerirCorreo(valor: string): string | null {
  const original = valor.trim();
  if (!original.includes('@')) return null;
  let e = original.toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[\s.,;:*|]+$/, '').replace(/\s+/g, '');
  if (e.split('@').length !== 2) return null;
  let [usuario, dominio] = e.split('@') as [string, string];
  if (dominio.includes(',')) return null; // «g,ail.com»: no hay corrección segura, que lo revise quien registra
  dominio = dominio.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
  if (FIJOS[dominio]) dominio = FIJOS[dominio]!;
  const m = TERMINACION.exec(dominio);
  if (m) dominio = `${m[1]}.com`;
  e = `${usuario}@${dominio}`;
  if (!PUBLICOS.includes(dominio) && e === original.toLowerCase()) return null; // dominio propio (empresa): no se toca
  return e !== original.toLowerCase() && /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) ? e : null;
}
