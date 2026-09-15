/**
 * Verificación PÚBLICA de recetas e indicaciones (el QR del PDF apunta a la página web que llama
 * aquí). Sin sesión. Muestra lo mínimo para que una farmacia confirme que el documento es auténtico
 * y está vigente: tipo, número, fechas, estado, quién lo emitió (con su registro), la sede y los
 * ítems. Del paciente, solo sus iniciales. El código es aleatorio de 10 caracteres (≈10^15
 * combinaciones) y la ruta tiene límite de peticiones por IP. Cada consulta queda en la auditoría.
 */
import { Router } from 'express';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import { verificacionLimiter } from '../middleware/rateLimits';
import { registrarAudit } from '../services/audit';

const router = Router();
router.use(verificacionLimiter);

// Alfabeto de recetaService.codigoVerificacion: sin I, O, 0 ni 1 (no se confunden al dictarlos).
const CODIGO = /^[A-HJ-NP-Z2-9]{10}$/;

const inicial = (s: string | null | undefined) => (s ?? '').trim().charAt(0).toUpperCase();

router.get('/receta/:codigo', async (req, res) => {
  const codigo = String(req.params.codigo ?? '').trim().toUpperCase();
  if (!CODIGO.test(codigo)) throw new AppError('El código de verificación no es válido', 400, 'CODIGO_INVALIDO');
  const r = await prisma.receta.findUnique({
    where: { codigoVerificacion: codigo },
    select: {
      id: true, numero: true, tipoDocumento: true, fechaEmision: true, vigenciaDias: true, estado: true, anuladaEn: true,
      emisorNombre: true, emisorRegistro: true, sedeId: true,
      paciente: { select: { nombres: true, apellidoPaterno: true, apellidoMaterno: true } },
      atencion: { select: { sede: { select: { nombre: true } } } },
      items: {
        orderBy: { orden: 'asc' },
        select: { tipo: true, nombre: true, marcaImpresa: true, concentracionSnapshot: true, formaSnapshot: true, cantidad: true },
      },
    },
  });
  if (!r) throw new AppError('No existe un documento con ese código', 404, 'NO_ENCONTRADO');

  const vence = r.vigenciaDias ? new Date(r.fechaEmision.getTime() + r.vigenciaDias * 86_400_000) : null;
  void registrarAudit({
    accion: 'verificar_receta', entidad: 'receta', entidadId: r.id, sedeId: r.sedeId,
    ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    tipoDocumento: r.tipoDocumento,
    numero: r.numero,
    fechaEmision: r.fechaEmision,
    vigenciaDias: r.vigenciaDias,
    vence,
    estado: r.estado,
    anuladaEn: r.anuladaEn,
    vigente: r.estado === 'emitida' && (!vence || vence.getTime() >= Date.now()),
    emisor: { nombre: r.emisorNombre, registro: r.emisorRegistro },
    sede: r.atencion.sede.nombre,
    paciente: [inicial(r.paciente.nombres), inicial(r.paciente.apellidoPaterno), inicial(r.paciente.apellidoMaterno)].filter(Boolean).map((x) => `${x}.`).join(' '),
    items: r.items.map((it) => ({
      tipo: it.tipo, nombre: [it.nombre, it.concentracionSnapshot, it.formaSnapshot].filter(Boolean).join(' '), marca: it.marcaImpresa, cantidad: it.cantidad,
    })),
  });
});

export default router;
