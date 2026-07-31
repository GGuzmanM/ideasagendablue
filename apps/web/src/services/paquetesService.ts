import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { paquetesApi, serviciosApi, type PlantillaPaquete } from '../api';

export function usePaquetesData() {
  const qc = useQueryClient();
  const [editando, setEditando] = useState<PlantillaPaquete | null>(null);
  const [creando, setCreando] = useState(false);

  const { data: paquetes, isLoading } = useQuery({
    queryKey: ['paquetes-admin'],
    queryFn: paquetesApi.plantillas,
  });

  const { data: servicios } = useQuery({
    queryKey: ['servicios-todos'],
    queryFn: () => serviciosApi.listar({ activo: true }),
  });

  const crearMut = useMutation({
    mutationFn: paquetesApi.crear,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paquetes-admin'] });
      setCreando(false);
      toast.success('Paquete creado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const actualizarMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof paquetesApi.actualizar>[1] }) => paquetesApi.actualizar(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paquetes-admin'] });
      setEditando(null);
      toast.success('Paquete actualizado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const eliminarMut = useMutation({
    mutationFn: paquetesApi.eliminar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['paquetes-admin'] });
      toast.success('Paquete eliminado');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    paquetes,
    servicios,
    isLoading,
    editando,
    setEditando,
    creando,
    setCreando,
    crearMut,
    actualizarMut,
    eliminarMut,
  };
}
