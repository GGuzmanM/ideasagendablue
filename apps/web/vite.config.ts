import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// HTTPS con certificado autofirmado (VITE_HTTPS=true en apps/web/.env). Necesario para que el
// navegador habilite el MICRÓFONO (dictado por voz de la historia clínica) cuando se entra por la
// IP de la red (http://192.168.x.x:5180 no es "contexto seguro"; solo localhost o https lo son).
// Aplica al dev server y a `vite preview`. Cada dispositivo acepta el certificado una sola vez.
const httpsHabilitado = (mode: string) => loadEnv(mode, __dirname, '').VITE_HTTPS === 'true';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(httpsHabilitado(mode) ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@limablue/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // host: true → escucha en TODAS las interfaces (0.0.0.0), sin esto otras PCs
    // de la LAN no pueden acceder a http://192.168.0.55:5180
    host: true,
    port: Number(process.env.PORT) || 5180,
    strictPort: false,
    proxy: {
      // Target configurable (VITE_PROXY_TARGET) para apuntar el dev server a otra API
      // (staging u otra instancia); por defecto la API local en :3002.
      // `xfwd: true` propaga X-Forwarded-For/Host/Proto al backend con la IP REAL del
      // cliente que hizo la request al Vite — sin esto el backend siempre ve ::1
      // (la IP de Vite localmente) y todos los audit_logs salen con la misma IP.
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', changeOrigin: true, xfwd: true },
      '/socket.io': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', ws: true, xfwd: true },
      '/uploads': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:3002', changeOrigin: true, xfwd: true },
    },
  },
  // Serving de PRODUCCIÓN del build estático (`vite preview`). Reusa el mismo proxy que
  // el dev server para que el frontend siga hablando por rutas relativas (/api, /socket.io)
  // con la API en :3002 — sin cambios en el frontend y conservando la URL :5180 de la clínica.
  preview: {
    host: true,
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3002', changeOrigin: true, xfwd: true },
      '/socket.io': { target: 'http://localhost:3002', ws: true, xfwd: true },
    },
  },
}));
