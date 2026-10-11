import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const headers = { 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
export default defineConfig(({ mode }) => {
  const apiPort = Number(loadEnv(mode, '.', 'BOILER_API_PORT').BOILER_API_PORT ?? '8000');
  if (!Number.isInteger(apiPort) || apiPort < 1024 || apiPort > 65535) throw new Error('Invalid BOILER_API_PORT');
  const proxy = { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } };
  return { plugins: [react()], server: { proxy, headers, strictPort: true }, preview: { proxy, headers, strictPort: true } };
});
