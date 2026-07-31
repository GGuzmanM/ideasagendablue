import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { competenciasApi, serviciosApi, profesionalesApi, sedesApi } from '../api';

export function useCompetenciasData() {
  const qc = useQueryClient();
  const [filtroProf, setFiltroProf]     = useState('');
  const [sedeIdFiltro, setSedeIdFiltro] = useState<string>('todas');
  const [unidadFiltro, setUnidadFiltro] = useState<string>('todas');
  const [pendientes, setPendientes]      = useState<Record<string, boolean>>({});

  const { data: sedes }         = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const { data: competencias }  = useQuery({ queryKey: ['competencias'], queryFn: () => competenciasApi.listar() });
  const { data: profesionales } = useQuery({ queryKey: ['profesionales-todos'], queryFn: () => profesionalesApi.listar({ activo: true }) });
  const { data: servicios }     = useQuery({ queryKey: ['servicios-todos'], queryFn: () => serviciosApi.listar({ activo: true }) });

  const toggleMutation = useMutation({
    mutationFn: ({ profesionalId, servicioId, activa }: { profesionalId: string; servicioId: string; activa: boolean }) =>
      competenciasApi.toggle(profesionalId, servicioId, activa),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['competencias'] });
      setPendientes(p => { const n = { ...p }; delete n[`${vars.profesionalId}::${vars.servicioId}`]; return n; });
    },
    onError: (e: Error, vars) => {
      toast.error(e.message);
      setPendientes(p => { const n = { ...p }; delete n[`${vars.profesionalId}::${vars.servicioId}`]; return n; });
    },
  });

  const toggle = (profesionalId: string, servicioId: string, activa: boolean) => {
    const key = `${profesionalId}::${servicioId}`;
    setPendientes(p => ({ ...p, [key]: true }));
    toggleMutation.mutate({ profesionalId, servicioId, activa });
    toast.success(activa ? '✓ Competencia agregada' : 'Competencia quitada', { duration: 1500 });
  };

  const tieneCompetencia = (profId: string, servId: string) =>
    competencias?.some(c => c.profesional.id === profId && c.servicio.id === servId && c.activa) ?? false;

  // Profesionales asignados a la sede seleccionada
  const profsFiltrados = (profesionales ?? [])
    .filter(p => p.tipo !== 'medico') // excluir Baros (no tienen competencias)
    .filter(p => sedeIdFiltro === 'todas' || p.sedeActual?.id === sedeIdFiltro)
    .filter(p => filtroProf === '' || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(filtroProf.toLowerCase()));

  // Unidades de negocio disponibles
  const unidades = [...new Set((servicios ?? []).map(s => s.unidadNegocio.nombre))];

  const servsFiltrados = (servicios ?? [])
    .filter(s => unidadFiltro === 'todas' || s.unidadNegocio.nombre === unidadFiltro);

  // Bulk: activar/desactivar toda una fila o columna
  const toggleFila = (profId: string, activar: boolean, nombreProf: string) => {
    const msg = activar
      ? `¿Estás segura de agregar todos los servicios a ${nombreProf}?`
      : `¿Estás segura de quitar todos los servicios a ${nombreProf}?`;
    if (!confirm(msg)) return;
    servsFiltrados.forEach(s => {
      const tiene = tieneCompetencia(profId, s.id);
      if (activar !== tiene) toggle(profId, s.id, activar);
    });
  };

  const toggleColumna = (servId: string, activar: boolean, nombreServ: string) => {
    const msg = activar
      ? `¿Estás segura de agregar "${nombreServ}" a todas las profesionales?`
      : `¿Estás segura de quitar "${nombreServ}" a todas las profesionales?`;
    if (!confirm(msg)) return;
    profsFiltrados.forEach(p => {
      const tiene = tieneCompetencia(p.id, servId);
      if (activar !== tiene) toggle(p.id, servId, activar);
    });
  };

  // Resumen de cobertura
  const totalCeldas = profsFiltrados.length * servsFiltrados.length;
  const totalActivas = profsFiltrados.reduce((acc, p) =>
    acc + servsFiltrados.filter(s => tieneCompetencia(p.id, s.id)).length, 0);
  const pct = totalCeldas > 0 ? Math.round((totalActivas / totalCeldas) * 100) : 0;

  return {
    sedes,
    competencias,
    profesionales,
    servicios,
    filtroProf,
    setFiltroProf,
    sedeIdFiltro,
    setSedeIdFiltro,
    unidadFiltro,
    setUnidadFiltro,
    pendientes,
    toggle,
    tieneCompetencia,
    profsFiltrados,
    unidades,
    servsFiltrados,
    toggleFila,
    toggleColumna,
    totalCeldas,
    totalActivas,
    pct,
  };
}
