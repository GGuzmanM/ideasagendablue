import { AppError } from '../middleware/errorHandler';

// ── Consulta de DNI vía PeruDevs (api.perudevs.com/api/v1/dni/complete) ────────
// El token vive SOLO en el servidor (env PERUDEVS_DNI_TOKEN) y nunca se expone al
// navegador. Este plan SÍ devuelve nombres, apellidos, género y fecha de nacimiento.
// Se mantiene compat: el token viejo RENIEC_API_TOKEN sirve de respaldo.

const API_URL = process.env.PERUDEVS_DNI_URL || 'https://api.perudevs.com/api/v1/dni/complete';
const API_TOKEN = process.env.PERUDEVS_DNI_TOKEN || process.env.RENIEC_API_TOKEN || '';

export interface DatosReniec {
  numeroDocumento: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombreCompleto: string;
  // Extras que trae PeruDevs (pueden faltar → null):
  sexo: 'masculino' | 'femenino' | 'otro' | null;
  fechaNacimiento: string | null; // ISO "YYYY-MM-DD"
}

// Respuesta cruda de PeruDevs
interface PeruDevsResp {
  estado: boolean;
  mensaje?: string;
  resultado?: {
    id: string;
    nombres: string;
    apellido_paterno: string;
    apellido_materno: string;
    nombre_completo: string;
    genero?: string;
    fecha_nacimiento?: string; // "DD/MM/YYYY"
    codigo_verificacion?: string | number;
  };
}

// "M" → masculino · "F" → femenino · cualquier otro término → otro.
function mapSexo(genero?: string): 'masculino' | 'femenino' | 'otro' | null {
  if (!genero) return null;
  const g = genero.trim().toUpperCase();
  if (g === 'M' || g.startsWith('MASC')) return 'masculino';
  if (g === 'F' || g.startsWith('FEM')) return 'femenino';
  return 'otro';
}

// "DD/MM/YYYY" → "YYYY-MM-DD" (formato del <input type="date">). null si no parsea.
function mapFecha(fecha?: string): string | null {
  if (!fecha) return null;
  const m = fecha.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function consultarDni(dni: string): Promise<DatosReniec> {
  if (!/^\d{8}$/.test(dni)) {
    throw new AppError('DNI inválido: debe tener 8 dígitos', 400, 'DNI_INVALIDO');
  }
  if (!API_TOKEN) {
    throw new AppError('Consulta de DNI no configurada (falta PERUDEVS_DNI_TOKEN)', 503, 'RENIEC_NO_CONFIG');
  }

  const url = `${API_URL}?document=${encodeURIComponent(dni)}&key=${encodeURIComponent(API_TOKEN)}`;

  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12_000);
    resp = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(timeout);
  } catch {
    throw new AppError('No se pudo contactar el servicio de consulta de DNI', 502, 'RENIEC_UNREACHABLE');
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new AppError('Token de consulta de DNI inválido o sin saldo', 502, 'RENIEC_AUTH');
  }

  let json: PeruDevsResp;
  try {
    json = (await resp.json()) as PeruDevsResp;
  } catch {
    throw new AppError('Respuesta inválida del servicio de consulta de DNI', 502, 'RENIEC_BAD_RESPONSE');
  }

  if (!json.estado || !json.resultado) {
    throw new AppError(json.mensaje || 'DNI no encontrado', 404, 'DNI_NO_ENCONTRADO');
  }

  const r = json.resultado;
  return {
    numeroDocumento: r.id || dni,
    nombres: r.nombres,
    apellidoPaterno: r.apellido_paterno,
    apellidoMaterno: r.apellido_materno,
    nombreCompleto: r.nombre_completo,
    sexo: mapSexo(r.genero),
    fechaNacimiento: mapFecha(r.fecha_nacimiento),
  };
}
