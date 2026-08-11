import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { WSEvent } from '@limablue/shared';
import { corsOrigin } from '../cors';
import { verifyToken, getPermisosRol, sedeAutorizada, AuthPayload } from '../middleware/auth';
import { prisma } from '../db';

let io: SocketServer;

export function initSocket(server: HttpServer): void {
  io = new SocketServer(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
    path: '/socket.io',
  });

  // ─── Autenticación del handshake ──────────────────────────────────────────────
  // Sin un JWT válido de un usuario ACTIVO, la conexión se rechaza. El CORS solo
  // frena navegadores; un cliente cualquiera (curl/postman) podía conectarse y —peor—
  // unirse a la sala de CUALQUIER sede para recibir sus eventos de cita (datos del
  // paciente). Esto cierra, en el canal realtime, la misma fuga entre sedes que ya
  // blindamos en el REST (Fase A).
  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth?.token || socket.handshake.query?.token) as string | undefined;
      if (!token) return next(new Error('NO_AUTENTICADO'));
      const payload = verifyToken(token);
      const usuario = await prisma.usuario.findUnique({
        where: { id: payload.userId },
        select: { activo: true, deletedAt: true },
      });
      if (!usuario || usuario.deletedAt || !usuario.activo) return next(new Error('SESION_REVOCADA'));
      payload.permisos = await getPermisosRol(payload.rol);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('TOKEN_INVALIDO'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AuthPayload;

    // Cliente se suscribe a los eventos de una sede — solo las que su rol autoriza.
    // admin/coordinadora → todas; recepción/contact center → solo las de su token.
    socket.on('suscribir:sede', (sedeId: string) => {
      if (typeof sedeId !== 'string' || !sedeAutorizada(user, sedeId)) return;
      socket.join(`sede:${sedeId}`);
    });

    socket.on('desuscribir:sede', (sedeId: string) => {
      socket.leave(`sede:${sedeId}`);
    });

    socket.on('disconnect', () => {
      // noop
    });
  });
}

export function emitirEventoCita(event: WSEvent): void {
  if (!io) return;
  io.to(`sede:${event.sedeId}`).emit('agenda:actualizada', event);
}

// Cambio de horario del personal (base semanal u override por fecha). Broadcast GLOBAL:
// afecta columnas de agenda y disponibilidad, y el emisor no siempre conoce la sede.
// Es una acción administrativa poco frecuente; el costo del broadcast es despreciable.
export function emitirHorarioActualizado(event: { profesionalId: string; fechas: string[] | null; global: boolean }): void {
  if (!io) return;
  io.emit('horario:actualizado', event);
}

export function getIO(): SocketServer {
  return io;
}
