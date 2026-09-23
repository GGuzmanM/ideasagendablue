/**
 * Normaliza a RELATIVA cualquier URL de archivo servido por el API (/uploads/...).
 *
 * Históricamente el backend guardaba la URL ABSOLUTA armada con `req.get('host')`, que por el
 * proxy de Vite siempre resolvía a `http://localhost:3002`. Eso rompe en dos escenarios reales:
 *   · desde otra PC, `localhost` apunta a ESA PC → el archivo no carga nunca;
 *   · con el front en HTTPS, el navegador bloquea el `http://` por mixed content.
 * Sirviéndola relativa, la resuelve el mismo origen (proxy de Vite en dev, Caddy en producción).
 *
 * Acepta tanto las filas viejas (absolutas) como las nuevas (ya relativas), así que no hace falta
 * migrar los datos existentes para que todo vuelva a verse.
 */
export function urlArchivo(u: string): string {
  try {
    const p = new URL(u, window.location.origin);
    return p.pathname + p.search;
  } catch {
    return u;
  }
}
