/**
 * Pasarelas de pago de la RESERVA WEB (05-oct-2026).
 *
 * La reserva web no depende de una pasarela concreta: cada una implementa `Pasarela` (iniciar el cobro y leer
 * su aviso de pago). Se elige con RESERVA_WEB_PASARELA. Hoy existe solo `simulada` (para probar el flujo
 * completo sin cobrar); la real (Culqi, Izipay, Niubiz o Mercado Pago) se agrega aquí cuando la clínica la elija,
 * sin tocar el resto del flujo.
 */
import crypto from 'crypto';
import type { Request } from 'express';
import { AppError } from '../../middleware/errorHandler';

export interface ReservaParaPago {
  codigo: string;
  monto: number;
  moneda: string;
  email: string;
  nombres: string;
  apellidoPaterno: string;
  descripcion: string;
}

/** Lo que la página necesita para mostrar el cobro (formulario de la pasarela o redirección). */
export interface DatosCheckout {
  pasarela: string;
  modo: 'simulada' | 'formulario' | 'redireccion';
  urlPago?: string;
  datos?: Record<string, unknown>;
}

/** Aviso de la pasarela ya validado (firma correcta). */
export interface AvisoPago {
  codigo: string; // código de la reserva (LB-…)
  aprobado: boolean;
  referencia: string; // id del cobro en la pasarela
  estado: string; // estado tal como lo informa la pasarela
  detalle?: unknown;
}

export interface Pasarela {
  nombre: string;
  iniciarPago(r: ReservaParaPago): Promise<DatosCheckout>;
  /** Valida la firma del aviso y lo traduce. null = aviso que no es de un pago (se responde 200 y se ignora). */
  leerAviso(req: Request): Promise<AvisoPago | null>;
}

function igualesSeguro(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Pasarela SIMULADA: no cobra nada. El «aviso de pago» lo envía quien prueba (o el botón de la página de demo)
 * a POST /api/v1/publico/reservas/pagos/webhook/simulada con el secreto RESERVA_WEB_SIMULADA_SECRETO.
 * Nunca se activa con NODE_ENV=production.
 */
const simulada: Pasarela = {
  nombre: 'simulada',
  async iniciarPago(r) {
    return {
      pasarela: 'simulada', modo: 'simulada',
      datos: { monto: r.monto, moneda: r.moneda, nota: 'Pasarela de prueba: no se cobra nada.' },
    };
  },
  async leerAviso(req) {
    const secreto = process.env.RESERVA_WEB_SIMULADA_SECRETO || '';
    const recibido = String(req.headers['x-simulada-secreto'] || '');
    if (!secreto || !igualesSeguro(secreto, recibido)) throw new AppError('Aviso de pago no válido', 401, 'AVISO_NO_VALIDO');
    const b = (req.body ?? {}) as { codigo?: string; aprobado?: boolean };
    if (!b.codigo) return null;
    return {
      codigo: String(b.codigo), aprobado: b.aprobado !== false,
      referencia: `SIM-${crypto.randomBytes(6).toString('hex')}`, estado: b.aprobado === false ? 'rechazado' : 'aprobado',
      detalle: { simulada: true },
    };
  },
};

const PASARELAS: Record<string, Pasarela> = { simulada };

/** Pasarela configurada. 503 si falta configurarla (la página muestra «pagos no disponibles»). */
export function pasarelaActiva(): Pasarela {
  const nombre = (process.env.RESERVA_WEB_PASARELA || '').trim().toLowerCase();
  const p = PASARELAS[nombre];
  if (!p) throw new AppError('Los pagos en línea no están disponibles por el momento', 503, 'PASARELA_NO_CONFIGURADA');
  if (p.nombre === 'simulada' && process.env.NODE_ENV === 'production') {
    throw new AppError('Los pagos en línea no están disponibles por el momento', 503, 'PASARELA_NO_CONFIGURADA');
  }
  return p;
}

export function pasarelaPorNombre(nombre: string): Pasarela | null {
  const p = PASARELAS[nombre.toLowerCase()];
  if (!p) return null;
  if (p.nombre === 'simulada' && process.env.NODE_ENV === 'production') return null;
  return p;
}
