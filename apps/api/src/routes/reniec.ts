import { Router } from 'express';
import { requireAuth, requireScope } from '../middleware/auth';
import { consultarDni } from '../services/reniecService';
import { reniecLimiter } from '../middleware/rateLimits';

const router = Router();

// GET /api/v1/reniec/dni/:dni — autollenado de datos del paciente desde RENIEC.
// Requiere los mismos permisos que leer pacientes (recepción/coordinación/admin).
// Rate limit: evita barridos de documentos contra la API externa (costo/límite del proveedor).
router.get('/dni/:dni', reniecLimiter, requireAuth, requireScope('patients:read'), async (req, res) => {
  const datos = await consultarDni(req.params.dni.trim());
  res.json(datos);
});

export default router;
