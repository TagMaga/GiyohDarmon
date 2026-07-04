import { Outlet } from 'react-router-dom'
import SellerSidebar from './SellerSidebar'
import BottomNav from './BottomNav'
import { M } from './mobileUi'

/**
 * Seller-only layout replacing the shared app Layout for the /seller subtree.
 * Desktop: dark SellerSidebar (Seller Panel Redesign). Mobile: existing seller BottomNav.
 */
export default function SellerLayout() {
  return (
    <div className="min-h-screen" style={{ background: M.bg }}>
      <SellerSidebar />
      <div className="lg:pl-[260px] min-h-screen">
        <Outlet />
      </div>
      <BottomNav variant="seller" />
    </div>
  )
}
