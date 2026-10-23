import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { AVISOS_PARCHABLES, parchearCita, programarRecarga } from '../services/agendaTiempoReal';

let socket: Socket | null = null;
// Sede a la que ESTA pestaña está suscrita. Vive fuera del hook para poder re-suscribir al reconectar.
let sedeSuscrita: string | null = null;

export function useSocket(sedeId: string | null) {
  const qc = useQueryClient();
  const sedeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) {
      // El token se pasa como función: socket.io la re-evalúa en cada (re)conexión, así
      // siempre viaja el token vigente (tras login/refresh) sin recrear el socket.
      socket = io({
        path: '/socket.io',
        transports: ['websocket'],
        auth: (cb) => cb({ token: useAuthStore.getState().token ?? '' }),
      });
      // RECONEXIÓN (se cae el wifi de la tablet, se reinicia el API): el servidor crea un socket NUEVO sin
      // ninguna sala. Antes la suscripción solo se enviaba al cambiar de sede → tras un corte la agenda
      // dejaba de recibir avisos en silencio hasta recargar la página.
      socket.on('connect', () => { if (sedeSuscrita) socket?.emit('suscribir:sede', sedeSuscrita); });
      // CAMBIO DE USUARIO sin recargar (turno de la tarde en la misma tablet): el socket seguía autenticado
      // como la persona anterior y el servidor validaba la sede contra ELLA. Se corta y se vuelve a abrir
      // con el token nuevo (o se queda cerrado si nadie inició sesión).
      useAuthStore.subscribe((s, prev) => {
        if (s.token === prev.token || !socket) return;
        socket.disconnect();
        if (s.token) socket.connect();
      });
    }

    if (sedeId && sedeId !== sedeRef.current) {
      if (sedeRef.current) socket.emit('desuscribir:sede', sedeRef.current);
      socket.emit('suscribir:sede', sedeId);
      sedeRef.current = sedeId;
      sedeSuscrita = sedeId;
    }

    const citaHandler = (event: { tipo: string; sedeId: string; fecha: string; cita: unknown; cambiadoPor: string }) => {
      if (event.sedeId !== sedeId) return;
      // El detalle abierto de esa cita se refresca al instante (no espera su poll de 10 s).
      const cita = event.cita as { id?: string; fecha?: string } | null;
      const citaId = cita?.id;
      const yo = useAuthStore.getState().usuario?.id;
      // El detalle abierto se refresca al instante; el autor ya lo tiene al día con la respuesta de su propia acción.
      if (citaId && event.cambiadoPor !== yo) qc.invalidateQueries({ queryKey: ['cita-detalle', citaId] });
      // 23-oct-2026 (rendimiento): la cita del aviso se aplica directo a las listas de la agenda y del visor, sin volver
      // a pedir la lista del día. Lo demás (contadores, ocupación, disponibilidad) se recarga agrupado (varios avisos
      // seguidos = una recarga). La lista completa solo se pide si esta pantalla no tenía la cita (p. ej. una cita nueva).
      const parcheada = !!citaId && AVISOS_PARCHABLES.has(event.tipo)
        && parchearCita(qc, { ...(cita as object), id: citaId }, event.sedeId, event.fecha);
      // El autor del cambio ya recargó con su propia acción: no se repite (antes pedía todo dos veces).
      if (!(event.cambiadoPor === yo && parcheada)) programarRecarga(qc, event.sedeId, event.fecha, !parcheada);

      const mensajes: Record<string, string> = {
        'cita:creada': 'Nueva cita agendada',
        'cita:movida': 'Cita reprogramada',
        'cita:estadoCambiado': 'Estado de cita actualizado',
        'cita:cancelada': 'Cita cancelada',
      };
      const msg = mensajes[event.tipo];
      // Al autor del cambio no se le repite el aviso (ya vio el toast de su propia acción).
      if (msg && event.cambiadoPor !== yo) toast(msg, { icon: '🔄', duration: 3000 });
    };

    const movimientoHandler = (event: {
      profesionalId: string;
      sedeId: string;
      sedeAnteriorId: string | null;
      fechaInicio: string;
      fechaFin: string | null;
    }) => {
      // Una sola invalidación por prefijo cubre todas las sedes y fechas (antes se repetía la misma
      // invalidación hasta 90 veces, una por día del rango, y disparaba cientos de refetch).
      qc.invalidateQueries({ queryKey: ['profesionales-sede'] });
      qc.invalidateQueries({ queryKey: ['seleccionables'] });
      qc.invalidateQueries({ queryKey: ['movimientos'] });
      toast('Asignación de sede actualizada', { icon: '🔄', duration: 3000 });
    };

    // Cambio de horario del personal (base semanal u override por fecha). El backend lo
    // emite de forma centralizada (horarioService) — aquí basta refrescar todo lo que
    // depende del turno: columnas de agenda, slots y las pantallas de gestión de horarios.
    const horarioHandler = () => {
      // 'turnos-profesionales' es la que PINTA «No labora» en la grilla: sin ella, un turno extendido por
      // coordinación seguía bloqueado en la agenda abierta de recepción hasta recargar.
      const claves = ['profesionales-sede', 'turnos-profesionales', 'bloqueos-almuerzo', 'permisos-agenda', 'disponibilidad', 'horarios-entrada', 'personal-excepcion', 'horario-semanal', 'dia-especial'];
      qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === 'string' && claves.includes(q.queryKey[0]),
      });
    };

    // Aparato del consultorio: INICIO / FIN o cierre de un tiempo. Refresca el detalle de la cita
    // tocada (chip «Tratamiento») y el tratamiento en curso de Administración › Aparatos.
    const tiemposHandler = (event: { sedeId: string; fecha: string; citaId: string | null }) => {
      if (event.sedeId !== sedeId) return;
      if (event.citaId) qc.invalidateQueries({ queryKey: ['cita-detalle', event.citaId] });
      qc.invalidateQueries({ queryKey: ['dispositivos'] });
    };

    socket.on('agenda:actualizada', citaHandler);
    socket.on('movimiento:guardado', movimientoHandler);
    socket.on('horario:actualizado', horarioHandler);
    socket.on('tiempos:actualizados', tiemposHandler);
    return () => {
      socket?.off('agenda:actualizada', citaHandler);
      socket?.off('movimiento:guardado', movimientoHandler);
      socket?.off('horario:actualizado', horarioHandler);
      socket?.off('tiempos:actualizados', tiemposHandler);
    };
  }, [sedeId, qc]);
}
