/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read DASHBOARD_TOKEN from parent .env
function getDashboardToken(): string {
  try {
    const envContent = readFileSync(resolve(__dirname, '../.env'), 'utf-8');
    const match = envContent.match(/^DASHBOARD_TOKEN=(.+)$/m);
    return match?.[1]?.trim() || '';
  } catch { return ''; }
}

const DASHBOARD_TOKEN = getDashboardToken();

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'ClaudeClaw',
        short_name: 'ClaudeClaw',
        description: 'Control Center',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3141',
        rewrite: (path: string) => {
          const sep = path.includes('?') ? '&' : '?';
          return DASHBOARD_TOKEN ? `${path}${sep}token=${DASHBOARD_TOKEN}` : path;
        },
      },
      '/cal-api': {
        target: 'http://localhost:8050',
        rewrite: (path: string) => path.replace(/^\/cal-api/, '/api'),
      },
      '/mail-api': {
        target: 'http://localhost:8055',
        rewrite: (path: string) => path.replace(/^\/mail-api/, '/api'),
      },
    },
  },
});
