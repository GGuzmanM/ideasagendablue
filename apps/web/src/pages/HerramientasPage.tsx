import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, addDays, isWeekend, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { pacientesApi, sedesApi, serviciosApi, type Sede, type Servicio } from '../api';

// ── Helpers ─────────────────────────────────────────────────────────────────

function proximoDiaHabil(base: Date): Date {
  let d = addDays(base, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

function fechaLocal(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// ── Tipos ────────────────────────────────────────────────────────────────────
interface Paciente {
  id: string;
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  numeroDocumento: string;
  telefono: string;
}

type Vista = 'inicio' | 'exportaciones' | 'marketing' | 'operaciones_personal' | 'comunicaciones' | 'config_sistema';

// ── Componente principal ─────────────────────────────────────────────────────
export function HerramientasPage() {
  const navigate = useNavigate();
  const tiene = useAuthStore(s => s.tiene);
  const esAdmin = useAuthStore.getState().usuario?.rol === 'admin';

  const [vista, setVista] = useState<Vista>('inicio');
  const [exportTab, setExportTab] = useState<'excel' | 'reactivacion' | 'pdf'>('excel');

  const verOperativas = tiene('herramientas.operativas') || tiene('herramientas.estrategicas');
  const verEstrategicas = tiene('herramientas.estrategicas');

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col">
      {/* Header Superior */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          {vista !== 'inicio' && (
            <button
              onClick={() => setVista('inicio')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-all mr-1"
              title="Volver a Herramientas"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">
              {vista === 'inicio'
                ? 'Herramientas'
                : vista === 'exportaciones'
                ? 'Exportaciones y Reportes'
                : vista === 'marketing'
                ? 'Marketing y Canales'
                : vista === 'operaciones_personal'
                ? 'Operaciones de Personal y Sedes'
                : vista === 'comunicaciones'
                ? 'Comunicaciones y Envíos'
                : 'Configuración del Sistema'}
            </h1>
            <p className="text-xs text-slate-500">
              {vista === 'inicio'
                ? 'Módulos y herramientas centralizadas de la clínica'
                : vista === 'exportaciones'
                ? 'Extracción de agendas en CSV/Excel, reactivación y reportes'
                : vista === 'marketing'
                ? 'Administración de promociones, canales de origen y membresías'
                : vista === 'operaciones_personal'
                ? 'Días especiales, composición de sedes y personal por solicitud'
                : vista === 'comunicaciones'
                ? 'Recordatorios por correo, servidores de envío y videos educativos'
                : 'Reglas avanzadas de agenda y conciliaciones'}
            </p>
          </div>
        </div>
      </div>

      {/* Vista de inicio (Hubs Principales) */}
      {vista === 'inicio' && (
        <div className="flex-1 p-8">
          <div className="mb-8">
            <h2 className="text-xl font-bold text-slate-900 mb-1">Módulos de Herramientas</h2>
            <p className="text-sm text-slate-500">Selecciona un área para acceder a sus funciones.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* 1. Exportaciones y Reportes */}
            {verOperativas && (
              <button
                onClick={() => setVista('exportaciones')}
                className="group bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-100 hover:border-emerald-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white flex items-center justify-center shadow-lg text-2xl group-hover:scale-105 transition-transform">
                    📊
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                    4 Herramientas
                  </span>
                </div>
                <p className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mb-1">Gestión de Datos</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">Exportaciones y Reportes</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Lista de citas (CSV), reactivación de pacientes (Excel), historial clínico (PDF) y reportes de RRHH.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Lista Citas</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Reactivación</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Historial PDF</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Reportes RRHH</span>
                </div>
              </button>
            )}

            {/* 2. Marketing y Canales */}
            {verEstrategicas && (
              <button
                onClick={() => setVista('marketing')}
                className="group bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-amber-100 hover:border-amber-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white flex items-center justify-center shadow-lg text-2xl group-hover:scale-105 transition-transform">
                    📣
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                    3 Herramientas
                  </span>
                </div>
                <p className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mb-1">Atracción y Ofertas</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">Marketing y Canales</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Administración de promociones, canales de origen de pacientes y catálogo de membresías.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Promociones</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Canales Reserva</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Membresías</span>
                </div>
              </button>
            )}

            {/* 3. Operaciones de Personal y Sedes */}
            {verEstrategicas && (
              <button
                onClick={() => setVista('operaciones_personal')}
                className="group bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-100 hover:border-indigo-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-700 text-white flex items-center justify-center shadow-lg text-2xl group-hover:scale-105 transition-transform">
                    👥
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-800">
                    3 Herramientas
                  </span>
                </div>
                <p className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mb-1">Gestión Operativa</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">Operaciones de Personal y Sedes</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Días especiales (domingos/feriados), composición mensual por sede y atenciones por solicitud.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Días Especiales</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Composición Sede</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Baropodometría Solicitud</span>
                </div>
              </button>
            )}

            {/* 4. Comunicaciones y Envíos */}
            {verOperativas && (
              <button
                onClick={() => setVista('comunicaciones')}
                className="group bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-sky-100 hover:border-sky-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white flex items-center justify-center shadow-lg text-2xl group-hover:scale-105 transition-transform">
                    ✉️
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-sky-100 text-sky-800">
                    3 Herramientas
                  </span>
                </div>
                <p className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mb-1">Mensajería y Avisos</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">Comunicaciones y Envíos</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Panel de recordatorios de cita por correo, servidor de envío y videos educativos por servicio.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Recordatorios Panel</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Config Mail</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Videos Servicio</span>
                </div>
              </button>
            )}

            {/* 5. Configuración Avanzada del Sistema */}
            {verEstrategicas && (
              <button
                onClick={() => setVista('config_sistema')}
                className="group bg-white rounded-2xl border border-slate-200 p-6 text-left transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-purple-100 hover:border-purple-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 text-white flex items-center justify-center shadow-lg text-2xl group-hover:scale-105 transition-transform">
                    ⚙️
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-800">
                    2 Herramientas
                  </span>
                </div>
                <p className="text-xxs font-semibold text-slate-400 uppercase tracking-wider mb-1">Reglas del Sistema</p>
                <h3 className="text-base font-bold text-slate-900 mb-2">Configuración del Sistema</h3>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  Bloques combinados de servicios en agenda y firma de saldos de paquetes migrados.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Bloques Combinados</span>
                  {esAdmin && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">Conciliación Genexis</span>}
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hub 1: Exportaciones y Reportes */}
      {vista === 'exportaciones' && (
        <div className="flex-1 flex flex-col p-6 space-y-6">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 items-center">
            <button
              onClick={() => setExportTab('excel')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
                exportTab === 'excel' ? 'bg-emerald-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>📄</span> Lista de Citas (CSV)
            </button>
            <button
              onClick={() => setExportTab('reactivacion')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
                exportTab === 'reactivacion' ? 'bg-purple-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>📈</span> Reactivación de Pacientes (Excel)
            </button>
            <button
              onClick={() => setExportTab('pdf')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 ${
                exportTab === 'pdf' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>📑</span> Historial Clínico (PDF)
            </button>
            <button
              onClick={() => navigate('/herramientas/reportes-rrhh')}
              className="ml-auto px-4 py-2 text-xs font-bold rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all flex items-center gap-2"
            >
              <span>📊</span> Reportes RRHH (Horas Extra & Rotación) →
            </button>
          </div>

          <div className="max-w-2xl">
            {exportTab === 'excel' && <ExcelTool />}
            {exportTab === 'reactivacion' && <ReactivacionTool />}
            {exportTab === 'pdf' && <PdfHistorialTool />}
          </div>
        </div>
      )}

      {/* Hub 2: Marketing y Canales */}
      {vista === 'marketing' && (
        <div className="flex-1 p-8 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => navigate('/herramientas/promociones')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-pink-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-pink-100 text-pink-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🎁
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Promociones y Descuentos</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Agrega o quita promociones y define precio o descuento aplicable en agendamiento.</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/canales')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-amber-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                📣
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Canales de Reserva</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Administra la lista de fuentes de origen de pacientes (Instagram, Recomendado, etc.).</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/membresias')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-violet-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🎫
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Catálogo de Membresías</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Crea y edita paquetes de membresías y distribución de sesiones por tratamiento.</p>
            </button>
          </div>
        </div>
      )}

      {/* Hub 3: Operaciones de Personal y Sedes */}
      {vista === 'operaciones_personal' && (
        <div className="flex-1 p-8 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => navigate('/herramientas/dias-especiales')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-amber-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                📅
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Días Especiales y Excepciones</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Habilita podólogas un domingo o feriado, u horarios extendidos de sede.</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/composicion-sede')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-indigo-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🏢
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Composición de Sedes</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Cuadro de personal por sede en el mes con exportador a PDF imprimible.</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/baro-solicitud')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-rose-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🦶
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Baropodometría por Solicitud</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Configura los especialistas que atienden baropodometría por solicitud directa.</p>
            </button>
          </div>
        </div>
      )}

      {/* Hub 4: Comunicaciones y Envíos */}
      {vista === 'comunicaciones' && (
        <div className="flex-1 p-8 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => navigate('/herramientas/recordatorios')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-sky-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🔔
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Panel de Recordatorios</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Estado de confirmaciones por correo, envíos automáticos y reprogramaciones.</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/confirmacion-mail')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-blue-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                ✉️
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Configuración de Correo</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Configura las credenciales y servidor de salida de correo institucional.</p>
            </button>
            <button
              onClick={() => navigate('/herramientas/videos-servicio')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-indigo-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-100 text-indigo-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🎬
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Videos por Servicio</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Programación de envíos de videos explicativos pre y post cita.</p>
            </button>
          </div>
        </div>
      )}

      {/* Hub 5: Configuración del Sistema */}
      {vista === 'config_sistema' && (
        <div className="flex-1 p-8 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => navigate('/herramientas/combinaciones')}
              className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-violet-300 group"
            >
              <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                🔗
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1">Bloques Combinados</h3>
              <p className="text-xs text-slate-500 leading-relaxed">Configuración del servicio ancla y combinación de turnos en 1 hora.</p>
            </button>
            {esAdmin && (
              <button
                onClick={() => navigate('/herramientas/conciliacion')}
                className="bg-white border border-slate-200 rounded-2xl p-6 text-left hover:shadow-lg transition-all hover:border-slate-400 group"
              >
                <div className="w-12 h-12 rounded-xl bg-slate-200 text-slate-700 text-2xl grid place-items-center mb-4 group-hover:scale-105 transition-transform">
                  🗄️
                </div>
                <h3 className="font-bold text-slate-900 text-base mb-1">Conciliación Genexis</h3>
                <p className="text-xs text-slate-500 leading-relaxed">Aprobación de saldos de apertura migrados del sistema anterior.</p>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Herramienta 1: Excel de citas ────────────────────────────────────────────
function ExcelTool() {
  const token = useAuthStore(s => s.token);
  const [fecha, setFecha] = useState<Date>(() => proximoDiaHabil(startOfDay(new Date())));
  const [sedeId, setSedeId] = useState<string>('');
  const [exportando, setExportando] = useState(false);

  const { data: sedes = [] } = useQuery<Sede[]>({
    queryKey: ['sedes-herramientas'],
    queryFn: () => sedesApi.listar(),
    staleTime: 5 * 60 * 1000,
  });

  const fechaStr = fechaLocal(fecha);
  const fechaDisplay = format(fecha, "EEEE d 'de' MMMM, yyyy", { locale: es });
  const sedeSeleccionada = sedes.find(s => s.id === sedeId);

  const descargar = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams({ fecha: fechaStr });
      if (sedeId) params.set('sedeId', sedeId);
      const res = await fetch(`/api/v1/exportar/citas?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al generar el archivo');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const sufijo = sedeSeleccionada ? `-${sedeSeleccionada.nombre.replace(/\s+/g, '-').toLowerCase()}` : '';
      a.download = `citas-limablue-${fechaStr}${sufijo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      const sedeLabel = sedeSeleccionada ? ` · ${sedeSeleccionada.nombre}` : ' · Todas las sedes';
      toast.success(`CSV descargado — ${fechaDisplay}${sedeLabel}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo descargar el CSV');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-emerald-600 to-teal-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Lista de citas · CSV</h2>
            <p className="text-emerald-100 text-xs">Exportar agenda del día (CSV, solo texto) para confirmaciones WhatsApp</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">
        {/* Selector de fecha */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Fecha de la agenda a exportar
          </label>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={fechaStr}
              onChange={e => {
                const d = new Date(e.target.value + 'T12:00:00');
                if (!isNaN(d.getTime())) setFecha(d);
              }}
              className="input flex-1"
            />
            <div className="flex gap-1.5">
              {[
                { label: 'Hoy', days: 0 },
                { label: 'Mañana', days: 1 },
                { label: 'Próx. lunes', days: null },
              ].map(({ label, days }) => (
                <button
                  key={label}
                  onClick={() => {
                    if (days !== null) {
                      setFecha(addDays(startOfDay(new Date()), days));
                    } else {
                      setFecha(proximoDiaHabil(startOfDay(new Date())));
                    }
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500 capitalize">{fechaDisplay}</p>
        </div>

        {/* Filtro de sede */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Sede
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSedeId('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                sedeId === ''
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              Todas las sedes
            </button>
            {sedes.map(s => (
              <button
                key={s.id}
                onClick={() => setSedeId(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  sedeId === s.id
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
                style={sedeId === s.id ? { backgroundColor: s.color, borderColor: s.color } : {}}
              >
                {s.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Campos incluidos */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Columnas del CSV</p>
          <div className="grid grid-cols-2 gap-y-1 gap-x-4">
            {['Número (+51 si son 9 dígitos)', 'Nombre completo', 'Día', 'Hora', 'Sede', 'Dirección'].map(c => (
              <div key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-xxs flex-shrink-0">✓</span>
                {c}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xxs text-slate-400">CSV de solo texto · Solo citas activas (excluye canceladas y no-shows) · Respeta otros códigos de país (+1, etc.)</p>
        </div>

        {/* Botón */}
        <button
          onClick={descargar}
          disabled={exportando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm shadow-emerald-900/20"
        >
          {exportando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando CSV…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar CSV
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Herramienta 2: PDF historial de paciente ─────────────────────────────────
function PdfHistorialTool() {
  const token = useAuthStore(s => s.token);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState<Paciente | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data: resultados, isLoading: buscando } = useQuery({
    queryKey: ['pacientes-busqueda-herramientas', debouncedQuery],
    queryFn: async () => {
      if (debouncedQuery.trim().length < 2) return [];
      const res = await pacientesApi.buscar(debouncedQuery.trim());
      return res as unknown as Paciente[];
    },
    enabled: debouncedQuery.trim().length >= 2 && !pacienteSeleccionado,
  });

  const handleSelect = (p: Paciente) => {
    setPacienteSeleccionado(p);
    setQuery(`${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`);
    setShowDropdown(false);
  };

  const descargarPDF = async () => {
    if (!pacienteSeleccionado) return;
    setDescargando(true);
    try {
      const res = await fetch(`/api/v1/exportar/historial/${pacienteSeleccionado.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al generar el PDF');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historial-${pacienteSeleccionado.apellidoPaterno}-${pacienteSeleccionado.nombres}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`PDF descargado — ${pacienteSeleccionado.nombres} ${pacienteSeleccionado.apellidoPaterno}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el PDF');
    } finally {
      setDescargando(false);
    }
  };

  const limpiar = () => {
    setPacienteSeleccionado(null);
    setQuery('');
    setDebouncedQuery('');
    setShowDropdown(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Historial de Atenciones · PDF</h2>
            <p className="text-indigo-100 text-xs">Resumen de atenciones del paciente</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">
        {/* Buscador de paciente */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Buscar paciente
          </label>
          <div className="relative">
            <div className="relative flex items-center">
              <svg className="absolute left-3 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  if (pacienteSeleccionado) setPacienteSeleccionado(null);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Buscar por nombre, apellido o DNI…"
                className="input pl-9 pr-8 w-full"
              />
              {(buscando) && (
                <span className="absolute right-3 w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
              )}
              {pacienteSeleccionado && (
                <button onClick={limpiar} className="absolute right-3 text-slate-400 hover:text-slate-600 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Dropdown de resultados */}
            {showDropdown && !pacienteSeleccionado && resultados && resultados.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                {resultados.slice(0, 8).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors flex items-center gap-3 border-b border-slate-100 last:border-0"
                  >
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-indigo-700 font-bold text-xs">
                        {p.nombres[0]}{p.apellidoPaterno[0]}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {p.nombres} {p.apellidoPaterno} {p.apellidoMaterno}
                      </p>
                      <p className="text-xs text-slate-500">{p.numeroDocumento} · {p.telefono}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {debouncedQuery.length >= 2 && !buscando && resultados?.length === 0 && !pacienteSeleccionado && (
            <p className="mt-1.5 text-xs text-slate-400">No se encontraron pacientes con "{debouncedQuery}"</p>
          )}
        </div>

        {/* Card del paciente seleccionado */}
        {pacienteSeleccionado ? (
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">
                {pacienteSeleccionado.nombres[0]}{pacienteSeleccionado.apellidoPaterno[0]}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900 text-sm">
                {pacienteSeleccionado.nombres} {pacienteSeleccionado.apellidoPaterno} {pacienteSeleccionado.apellidoMaterno}
              </p>
              <p className="text-xs text-slate-500">{pacienteSeleccionado.numeroDocumento} · {pacienteSeleccionado.telefono}</p>
            </div>
            <svg className="w-5 h-5 text-indigo-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-slate-100 border-dashed p-4 flex items-center gap-3 text-slate-400">
            <svg className="w-8 h-8 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-sm">Busca y selecciona un paciente para generar su historial en PDF</p>
          </div>
        )}

        {/* Contenido del PDF */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">El PDF incluye</p>
          <div className="space-y-1">
            {[
              'Datos del paciente en cabecera (nombre, DNI, teléfono, email, fecha de nacimiento)',
              'Estadísticas de asistencia (total, completadas, no-shows, canceladas)',
              'Lista completa de atenciones con estado visual (✓ asistió, ✗ no asistió, ○ cancelada)',
              'Profesional, servicio, sede y unidad por cada cita',
            ].map(item => (
              <div key={item} className="flex items-start gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xxs flex-shrink-0 mt-0.5">✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Botón */}
        <button
          onClick={descargarPDF}
          disabled={!pacienteSeleccionado || descargando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-indigo-900/20"
        >
          {descargando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando PDF…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar PDF
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Herramienta 3: Reactivación de pacientes ─────────────────────────────────
const DIAS_OPCIONES = [
  { label: '+30 días', value: 30 },
  { label: '+60 días', value: 60 },
  { label: '+90 días', value: 90 },
  { label: '+6 meses', value: 180 },
  { label: '+1 año',   value: 365 },
];

const MIN_VISITAS_OPCIONES = [
  { label: '1+ visita',   value: 1 },
  { label: '2+ visitas',  value: 2 },
  { label: '3+ visitas',  value: 3 },
  { label: '5+ visitas',  value: 5 },
];

function ReactivacionTool() {
  const token = useAuthStore(s => s.token);
  const [dias, setDias] = useState(90);
  const [fechaCorte, setFechaCorte] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [sedeId, setSedeId] = useState('');
  const [servicioId, setServicioId] = useState('');
  const [minVisitas, setMinVisitas] = useState(1);
  const [exportando, setExportando] = useState(false);

  const rangoActivo = !!(fechaDesde && fechaHasta);

  const { data: sedes = [] } = useQuery<Sede[]>({
    queryKey: ['sedes-herramientas'],
    queryFn: () => sedesApi.listar(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: servicios = [] } = useQuery<Servicio[]>({
    queryKey: ['servicios-herramientas'],
    queryFn: () => serviciosApi.listar({ activo: true }),
    staleTime: 5 * 60 * 1000,
  });

  const descargar = async () => {
    setExportando(true);
    try {
      const params = new URLSearchParams({ minVisitas: String(minVisitas) });
      if (rangoActivo) {
        params.set('fechaDesde', fechaDesde);
        params.set('fechaHasta', fechaHasta);
      } else if (fechaCorte) {
        params.set('fechaCorte', fechaCorte);
      } else {
        params.set('diasSinVisitar', String(dias));
      }
      if (sedeId) params.set('sedeId', sedeId);
      if (servicioId) params.set('servicioId', servicioId);
      const res = await fetch(`/api/v1/exportar/reactivacion?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Error al generar el archivo');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reactivacion-limablue-${dias}dias.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      const etiqueta = rangoActivo
        ? `última visita entre ${fechaDesde.split('-').reverse().join('/')} y ${fechaHasta.split('-').reverse().join('/')}`
        : fechaCorte
          ? `última visita antes del ${fechaCorte.split('-').reverse().join('/')}`
          : `sin visitar en +${dias} días`;
      toast.success(`Excel descargado — ${etiqueta}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'No se pudo generar el Excel');
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="bg-gradient-to-br from-violet-600 to-purple-700 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-base">Reactivación de Pacientes</h2>
            <p className="text-violet-100 text-xs">Pacientes que llevan tiempo sin visitar Limablue</p>
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="p-5 space-y-5">

        {/* Tiempo sin visitar */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Tiempo sin visitar
          </label>
          <div className="flex flex-wrap gap-2">
            {DIAS_OPCIONES.map(op => (
              <button
                key={op.value}
                onClick={() => { setDias(op.value); setFechaCorte(''); setFechaDesde(''); setFechaHasta(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  dias === op.value && !fechaCorte && !rangoActivo
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                {op.label}
              </button>
            ))}
          </div>

          {/* Última fecha de visita */}
          <div className="mt-3">
            <label className="block text-xxs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              O elige una última fecha de visita exacta
            </label>
            <div className="relative flex items-center">
              <input
                type="date"
                value={fechaCorte}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaCorte(e.target.value); if (e.target.value) { setDias(0); setFechaDesde(''); setFechaHasta(''); } }}
                className={`input w-full pr-8 ${fechaCorte ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
              />
              {fechaCorte && (
                <button
                  onClick={() => { setFechaCorte(''); setDias(90); }}
                  className="absolute right-2.5 text-slate-400 hover:text-red-500 transition-colors"
                  title="Limpiar fecha"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {fechaCorte && (
              <p className="mt-1.5 text-xs text-violet-600 font-medium">
                Pacientes cuya última visita fue antes del {fechaCorte.split('-').reverse().join('/')}
              </p>
            )}
          </div>

          {/* Rango de fechas de última visita */}
          <div className="mt-3">
            <label className="block text-xxs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">
              O elige un rango de fechas de última visita
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fechaDesde}
                max={fechaHasta || format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaDesde(e.target.value); if (e.target.value && fechaHasta) { setDias(0); setFechaCorte(''); } }}
                className={`input w-full ${rangoActivo ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
                title="Desde"
              />
              <span className="text-slate-400 text-xs shrink-0">a</span>
              <input
                type="date"
                value={fechaHasta}
                min={fechaDesde || undefined}
                max={format(new Date(), 'yyyy-MM-dd')}
                onChange={e => { setFechaHasta(e.target.value); if (e.target.value && fechaDesde) { setDias(0); setFechaCorte(''); } }}
                className={`input w-full ${rangoActivo ? 'border-violet-400 ring-1 ring-violet-300' : ''}`}
                title="Hasta"
              />
              {(fechaDesde || fechaHasta) && (
                <button
                  onClick={() => { setFechaDesde(''); setFechaHasta(''); setDias(90); }}
                  className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                  title="Limpiar rango"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {rangoActivo && (
              <p className="mt-1.5 text-xs text-violet-600 font-medium">
                Pacientes cuya última visita fue entre el {fechaDesde.split('-').reverse().join('/')} y el {fechaHasta.split('-').reverse().join('/')}
              </p>
            )}
            {(fechaDesde || fechaHasta) && !rangoActivo && (
              <p className="mt-1.5 text-xs text-amber-600 font-medium">Completa ambas fechas para aplicar el rango.</p>
            )}
          </div>
        </div>

        {/* Filtro sede */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Sede de última visita
          </label>
          <select
            value={sedeId}
            onChange={e => setSedeId(e.target.value)}
            className="input w-full"
          >
            <option value="">Todas las sedes</option>
            {sedes.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Filtro servicio */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Último servicio recibido
          </label>
          <select
            value={servicioId}
            onChange={e => setServicioId(e.target.value)}
            className="input w-full"
          >
            <option value="">Todos los servicios</option>
            {servicios.map(s => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </select>
        </div>

        {/* Mínimo de visitas */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2 uppercase tracking-wide">
            Mínimo de visitas completadas
          </label>
          <div className="flex flex-wrap gap-2">
            {MIN_VISITAS_OPCIONES.map(op => (
              <button
                key={op.value}
                onClick={() => setMinVisitas(op.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  minVisitas === op.value
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300 hover:text-violet-700'
                }`}
              >
                {op.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xxs text-slate-400">Excluye pacientes con pocas visitas para enfocarte en clientes recurrentes</p>
        </div>

        {/* Campos del Excel */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">Campos incluidos en el Excel</p>
          <div className="grid grid-cols-2 gap-y-1 gap-x-4">
            {['Nombres', 'Apellidos', 'Teléfono', 'Email', 'Último servicio', 'Fecha última visita', 'Días sin visitar', 'Sede última visita', 'Total visitas'].map(c => (
              <div key={c} className="flex items-center gap-1.5 text-xs text-slate-600">
                <span className="w-3.5 h-3.5 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center font-bold text-xxs flex-shrink-0">✓</span>
                {c}
              </div>
            ))}
          </div>
          <p className="mt-2 text-xxs text-slate-400">Ordenado por días sin visitar (mayor a menor) · Colores: rojo +1 año · naranja +6 meses · verde reciente</p>
        </div>

        {/* Botón */}
        <button
          onClick={descargar}
          disabled={exportando}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-all shadow-sm shadow-violet-900/20"
        >
          {exportando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generando Excel…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" />
              </svg>
              Descargar Excel
            </>
          )}
        </button>
      </div>
    </div>
  );
}
