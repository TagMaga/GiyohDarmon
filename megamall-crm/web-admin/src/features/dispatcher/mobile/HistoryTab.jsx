import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { C, statusPill, chipStyle } from './theme'
import { fmt, fmtDate } from '../statusConfig'
import { KEYS } from '../../../shared/queryKeys'
import { fetchDispatchOrderHistory } from '../api'

const STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'delivered', label: 'Доставлен' },
  { value: 'returned', label: 'Возврат' },
  { value: 'cancelled', label: 'Отменён' },
]

export default function HistoryTab() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const params = useMemo(() => ({
    page, limit: 20,
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  }), [page, status, search])

  const { data, isPending } = useQuery({
    queryKey: KEYS.dispatcher.orderHistory(params),
    queryFn: () => fetchDispatchOrderHistory(params),
    staleTime: 30_000,
  })

  const rows = Array.isArray(data?.data) ? data.data : []
  const meta = data?.meta ?? {}
  const hasMore = Number(meta.page ?? 1) < Number(meta.total_pages ?? 1)

  return (
    <div>
      <div style={{ padding: '0 18px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 12px' }}>
          <Search size={15} color={C.text3} />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Поиск по ID, клиенту, адресу…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 13, color: C.text1 }}
          />
        </div>
      </div>

      <div className="dm-scroll" style={{ display: 'flex', gap: 8, padding: '0 18px 12px', overflowX: 'auto' }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => { setStatus(f.value); setPage(1) }}
            style={{ flexShrink: 0, height: 34, padding: '0 14px', borderRadius: 99, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, border: 'none', whiteSpace: 'nowrap', ...chipStyle(status === f.value) }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 18px' }}>
        {isPending ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 100, borderRadius: 16, background: C.border2 }} />)
        ) : rows.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 16px', textAlign: 'center', color: '#B0B0A6' }}>
            <div style={{ fontSize: 30, opacity: .5, marginBottom: 8 }}>◇</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text3 }}>Ничего не найдено</div>
          </div>
        ) : (
          rows.map((row) => <HistoryCard key={row.id} row={row} />)
        )}
        {hasMore && (
          <button
            onClick={() => setPage((p) => p + 1)}
            style={{ margin: '4px 0 12px', padding: 12, border: `1px solid ${C.border}`, borderRadius: 13, background: C.card, color: C.text2, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
          >
            Показать ещё
          </button>
        )}
      </div>
    </div>
  )
}

function HistoryCard({ row }) {
  const pill = statusPill(row.status)
  const products = Array.isArray(row.products) ? row.products : []
  const productLabel = products.length ? products.map((p) => `${p.name}${p.quantity ? ` ×${p.quantity}` : ''}`).join(', ') : '—'

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>#{row.order_number || row.id}</span>
        <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 11, fontWeight: 700, background: pill.bg, color: pill.color }}>{pill.label}</span>
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 2 }}>{productLabel}</div>
      <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 11 }}>{fmtDate(row.created_at)} · {row.courier_name || '—'}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: `1px solid ${C.border2}` }}>
        <div style={{ fontSize: 11, color: C.text4 }}>Продавец: <strong style={{ color: C.text1 }}>{row.seller_name || '—'}</strong></div>
        <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(row.total_amount)} сом</div>
      </div>
    </div>
  )
}
