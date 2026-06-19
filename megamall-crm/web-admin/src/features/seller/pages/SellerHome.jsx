import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import SellerKpis from '../components/SellerKpis'
import RecentOrders from '../components/RecentOrders'
import useSellerOrders from '../hooks/useSellerOrders'

export default function SellerHome() {
  const { data: orders = [], isLoading } = useSellerOrders()

  return (
    <div className="page-container">
      <PageHeader
        title="Мои продажи"
        subtitle="Обзор заказов и показателей"
        action={
          <Link to="/seller/orders/create" className="btn btn-primary btn-md flex items-center gap-2">
            <Plus size={16} />
            Новый заказ
          </Link>
        }
      />

      <SellerKpis orders={orders} loading={isLoading} />

      <RecentOrders orders={orders} loading={isLoading} />
    </div>
  )
}
