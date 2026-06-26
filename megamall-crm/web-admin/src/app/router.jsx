import { createBrowserRouter, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import ProtectedRoute  from '../shared/components/ProtectedRoute'
import Layout          from '../shared/components/Layout'
import Login           from '../pages/Login'
import RootRedirect    from '../shared/components/RootRedirect'
import ComingSoon      from '../shared/components/ComingSoon'
import LoadingSpinner  from '../shared/components/LoadingSpinner'

// ── Lazy page imports (route-level code splitting) ───────────────────────────
// Each role's subtree loads only when that role first navigates to it.
// Shared infrastructure (Layout, ProtectedRoute, Login) stays in the main chunk.

// Owner
const OwnerDashboard          = lazy(() => import('../pages/OwnerDashboard'))
const OwnerFinancePage        = lazy(() => import('../features/finance/pages/OwnerFinancePage'))
const OwnerOrdersPage         = lazy(() => import('../features/orders/pages/OwnerOrdersPage'))
const LogisticsPage           = lazy(() => import('../features/logistics/pages/LogisticsPage'))
const CourierProfilePage      = lazy(() => import('../features/logistics/pages/CourierProfilePage'))
const DeliverySettingsPage    = lazy(() => import('../features/owner/pages/DeliverySettingsPage'))
const OwnerCouriersPage       = lazy(() => import('../features/owner/pages/OwnerCouriersPage'))
const OwnerWarehousePage      = lazy(() => import('../features/owner/pages/OwnerWarehousePage'))
const OwnerHRPage             = lazy(() => import('../features/owner/pages/OwnerHRPage'))
const OwnerSettingsPage       = lazy(() => import('../features/owner/pages/OwnerSettingsPage'))
const OwnerReportsPage        = lazy(() => import('../features/owner/pages/OwnerReportsPage'))

// People / HR (owner sub-pages)
const TeamsHub            = lazy(() => import('../features/people/pages/TeamsHub'))
const TeamProfilePage     = lazy(() => import('../features/people/pages/TeamProfilePage'))
const EmployeeProfilePage = lazy(() => import('../features/people/pages/EmployeeProfilePage'))

// Team Lead
const TeamLeadDashboardPage = lazy(() => import('../features/team-lead/pages/TeamLeadDashboardPage'))
const TeamLeadIncomePage    = lazy(() => import('../features/team-lead/pages/TeamLeadIncomePage'))
const TeamLeadOrdersPage    = lazy(() => import('../features/team-lead/pages/TeamLeadOrdersPage'))
const TeamLeadSellersPage   = lazy(() => import('../features/team-lead/pages/TeamLeadSellersPage'))
const TeamLeadManagerPage   = lazy(() => import('../features/team-lead/pages/TeamLeadManagerPage'))
const TeamLeadReportsPage   = lazy(() => import('../features/team-lead/pages/TeamLeadReportsPage'))

// Manager
const ManagerDashboardPage = lazy(() => import('../features/manager/pages/ManagerDashboardPage'))
const ManagerIncomePage    = lazy(() => import('../features/manager/pages/ManagerIncomePage'))
const ManagerOrdersPage    = lazy(() => import('../features/manager/pages/ManagerOrdersPage'))
const ManagerSellersPage   = lazy(() => import('../features/manager/pages/ManagerSellersPage'))
const ManagerMyOrdersPage  = lazy(() => import('../features/manager/pages/ManagerMyOrdersPage'))
const ManagerProfilePage   = lazy(() => import('../features/manager/pages/ManagerProfilePage'))

// Seller
const SellerDashboard        = lazy(() => import('../pages/SellerDashboard'))
const SellerHome             = lazy(() => import('../features/seller/pages/SellerHome'))
const SellerOrders           = lazy(() => import('../features/seller/pages/SellerOrders'))
const CreateOrder            = lazy(() => import('../features/seller/pages/CreateOrder'))
const EditOrder              = lazy(() => import('../features/seller/pages/EditOrder'))
const SellerIncomePage       = lazy(() => import('../features/seller/pages/SellerIncomePage'))
const SellerProfilePage      = lazy(() => import('../features/seller/pages/SellerProfilePage'))
const SellerProfileInfoPage  = lazy(() => import('../features/seller/pages/SellerProfileInfoPage'))
const SellerTeamPage         = lazy(() => import('../features/seller/pages/SellerTeamPage'))

// Dispatcher
const DispatcherDashboard     = lazy(() => import('../pages/DispatcherDashboard'))
const DispatcherCashDashboard = lazy(() => import('../features/dispatcher/pages/DispatcherCashPage'))

// Warehouse
const WarehouseDashboardPage = lazy(() => import('../features/warehouse/pages/WarehouseDashboard'))
const WarehouseInventoryPage = lazy(() => import('../features/warehouse/pages/WarehouseInventoryPage'))
const WarehouseProductsPage  = lazy(() => import('../features/warehouse/pages/WarehouseProductsPage'))
const WarehouseMovementsPage = lazy(() => import('../features/warehouse/pages/WarehouseMovementsPage'))
const WarehouseReceivingPage = lazy(() => import('../features/warehouse/pages/WarehouseReceivingPage'))
const WarehouseWriteoffsPage = lazy(() => import('../features/warehouse/pages/WarehouseWriteoffsPage'))
const WarehouseTransfersPage = lazy(() => import('../features/warehouse/pages/WarehouseTransfersPage'))

// Courier
const CourierDashboard = lazy(() => import('../features/courier/pages/CourierDashboard'))

// ── Suspense wrapper — used at route element level ────────────────────────────
function Lazy({ children }) {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      {children}
    </Suspense>
  )
}

/**
 * Role → home path mapping.
 * Exported so ProtectedRoute can redirect users to their own dashboard.
 */
export const ROLE_HOME = {
  owner:             '/owner',
  sales_team_lead:   '/team-lead',
  manager:           '/manager',
  seller:            '/seller',
  dispatcher:        '/dispatcher',
  warehouse_manager: '/warehouse',
  courier:           '/courier',
}

const router = createBrowserRouter([
  // ── Public ─────────────────────────────────────────────────────────────
  { path: '/login', element: <Login /> },

  // ── Root redirect ───────────────────────────────────────────────────────
  { path: '/', element: <RootRedirect /> },

  // ── Owner ───────────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="owner" />,
    children: [{
      path: '/owner',
      element: <Layout />,
      children: [
        { index: true, element: <Lazy><OwnerDashboard /></Lazy> },

        { path: 'teams',             element: <Lazy><TeamsHub /></Lazy> },
        { path: 'teams/:teamId',     element: <Lazy><TeamProfilePage /></Lazy> },
        { path: 'employees',         element: <Lazy><TeamsHub /></Lazy> },
        { path: 'employees/:userId', element: <Lazy><EmployeeProfilePage /></Lazy> },

        { path: 'finance', element: <Lazy><OwnerFinancePage /></Lazy> },
        { path: 'orders',         element: <Lazy><OwnerOrdersPage /></Lazy> },
        { path: 'orders/create',  element: <Lazy><CreateOrder /></Lazy> },

        { path: 'logistics',                element: <Lazy><LogisticsPage /></Lazy> },
        { path: 'logistics/couriers/:id',   element: <Lazy><CourierProfilePage /></Lazy> },

        // Dedicated owner sections
        { path: 'couriers',  element: <Lazy><OwnerCouriersPage /></Lazy> },
        { path: 'warehouse', element: <Lazy><OwnerWarehousePage /></Lazy> },
        { path: 'hr',        element: <Lazy><OwnerHRPage /></Lazy> },
        { path: 'reports',   element: <Lazy><OwnerReportsPage /></Lazy> },

        // Settings hub + delivery sub-page
        { path: 'settings',          element: <Lazy><OwnerSettingsPage /></Lazy> },
        { path: 'settings/delivery', element: <Lazy><DeliverySettingsPage /></Lazy> },

        // Dispatch board accessible to owner (owner has dispatcherRoles on backend)
        { path: 'dispatch', element: <Lazy><DispatcherDashboard /></Lazy> },

        { path: '*', element: <ComingSoon /> },
      ],
    }],
  },

  { path: '/hr',   element: <Navigate to="/owner/hr"  replace /> },
  { path: '/hr/*', element: <Navigate to="/owner/hr"  replace /> },

  // ── Team Lead ───────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="sales_team_lead" />,
    children: [{
      path: '/team-lead',
      element: <Layout />,
      children: [
        { index: true,      element: <Lazy><TeamLeadDashboardPage /></Lazy> },
        { path: 'income',   element: <Lazy><TeamLeadIncomePage /></Lazy> },
        { path: 'orders',   element: <Lazy><TeamLeadOrdersPage /></Lazy> },
        { path: 'sellers',  element: <Lazy><TeamLeadSellersPage /></Lazy> },
        { path: 'managers', element: <Lazy><TeamLeadManagerPage /></Lazy> },
        { path: 'reports',  element: <Lazy><TeamLeadReportsPage /></Lazy> },
        { path: '*',        element: <ComingSoon /> },
      ],
    }],
  },

  // ── Manager ─────────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="manager" />,
    children: [{
      path: '/manager',
      element: <Layout />,
      children: [
        { index: true,        element: <Lazy><ManagerDashboardPage /></Lazy> },
        { path: 'income',     element: <Lazy><ManagerIncomePage /></Lazy> },
        { path: 'orders',     element: <Lazy><ManagerOrdersPage /></Lazy> },
        { path: 'sellers',    element: <Lazy><ManagerSellersPage /></Lazy> },
        { path: 'my-orders',             element: <Lazy><ManagerMyOrdersPage /></Lazy> },
        { path: 'my-orders/create',      element: <Lazy><CreateOrder /></Lazy> },
        { path: 'my-orders/:id/edit',    element: <Lazy><EditOrder /></Lazy> },
        {
          path: 'profile',
          element: <Lazy><ManagerProfilePage /></Lazy>,
          children: [
            { index: true,  element: <Navigate to="info" replace /> },
            { path: 'info', element: <Lazy><SellerProfileInfoPage /></Lazy> },
          ],
        },
        { path: '*',                     element: <ComingSoon /> },
      ],
    }],
  },

  // ── Seller ──────────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="seller" />,
    children: [{
      path: '/seller',
      element: <Layout />,
      children: [
        {
          element: <Lazy><SellerDashboard /></Lazy>,
          children: [
            { index: true,           element: <Lazy><SellerHome /></Lazy> },
            { path: 'orders',        element: <Lazy><SellerOrders /></Lazy> },
            { path: 'orders/create',    element: <Lazy><CreateOrder /></Lazy> },
            { path: 'orders/:id/edit', element: <Lazy><EditOrder /></Lazy> },
          ],
        },
        { path: 'income', element: <Lazy><SellerIncomePage /></Lazy> },
        {
          path: 'profile',
          element: <Lazy><SellerProfilePage /></Lazy>,
          children: [
            { index: true, element: <Navigate to="info" replace /> },
            { path: 'info', element: <Lazy><SellerProfileInfoPage /></Lazy> },
            { path: 'team', element: <Lazy><SellerTeamPage /></Lazy> },
          ],
        },
        { path: '*',      element: <ComingSoon /> },
      ],
    }],
  },

  // ── Dispatcher ──────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="dispatcher" />,
    children: [{
      path: '/dispatcher',
      element: <Layout />,
      children: [
        { index: true,    element: <Lazy><DispatcherDashboard /></Lazy>     },
        { path: 'cash',   element: <Lazy><DispatcherCashDashboard /></Lazy> },
        { path: '*',      element: <Navigate to="/dispatcher" replace />    },
      ],
    }],
  },

  // ── Warehouse Manager ───────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="warehouse_manager" />,
    children: [{
      path: '/warehouse',
      element: <Layout />,
      children: [
        { index: true,          element: <Lazy><WarehouseDashboardPage /></Lazy> },
        { path: 'inventory',    element: <Lazy><WarehouseInventoryPage /></Lazy> },
        { path: 'products',     element: <Lazy><WarehouseProductsPage /></Lazy> },
        { path: 'movements',    element: <Lazy><WarehouseMovementsPage /></Lazy> },
        { path: 'receiving',    element: <Lazy><WarehouseReceivingPage /></Lazy> },
        { path: 'writeoffs',    element: <Lazy><WarehouseWriteoffsPage /></Lazy> },
        { path: 'transfers',    element: <Lazy><WarehouseTransfersPage /></Lazy> },
        { path: '*',            element: <Navigate to="/warehouse" replace /> },
      ],
    }],
  },

  // ── Courier ─────────────────────────────────────────────────────────────
  {
    element: <ProtectedRoute allowedRole="courier" />,
    children: [{
      path: '/courier',
      element: <Layout />,
      children: [
        { index: true, element: <Lazy><CourierDashboard /></Lazy> },
        { path: '*',   element: <Navigate to="/courier" replace /> },
      ],
    }],
  },

  { path: '/courier-info', element: <Navigate to="/courier" replace /> },

  // ── Catch-all ───────────────────────────────────────────────────────────
  { path: '*', element: <Navigate to="/" replace /> },
])

export default router
