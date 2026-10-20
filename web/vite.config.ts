/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The dev server proxies the Laravel API so the browser sees one origin. Sanctum session cookies
// and the XSRF-TOKEN cookie are then first-party, which SPA authentication requires.
// Browser protection for the web app itself (the API adds its own): no framing by other sites, no MIME sniffing,
// no referrer leaks, no camera/microphone. Copy these to the web server or host when deploying the built app.
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)',
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      headers: SECURITY_HEADERS,
      proxy: {
        '/api': { target: apiTarget },
        '/sanctum': { target: apiTarget },
      },
    },
    preview: { headers: SECURITY_HEADERS },
    test: {
      environment: 'jsdom',
      // Browser tests in e2e/ run with Playwright (npm run e2e), not Vitest.
      exclude: ['e2e/**', 'node_modules/**'],
    },
  };
});
