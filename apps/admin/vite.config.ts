import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The admin SPA is served at /app/ in production (behind Caddy). API calls go
// to /admin/* and /v1/* on the same origin. In dev, Vite proxies those to the
// local API on :3000.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:3000',
      '/v1': 'http://localhost:3000',
      '/public': 'http://localhost:3000',
    },
  },
});
