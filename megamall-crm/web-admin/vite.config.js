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

          // Feature chunks — paired with lazy() in router.jsx so each role's code
          // only loads when that role first navigates to their section.
          'feature-owner': [
            './src/features/finance/pages/OwnerFinancePage.jsx',
            './src/features/orders/pages/OwnerOrdersPage.jsx',
            './src/features/people/pages/TeamsHub.jsx',
            './src/features/people/pages/TeamProfilePage.jsx',
          ],
          'feature-team-lead': [
            './src/features/team-lead/pages/TeamLeadDashboardPage.jsx',
            './src/features/team-lead/pages/TeamLeadIncomePage.jsx',
            './src/features/team-lead/pages/TeamLeadOrdersPage.jsx',
            './src/features/team-lead/pages/TeamLeadSellersPage.jsx',
            './src/features/team-lead/pages/TeamLeadManagerPage.jsx',
            './src/features/team-lead/pages/TeamLeadReportsPage.jsx',
          ],
          'feature-manager': [
            './src/features/manager/pages/ManagerDashboardPage.jsx',
            './src/features/manager/pages/ManagerIncomePage.jsx',
            './src/features/manager/pages/ManagerOrdersPage.jsx',
            './src/features/manager/pages/ManagerSellersPage.jsx',
            './src/features/manager/pages/ManagerMyOrdersPage.jsx',
          ],
          'feature-seller': [
            './src/features/seller/pages/SellerHome.jsx',
            './src/features/seller/pages/SellerOrders.jsx',
            './src/features/seller/pages/CreateOrder.jsx',
            './src/features/seller/pages/SellerIncomePage.jsx',
          ],
          'feature-dispatcher': [
            './src/features/dispatcher/pages/DispatcherBoard.jsx',
          ],
          'feature-warehouse': [
            './src/features/warehouse/pages/WarehouseDashboard.jsx',
          ],
          'feature-courier': [
            './src/features/courier/pages/CourierDashboard.jsx',
          ],
        },
      },
    },
  },
})
