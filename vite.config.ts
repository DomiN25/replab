/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

export default defineConfig(({ command, mode }) => {
  // LICHESS_TOKEN aus .env.local wird NUR im Dev-Server durchgereicht.
  // Im Produktions-Build ist der Wert immer leer (Token nie im Bundle).
  const env = loadEnv(mode, process.cwd(), '');
  const devToken = command === 'serve' ? env.LICHESS_TOKEN ?? '' : '';

  return {
    base: './',
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        manifest: {
          name: 'RepLab – Repertoire bauen & lernen',
          short_name: 'RepLab',
          description: 'Schach-Eröffnungsrepertoire bauen, Lücken finden und mit verteilter Wiederholung lernen.',
          lang: 'de',
          theme_color: '#eaf2f8',
          background_color: '#eaf2f8',
          display: 'standalone',
          start_url: './',
          scope: './',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,wasm,png,svg,pgn,woff2,json}'],
          globIgnores: ['**/spike*'],
          // Neue Version sofort aktivieren (sonst bleibt ein installiertes Handy auf dem alten Stand hängen)
          skipWaiting: true,
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/spike/],
        },
      }),
    ],
    define: {
      __DEV_LICHESS_TOKEN__: JSON.stringify(devToken),
    },
    server: { host: true, port: 5173 },
    worker: { format: 'es' },
    build: {
      target: 'es2022',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          spike: resolve(__dirname, 'spike.html'),
        },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
