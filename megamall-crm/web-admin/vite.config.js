import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Receipt proof images and attachments uploaded by couriers.
      '/uploads': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // Media pipeline delivery routes (product images, avatars, etc.) —
      // registered by internal/media at the router root, outside /api/v1
      // (see internal/media/routes.go: RegisterDeliveryRoutes).
      '/media': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — cached aggressively, never changes between deploys.
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],

          // TanStack Query — large data-fetching library shared by every feature.
          'vendor-query': ['@tanstack/react-query'],

          // Icon library — tree-shaken at build time but still benefits from isolation.
          'vendor-ui': ['lucide-react'],

          // HTTP client — used everywhere, isolate from feature code.
          'vendor-axios': ['axios'],

          // NOTE: role/feature pages are intentionally NOT grouped into manual
          // chunks here. Each page is already route-split via lazy() in
          // router.jsx, which gives Rollup its own async chunk per page.
          // Manually regrouping several of those async chunks into combined
          // 'feature-owner' / 'feature-dispatcher' / etc. bundles (as this file
          // used to do) made Vite treat them as build-time-reachable from the
          // entry, so it emitted <link rel="modulepreload"> for ALL of them in
          // index.html — meaning every visitor, including an anonymous user on
          // /login, downloaded every role's page code and CSS up front. Leave
          // chunking to Vite's default per-dynamic-import splitting instead.
        },
      },
    },
  },
})
