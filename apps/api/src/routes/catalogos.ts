import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { busquedaLimiter } from '../middleware/rateLimits';

// ─── Catálogos clínicos de referencia (base de la receta — Fase 2 del plan HCE) ──
// Solo LECTURA. Data de referencia (no data de paciente), por eso basta con estar
// autenticado; los permisos clínicos finos (hc.ver / receta.emitir) llegan con la
// Fase 1/2. Búsqueda difusa por nombre con pg_trgm (similarity + ILIKE).
const router = Router();

const buscarSchema = z.object({
  q: z.string().trim().max(80).optional().default(''),
  grupo: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

// ─── GET /catalogos/cie10?q=&limit= ───────────────────────────────────────────
// Diagnósticos CIE-10 (subset curado de la clínica del pie). Busca por código o por
// descripción; ordena por prefijo de código exacto y luego por similitud.
router.get('/cie10', requireAuth, busquedaLimiter, async (req, res) => {
  const { q, limit } = buscarSchema.parse(req.query);

  let filas;
  if (!q) {
    filas = await prisma.cie10.findMany({
      where: { activo: true },
      orderBy: [{ categoria: 'asc' }, { codigo: 'asc' }],
      take: limit,
    });
  } else {
    filas = await prisma.$queryRaw<
      { codigo: string; descripcion: string; categoria: string | null }[]
    >`
      SELECT codigo, descripcion, categoria
      FROM cie10
      WHERE activo = true
        AND (codigo ILIKE ${q + '%'} OR descripcion ILIKE ${'%' + q + '%'})
      ORDER BY
        (codigo ILIKE ${q + '%'}) DESC,
        similarity(descripcion, ${q}) DESC,
        codigo ASC
      LIMIT ${limit}
    `;
  }
  res.json(filas);
});

// ─── GET /catalogos/medicamentos?q=&grupo=&limit= ─────────────────────────────
// Vademécum curado. Busca por DCI (principio activo), código ATC o nombre comercial
// (marca → genérico). `grupo` filtra por categoría. Ordena por similitud de nombre.
router.get('/medicamentos', requireAuth, busquedaLimiter, async (req, res) => {
  const { q, grupo, limit } = buscarSchema.parse(req.query);

  let filas;
  if (!q) {
    filas = await prisma.medicamento.findMany({
      where: { activo: true, ...(grupo ? { grupo } : {}) },
      orderBy: [{ grupo: 'asc' }, { dci: 'asc' }],
      take: limit,
    });
  } else {
    const like = '%' + q + '%';
    filas = await prisma.$queryRaw<
      {
        id: string;
        dci: string;
        codigoAtc: string | null;
        codigoDigemid: string | null;
        concentracion: string | null;
        formaFarmaceutica: string | null;
        viaAdministracion: string | null;
        nombresComerciales: string | null;
        grupo: string | null;
        requiereReceta: boolean;
        esProducto: boolean;
        posologiaSugerida: string | null;
      }[]
    >`
      SELECT id, dci, "codigoAtc", "codigoDigemid", concentracion,
             "formaFarmaceutica", "viaAdministracion", "nombresComerciales", grupo,
             "requiereReceta", "esProducto", "posologiaSugerida"
      FROM medicamentos
      WHERE activo = true
        ${grupo ? Prisma.sql`AND grupo = ${grupo}` : Prisma.empty}
        AND (
          dci ILIKE ${like}
          OR "codigoAtc" ILIKE ${like}
          OR "nombresComerciales" ILIKE ${like}
          OR concentracion ILIKE ${like}
        )
      ORDER BY
        similarity(dci || ' ' || COALESCE("nombresComerciales", ''), ${q}) DESC,
        dci ASC
      LIMIT ${limit}
    `;
  }
  res.json(filas);
});

export default router;
