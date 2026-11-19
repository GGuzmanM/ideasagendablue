import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { useAuthStore } from '../../stores/authStore';
import { useNavidadStore, type PersonajeNavidad } from '../../stores/navidadStore';
import {
  StitchPixel,
  TRexPixel,
  CapibaraPixel,
  HarryPixel,
  BobPixel,
  CrashPixel,
  PixelesArbol,
  ARBOL,
  personajePredeterminado,
} from './EscenaPixel';

interface OpcionPersonaje {
  id: PersonajeNavidad;
  nombre: string;
  subtitulo: string;
  descripcion: string;
  render: (lado: number) => ReactNode;
  esRecomendado: (email?: string | null, rol?: string | null) => boolean;
}

const OPCIONES: OpcionPersonaje[] = [
  {
    id: 'crash',
    nombre: 'Marsupial Intrépido',
    subtitulo: 'Aventurero naranja de enorme sonrisa',
    descripcion: 'Energía pura con jeans azules, rodilleras de aventura y gorrito navideño.',
    render: (lado) => <CrashPixel lado={lado} />,
    esRecomendado: (email) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('da.sirvas') || e.startsWith('dasirvas');
    },
  },
  {
    id: 'stitch',
    nombre: 'Experimento Azul',
    subtitulo: 'Monstruito espacial tierno y festivo',
    descripcion: 'Grandes orejas rosadas, pelaje azul brillante y un pompón navideño esponjoso.',
    render: (lado) => {
      const e = (lado);
      return <StitchPixel lado={e} />;
    },
    esRecomendado: (email) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('de.chigne') || e.startsWith('dechigne') || e.startsWith('al.leyva') || e.startsWith('alleyva');
    },
  },
  {
    id: 'harry',
    nombre: 'Joven Hechicero',
    subtitulo: 'Mago aprendiz con bufanda mágica',
    descripcion: 'Lentes redondos, bufanda granate-oro y varita mágica con chispitas navideñas.',
    render: (lado) => <HarryPixel lado={lado} />,
    esRecomendado: (email) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('ja.ruiz') || e.startsWith('jaruiz');
    },
  },
  {
    id: 'bob',
    nombre: 'Esponja Marina',
    subtitulo: 'Alegre habitante del arrecife',
    descripcion: 'Cuerpo amarillo poroso, corbata roja, zapatitos pulcros y sonrisa contagiosa.',
    render: (lado) => <BobPixel lado={lado} />,
    esRecomendado: (email) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('institucional');
    },
  },
  {
    id: 'dino',
    nombre: 'T-Rex Festivo',
    subtitulo: 'Pequeño dinosaurio de gran corazón',
    descripcion: 'Divertido tiranosaurio verde con bufanda abrigada y gorro de Papá Noel.',
    render: (lado) => <TRexPixel lado={lado} />,
    esRecomendado: (email) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('da.santos') || e.startsWith('dasantos');
    },
  },
  {
    id: 'capibara',
    nombre: 'Capibara Serena',
    subtitulo: 'El animal más tranquilo y zen',
    descripcion: 'Pelaje castaño suave, gorrito de duende festivo y bastoncito de caramelo.',
    render: (lado) => <CapibaraPixel lado={lado} />,
    esRecomendado: (email, rol) => {
      const e = (email ?? '').toLowerCase();
      return e.startsWith('ga.mancilla') || e.startsWith('gamancilla') || rol === 'admin';
    },
  },
  {
    id: 'arbol',
    nombre: 'Solo el Arbolito',
    subtitulo: 'Estilo clásico y minimalista',
    descripcion: 'Pino navideño tradicional con estrella dorada y guirnalda de luces titilantes.',
    render: (lado) => <PixelesArbol mapa={ARBOL} lado={lado} />,
    esRecomendado: () => false,
  },
];

export function ModalSelectorPersonaje() {
  const abierto = useNavidadStore((s) => s.modalSelectorAbierto);
  const cerrar = useNavidadStore((s) => s.cerrarModalSelector);
  const personajeActual = useNavidadStore((s) => s.personaje);
  const setPersonaje = useNavidadStore((s) => s.setPersonaje);

  const usuario = useAuthStore((s) => s.usuario);
  const predeterminado = personajePredeterminado(usuario?.email, usuario?.rol);
  const seleccionado = personajeActual ?? predeterminado;

  // Cerrar con Escape:
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [abierto, cerrar]);

  if (!abierto) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-navidad-titulo"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-white/15 rounded-3xl shadow-2xl overflow-hidden text-white">
        {/* Cabecera con ambientación navideña */}
        <div className="relative p-5 sm:p-6 pb-4 border-b border-white/10 bg-gradient-to-r from-red-950/40 via-slate-900 to-emerald-950/40">
          <button
            type="button"
            onClick={cerrar}
            title="Cerrar ventana"
            className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white grid place-items-center text-sm font-bold transition-colors"
          >
            ✕
          </button>
          <div className="flex items-center gap-3">
            <span className="text-3xl select-none" aria-hidden>
              🎄
            </span>
            <div>
              <h2 id="modal-navidad-titulo" className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
                Elige tu Compañero Navideño
                <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Edición 2026
                </span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-300/85 mt-0.5">
                Selecciona la mascota que acompañará el arbolito en el menú lateral durante esta temporada.
              </p>
            </div>
          </div>
        </div>

        {/* Grilla de personajes */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {OPCIONES.map((opcion) => {
              const esActivo = seleccionado === opcion.id;
              const recomendado = opcion.esRecomendado(usuario?.email, usuario?.rol);

              return (
                <div
                  key={opcion.id}
                  onClick={() => setPersonaje(opcion.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPersonaje(opcion.id);
                    }
                  }}
                  className={cn(
                    'group relative rounded-2xl p-4 flex flex-col items-center text-center cursor-pointer transition-all duration-200 border',
                    esActivo
                      ? 'bg-emerald-950/30 border-emerald-500 ring-2 ring-emerald-500/40 shadow-lg shadow-emerald-950/50'
                      : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] hover:border-white/25 hover:shadow-md',
                  )}
                >
                  {/* Badges superiores */}
                  <div className="w-full flex items-center justify-between min-h-[22px] mb-1">
                    {recomendado ? (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        ⭐ Para ti
                      </span>
                    ) : <span />}

                    {esActivo && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-slate-950 flex items-center gap-1 shadow">
                        ✓ Activo
                      </span>
                    )}
                  </div>

                  {/* Escaparate Pixel Art */}
                  <div className="h-28 w-full flex items-center justify-center my-1 group-hover:scale-105 transition-transform duration-200">
                    {opcion.render(2.3)}
                  </div>

                  {/* Textos */}
                  <h3 className="font-bold text-sm text-white group-hover:text-amber-200 transition-colors">
                    {opcion.nombre}
                  </h3>
                  <p className="text-[11px] font-medium text-emerald-400/90 mt-0.5">
                    {opcion.subtitulo}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                    {opcion.descripcion}
                  </p>

                  {/* Botón de acción */}
                  <div className="mt-3.5 w-full pt-2 border-t border-white/5">
                    <span
                      className={cn(
                        'w-full inline-block py-1.5 px-3 rounded-xl text-xs font-semibold transition-all',
                        esActivo
                          ? 'bg-emerald-500 text-slate-950 shadow'
                          : 'bg-white/10 group-hover:bg-white/20 text-white',
                      )}
                    >
                      {esActivo ? 'Seleccionado' : 'Elegir este'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pie con opciones secundarias */}
        <div className="p-4 px-6 border-t border-white/10 bg-slate-950/50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span>💡</span>
            <span>Puedes cambiarlo en cualquier momento haciendo clic sobre la mascota en tu menú.</span>
          </div>

          <div className="flex items-center gap-2">
            {personajeActual && (
              <button
                type="button"
                onClick={() => setPersonaje(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                title="Volver a la mascota predeterminada de tu cuenta"
              >
                Restablecer a mi predeterminado
              </button>
            )}
            <button
              type="button"
              onClick={cerrar}
              className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium text-xs transition-colors"
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
