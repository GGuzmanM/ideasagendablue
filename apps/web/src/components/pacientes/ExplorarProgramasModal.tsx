// Modal "Explorar Programas" (desde la ficha del paciente, cuando no tiene membresía activa):
// lista las membresías disponibles para VER, y al elegir una abre el flujo de venta con el
// paciente YA fijado (reutiliza VenderMembresia). El botón que lo abre está en SaldoPaquetes.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { sedesApi } from '../../api';
import { VenderMembresia, type Membresia } from '../../pages/herramientas/MembresiasPage';

export function ExplorarProgramasModal({ pacienteId, nombrePaciente, onCerrar, onVendida }: {
  pacienteId: string;
  nombrePaciente: string;
  onCerrar: () => void;
  onVendida: () => void;
}) {
  const [sel, setSel] = useState<Membresia | null>(null);
  const { data: membresias, isLoading } = useQuery({ queryKey: ['membresias'], queryFn: () => api.get<Membresia[]>('/membresias') });
  const { data: sedes } = useQuery({ queryKey: ['sedes'], queryFn: sedesApi.listar });
  const activas = (membresias ?? []).filter((m) => m.activo);

  // Elegida una membresía → pasa al flujo de venta con el paciente fijado (no se busca).
  if (sel) {
    return (
      <VenderMembresia
        membresia={sel}
        sedes={sedes ?? []}
        pacienteInicial={{ id: pacienteId, nombre: nombrePaciente }}
        onCerrar={() => setSel(null)}
        onVendida={onVendida}
      />
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-inverse-surface/40 backdrop-blur-[2px]" onClick={onCerrar} />
      <div className="fixed z-[80] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-w-[95vw] max-h-[90vh] overflow-hidden bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/30 flex flex-col" role="dialog">
        <div className="bg-[#0044ab] px-5 py-3.5 flex items-center gap-2.5 shrink-0">
          <span className="material-symbols-outlined text-white/90">loyalty</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-sm truncate">Programas y membresías</h2>
            <p className="text-white/80 text-[11px] truncate">Elige un plan para {nombrePaciente}</p>
          </div>
          <button onClick={onCerrar} className="material-symbols-outlined text-white/80 hover:text-white">close</button>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <p className="text-sm text-on-surface-variant text-center py-8">Cargando programas…</p>
          ) : activas.length === 0 ? (
            <p className="text-sm text-on-surface-variant text-center py-8">No hay membresías activas para vender.</p>
          ) : (
            activas.map((m) => (
              <button
                key={m.id}
                onClick={() => setSel(m)}
                className="w-full text-left rounded-xl border border-outline-variant/40 hover:border-primary hover:bg-primary/5 transition-all p-3.5 group"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-on-surface text-sm">{m.nombre}</h3>
                    {m.descripcion && <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">{m.descripcion}</p>}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {m.composicion.map((i, idx) => (
                        <span key={idx} className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant text-[10px] font-semibold border border-outline-variant/30">
                          {i.cantidad}× {i.etiqueta ?? i.subcategoriaEtiqueta ?? 'Servicio'}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {m.precio != null && <p className="font-bold text-primary text-sm whitespace-nowrap">S/ {Number(m.precio).toFixed(2)}</p>}
                    <p className="text-[11px] text-on-surface-variant mt-0.5">{m.totalSesiones} sesiones</p>
                    {m.duracionMeses != null && <p className="text-[10px] text-on-surface-variant/70">{m.duracionMeses} meses de vigencia</p>}
                  </div>
                </div>
                <div className="mt-2.5 text-[11px] font-bold text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                  Seleccionar y vender <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
