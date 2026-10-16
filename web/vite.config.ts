/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The dev server proxies the Laravel API so the browser sees one origin. Sanctum session cookies
// and the XSRF-TOKEN cookie are then first-party, which SPA authentication requires.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget },
        '/sanctum': { target: apiTarget },
      },
    },
    test: {
      environment: 'jsdom',
      // Browser tests in e2e/ run with Playwright (npm run e2e), not Vitest.
      exclude: ['e2e/**', 'node_modules/**'],
    },
  };
});
