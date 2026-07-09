import { useEffect, useRef } from 'react'
import { useQuery }          from '@tanstack/react-query'
import { useNavigate }       from 'react-router-dom'
import { X, ShoppingCart, CheckCircle2, AlertTriangle, Clock, Truck } from 'lucide-react'
import client from '../api/client'

const STATUS_CFG = {
  new:                   { label: 'Новый',              icon: ShoppingCart,  cls: 'text-indigo-500',  dot: 'bg-indigo-400' },
  confirmed:             { label: 'Подтверждён',        icon: Clock,         cls: 'text-sky-500',     dot: 'bg-sky-400'    },
  in_delivery:           { label: 'В доставке',         icon: Truck,         cls: 'text-violet-500',  dot: 'bg-violet-400' },
  delivered:             { label: 'Доставлен',          icon: CheckCircle2,  cls: 'text-emerald-500', dot: 'bg-emerald-400' },
  issue:                 { label: 'Проблема',           icon: AlertTriangle, cls: 'text-rose-500',    dot: 'bg-rose-400'   },
  cancelled:             { label: 'Отменён',            icon: X,             cls: 'text-slate-400',   dot: 'bg-slate-300'  },
  prepayment_pending:    { label: 'Ожидает предоплаты', icon: Clock,         cls: 'text-amber-500',   dot: 'bg-amber-400'  },
}

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)   return `${diff} сек назад`
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function fetchRecentOrders() {
  return client.get('/orders', { params: { limit: 15, page: 1 } }).then(res => {
    const body = res.data
    const raw  = body?.data ?? body
    return Array.isArray(raw) ? raw : (raw?.orders ?? raw?.items ?? [])
  })
}

export default function NotificationsPanel({ open, onClose }) {
  const panelRef = useRef(null)
  const navigate = useNavigate()

  const { data: orders = [], isLoading } = useQuery({
    queryKey:        ['notifications', 'recent-orders'],
    queryFn:         fetchRecentOrders,
    enabled:         open,
    refetchInterval: open ? 30_000 : false,
    staleTime:       20_000,
  })

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  function goToOrder(id) {
    navigate(`/owner/orders/${id}`)
    onClose()
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-[calc(100%+8px)] w-[340px] max-w-[94vw] bg-white rounded-[18px] shadow-2xl border border-slate-100 z-50 overflow-hidden"
      style={{ boxShadow: '0 20px 60px rgba(15,23,42,.12), 0 4px 16px rgba(15,23,42,.06)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-50">
        <div>
          <p className="text-[13px] font-bold text-slate-900">Лента активности</p>
          <p className="text-[10.5px] text-slate-400 mt-0.5">Последние заказы</p>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-400 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* List */}
      <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-50">
        {isLoading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-slate-100 rounded w-2/3" />
                <div className="h-2.5 bg-slate-50 rounded w-1/2" />
              </div>
            </div>
          ))
        ) : orders.length === 0 ? (
          <div className="py-12 text-center text-[12px] text-slate-400">
            Нет активности
          </div>
        ) : (
          orders.map((order) => {
            const cfg = STATUS_CFG[order.status] ?? STATUS_CFG.new
            const Icon = cfg.icon
            const customerName = order.customer_name || order.customer_phone || '—'
            const total = order.total_price ?? order.total ?? 0
            return (
              <button
                key={order.id}
                onClick={() => goToOrder(order.id)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
              >
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                  order.status === 'delivered'  ? 'bg-emerald-50' :
                  order.status === 'issue'      ? 'bg-rose-50' :
                  order.status === 'in_delivery'? 'bg-violet-50' :
                  order.status === 'new'        ? 'bg-indigo-50' :
                  'bg-slate-50'
                }`}>
                  <Icon size={14} className={cfg.cls} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      order.status === 'delivered'  ? 'bg-emerald-50 text-emerald-700' :
                      order.status === 'issue'      ? 'bg-rose-50 text-rose-700' :
                      order.status === 'in_delivery'? 'bg-violet-50 text-violet-700' :
                      order.status === 'new'        ? 'bg-indigo-50 text-indigo-700' :
                      'bg-slate-50 text-slate-600'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </span>
                  </div>
                  <p className="text-[12.5px] font-semibold text-slate-900 truncate">{customerName}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {Number(total).toLocaleString('ru-RU')} с · {timeAgo(order.created_at)}
                  </p>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-slate-50">
        <button
          onClick={() => { navigate('/owner/orders'); onClose() }}
          className="w-full text-center text-[11.5px] font-semibold text-indigo-600 hover:text-indigo-700 py-1 transition-colors"
        >
          Все заказы →
        </button>
      </div>
    </div>
  )
}
