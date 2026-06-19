import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import SellerOrdersTable from '../components/SellerOrdersTable'
import SellerOrderMobileCard from '../components/SellerOrderMobileCard'
import { SELLER_STATUS_FILTERS } from '../../../shared/orderStatusConfig'
import useSellerOrders from '../hooks/useSellerOrders'

export default function SellerOrders() {
  const { data: orders = [], isLoading } = useSellerOrders()
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let result = orders
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((o) =>
        (o.order_number ?? '').toLowerCase().includes(q) ||
        (o.customer?.full_name ?? '').toLowerCase().includes(q) ||
        (o.customer?.phone ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [orders, statusFilter, search])

  return (
    <div className="page-container">
      <PageHeader
        title="Мои заказы"
        subtitle={`Всего: ${orders.length}`}
        action={
          <Link to="/seller/orders/create" className="btn btn-primary btn-md flex items-center gap-2">
            <Plus size={16} />
            Новый заказ
          </Link>
        }
      />

      {/* Filters row */}
      <div className="mb-4 space-y-3">
        {/* Status tabs */}
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {SELLER_STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${statusFilter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по номеру, клиенту, телефону…"
            className="input pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Table (desktop) */}
      <div className="hidden lg:block">
        <SellerOrdersTable orders={filtered} loading={isLoading} showCreate />
      </div>

      {/* Cards (mobile) */}
      <div className="lg:hidden">
        <SellerOrderMobileCard orders={filtered} loading={isLoading} showCreate />
      </div>
    </div>
  )
}
