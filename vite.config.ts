/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ command, mode }) => {
  // LICHESS_TOKEN aus .env.local wird NUR im Dev-Server durchgereicht.
  // Im Produktions-Build ist der Wert immer leer (Token nie im Bundle).
  const env = loadEnv(mode, process.cwd(), '');
  const devToken = command === 'serve' ? env.LICHESS_TOKEN ?? '' : '';

  return {
    base: './',
    plugins: [react()],
    define: {
      __DEV_LICHESS_TOKEN__: JSON.stringify(devToken),
    },
    server: { host: true, port: 5173 },
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
