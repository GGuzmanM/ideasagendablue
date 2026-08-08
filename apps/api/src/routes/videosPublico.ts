import { Router } from 'express';
import { prisma } from '../db';
import { verificarTokenBajaVideos, firmarTokenBajaVideos } from '../utils/bajaVideosToken';
import { cancelarVideosPorCorreo } from '../services/videoEnvioService';

/**
 * Rutas PÚBLICAS (sin login) del módulo de videos: el paciente se da de baja o se
 * reactiva desde el enlace del correo. La acción la decide el endpoint; el token solo
 * codifica el correo. Devuelven una página HTML simple y branded.
 */
const router = Router();

function paginaHtml(opts: { titulo: string; emoji: string; mensaje: string; accionHtml?: string; color?: string }): string {
  const color = opts.color ?? '#1e3a8a';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>Limablue · Videos</title></head>
<body style="margin:0;background:#e7e5df;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 14px 50px rgba(16,40,79,.15);">
        <tr><td style="background:${color};padding:22px 32px;text-align:center;">
          <span style="color:#fff;font-size:24px;font-weight:800;font-style:italic;letter-spacing:-.02em;">limablue</span>
        </td></tr>
        <tr><td style="padding:36px 32px 32px;text-align:center;">
          <div style="font-size:46px;line-height:1;margin-bottom:14px;">${opts.emoji}</div>
          <h1 style="margin:0 0 10px;font-size:21px;font-weight:800;color:#0f1f3d;">${opts.titulo}</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">${opts.mensaje}</p>
          ${opts.accionHtml ?? ''}
        </td></tr>
        <tr><td style="padding:18px 32px 24px;border-top:1px solid #eef1f6;text-align:center;">
          <div style="font-size:12px;color:#aab2c0;line-height:1.6;">Esto solo afecta los <strong>videos educativos</strong>. Seguirás recibiendo el correo de <strong>confirmación de tu cita</strong>.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function paginaError(): string {
  return paginaHtml({
    titulo: 'Enlace no válido', emoji: '⚠️', color: '#b45309',
    mensaje: 'Este enlace expiró o no es válido. Si deseas dejar de recibir los videos, escríbenos y con gusto te ayudamos.',
  });
}

// GET /videos/baja?token= — el paciente deja de recibir videos.
router.get('/baja', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let email: string;
  try { ({ email } = verificarTokenBajaVideos(token)); } catch { return res.status(400).send(paginaError()); }

  const existente = await prisma.videoSupresion.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
  if (!existente) {
    await prisma.videoSupresion.create({ data: { email, motivo: 'baja_desde_correo' } });
    await cancelarVideosPorCorreo(email);
  }

  const urlReactivar = `/api/v1/videos/reactivar?token=${firmarTokenBajaVideos(email)}`;
  res.send(paginaHtml({
    titulo: 'Listo, ya no recibirás estos videos', emoji: '✅',
    mensaje: `Dejaremos de enviar los videos educativos a <strong>${email}</strong>.`,
    accionHtml: `<a href="${urlReactivar}" style="display:inline-block;margin-top:22px;color:#1e3a8a;font-size:14px;font-weight:700;text-decoration:underline;">¿Cambiaste de opinión? Volver a recibirlos</a>`,
  }));
});

// GET /videos/reactivar?token= — el paciente vuelve a recibir videos.
router.get('/reactivar', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let email: string;
  try { ({ email } = verificarTokenBajaVideos(token)); } catch { return res.status(400).send(paginaError()); }

  await prisma.videoSupresion.updateMany({ where: { email, deletedAt: null }, data: { deletedAt: new Date() } });

  res.send(paginaHtml({
    titulo: 'Volverás a recibir los videos', emoji: '🎬', color: '#047857',
    mensaje: `Reactivamos el envío de videos educativos para <strong>${email}</strong>.`,
  }));
});

export default router;
