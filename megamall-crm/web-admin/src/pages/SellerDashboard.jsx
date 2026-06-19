import { Outlet } from 'react-router-dom'

/**
 * SellerDashboard — thin shell that renders seller sub-routes via <Outlet />.
 * Actual page content lives in features/seller/pages/*.
 */
export default function SellerDashboard() {
  return <Outlet />
}
