import { Router } from 'express';
import { requireAuth, requireAcceso } from '../middleware/auth';
import { consultarDni } from '../services/reniecService';
import { reniecLimiter } from '../middleware/rateLimits';

const router = Router();

// GET /api/v1/reniec/dni/:dni — autollenado de datos del paciente desde RENIEC.
// requireAcceso: usuarios necesitan el permiso `pacientes.ver` (no basta con estar logueado);
// API keys, el scope `patients:read`. Es PII + costo externo, por eso se exige permiso real.
// Rate limit: evita barridos de documentos contra la API externa (costo/límite del proveedor).
router.get('/dni/:dni', reniecLimiter, requireAuth, requireAcceso('patients:read', 'pacientes.ver'), async (req, res) => {
  const datos = await consultarDni(req.params.dni.trim());
  res.json(datos);
});

export default router;
