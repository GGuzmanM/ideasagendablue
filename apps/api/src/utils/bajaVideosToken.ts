import jwt from 'jsonwebtoken';

/**
 * Token firmado para el enlace "No deseo recibir estos videos" del correo de videos.
 * - Codifica el correo del paciente (así solo puede darse de baja a sí mismo, no a otros).
 * - Firmado con CONFIRM_TOKEN_SECRET (el mismo de los enlaces de cita; no expone sesión).
 * - Expira a 1 año (el enlace vive mientras el correo sea relevante).
 * - El MISMO token sirve para baja y reactivación; la acción la decide el endpoint.
 */
const TIPO_TOKEN = 'baja-videos';

const SECRET = process.env.CONFIRM_TOKEN_SECRET;
const SECRET_VALUE = SECRET || 'limablue-confirm-dev-secret-only';

function apiBase(): string {
  return (process.env.API_BASE_URL || 'http://localhost:3002').replace(/\/$/, '');
}

export function firmarTokenBajaVideos(email: string): string {
  return jwt.sign({ email: email.trim().toLowerCase(), tipo: TIPO_TOKEN }, SECRET_VALUE, { expiresIn: '365d' });
}

export function verificarTokenBajaVideos(token: string): { email: string } {
  const payload = jwt.verify(token, SECRET_VALUE) as { email?: string; tipo?: string };
  if (payload.tipo !== TIPO_TOKEN || !payload.email) throw new Error('Token de baja inválido');
  return { email: payload.email };
}

/** URL pública completa del enlace de baja para un correo (para el pie del correo de video). */
export function urlBajaVideos(email: string): string {
  return `${apiBase()}/api/v1/videos/baja?token=${firmarTokenBajaVideos(email)}`;
}
