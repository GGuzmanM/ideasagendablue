/**
 * API del APARATO del consultorio (`/api/v1/dispositivo`). Sin sesión de usuario: el aparato se
 * identifica con su clave (`Authorization: Dispositivo lbd_…`, ver middleware/authDispositivo.ts).
 *
 *  POST /eventos  {idEvento, accion: 'inicio'|'fin', edadMs?, presionadoEn?, ntp?, fw?}
 *                 → 200 {resultado, lcd: [l1, l2], tiempo, cita, servidorEn}
 *  POST /latido   {fw?, rssi?} → 200 {servidorEn, consultorio, enCurso, siguiente, porLlegar, lcd}
 *                 (en reposo la pantalla muestra quién sigue: `SIGUE: ROSA M. / PULSE INICIO`)
 *
 * Errores: 401 clave inválida o revocada · 422 datos inválidos · 429 demasiadas peticiones.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireDispositivo } from '../middleware/authDispositivo';
import { dispositivoLimiter } from '../middleware/rateLimits';
import { procesarEvento, registrarLatido } from '../services/tiempoTratamientoService';
import { EDAD_MAX_MS } from '../services/tiempoReglas';

const router = Router();
router.use(dispositivoLimiter, requireDispositivo);

const eventoSchema = z.object({
  idEvento: z.string().trim().min(1).max(64),
  accion: z.enum(['inicio', 'fin']),
  edadMs: z.number().int().min(0).max(EDAD_MAX_MS).optional(),
  presionadoEn: z.string().datetime({ offset: true }).optional(),
  ntp: z.boolean().optional(),
  fw: z.string().trim().max(32).optional(),
});

router.post('/eventos', async (req, res) => {
  const ev = eventoSchema.parse(req.body);
  res.json(await procesarEvento(req.dispositivo!, ev, { ip: req.ip }));
});

const latidoSchema = z.object({
  fw: z.string().trim().max(32).optional(),
  rssi: z.number().int().min(-120).max(0).optional(),
});

router.post('/latido', async (req, res) => {
  const datos = latidoSchema.parse(req.body ?? {});
  res.json(await registrarLatido(req.dispositivo!, { ...datos, ip: req.ip }));
});

export default router;
