import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Truck, Package, UserX } from 'lucide-react'

import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import useProfile from '../../../shared/hooks/useProfile'

import {
  fetchBoard, fetchNewOrders, fetchIssueOrders, fetchDeliveredOrders,
  fetchCouriersOverview, confirmOrder, markReturn,
} from '../api'
import { getOrderId, getCourierId, buildCourierMap } from '../utils/orderHelpers'
import { isOverdue, isToday, isTomorrow } from '../statusConfig'
import useCustomerMap from '../hooks/useCustomerMap'

import { C, MOBILE_COLUMNS, MOBILE_STATUS_TO_COL } from '../mobile/theme'
import './../mobile/DispatcherMobile.css'

import DispatchTab from '../mobile/DispatchTab'
import CouriersTab from '../mobile/CouriersTab'
import CashTab from '../mobile/CashTab'
import HistoryTab from '../mobile/HistoryTab'
import OrderDetailSheet from '../mobile/OrderDetailSheet'
import { AssignSheet, CancelSheet, IssueSheet, ScheduleSheet } from '../mobile/ActionSheets'
import CreateOrderSheet from '../mobile/CreateOrderSheet'
import { CourierDetailSheet } from '../mobile/CourierSheets'
import ProfileSheet from '../mobile/ProfileSheet'

const arr = (d) => Array.isArray(d) ? d : (d?.orders ?? d?.data ?? d?.items ?? [])

const TAB_TITLES = {
  dispatch: 'Диспетчер',
  couriers: 'Курьеры',
  cash: 'Касса',
  history: 'История',
}

export default function DispatcherMobileApp() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const profile = useProfile()

  const [tab, setTab] = useState('dispatch')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [colFilter, setColFilter] = useState(null)

  const [selectedOrder, setSelectedOrder] = useState(null)
  const [actionSheet, setActionSheet] = useState(null) // { type, order }
  const [createOpen, setCreateOpen] = useState(false)
  const [courierDetailId, setCourierDetailId] = useState(null)
  const [profileOpen, setProfileOpen] = useState(false)

  const board = useQuery({ queryKey: KEYS.dispatcher.board, queryFn: fetchBoard, refetchInterval: 30_000, staleTime: 25_000 })
  const news = useQuery({ queryKey: KEYS.dispatcher.newOrders, queryFn: fetchNewOrders, refetchInterval: 30_000, staleTime: 25_000 })
  const issues = useQuery({ queryKey: KEYS.dispatcher.issues, queryFn: fetchIssueOrders, refetchInterval: 30_000, staleTime: 25_000 })
  const delivered = useQuery({ queryKey: KEYS.dispatcher.delivered, queryFn: fetchDeliveredOrders, refetchInterval: 60_000, staleTime: 55_000 })
  const couriersQ = useQuery({ queryKey: KEYS.dispatcher.couriers, queryFn: fetchCouriersOverview, refetchInterval: 30_000, staleTime: 20_000 })

  const allOrders = useMemo(() => {
    const seen = new Set()
    const merged = []
    for (const order of [...arr(news.data), ...arr(board.data), ...arr(issues.data), ...arr(delivered.data)]) {
      const id = getOrderId(order)
      if (id && !seen.has(id)) { seen.add(id); merged.push(order) }
    }
    return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [news.data, board.data, issues.data, delivered.data])

  const customerMap = useCustomerMap(allOrders)
  const courierList = arr(couriersQ.data)
  const courierMap = useMemo(() => buildCourierMap(courierList), [courierList])

  const counts = useMemo(() => {
    const c = { new: 0, confirmed: 0, delivery: 0, done: 0, issues: 0, unassigned: 0 }
    for (const order of allOrders) {
      const col = MOBILE_STATUS_TO_COL[order.status]
      if (col) c[col] += 1
      if (order.status === 'confirmed' && !getCourierId(order)) c.unassigned += 1
    }
    return c
  }, [allOrders])

  const cashOwed = useMemo(
    () => courierList.reduce((sum, c) => sum + Number(c.cash_owed ?? 0), 0),
    [courierList],
  )

  const [courierFilter, setCourierFilter] = useState('')

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allOrders.filter((order) => {
      if (courierFilter === 'unassigned') {
        if (order.status !== 'confirmed') return false
        if (getCourierId(order)) return false
      } else if (courierFilter) {
        if (getCourierId(order) !== courierFilter) return false
      }
      if (dateFilter !== 'all') {
        const when = order.scheduled_at || order.delivery_date
        if (dateFilter === 'overdue' && !isOverdue(order)) return false
        if (dateFilter === 'today' && !isToday(when)) return false
        if (dateFilter === 'tomorrow' && !isTomorrow(when)) return false
      }
      if (q) {
        const customer = customerMap[getOrderId(order)]
        const hay = [
          order.order_number, order.id, customer?.full_name, customer?.phone,
          customer?.address, order.delivery_address,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [allOrders, courierFilter, dateFilter, search, customerMap])

  const grouped = useMemo(() => {
    const map = Object.fromEntries(MOBILE_COLUMNS.map((c) => [c.key, []]))
    for (const order of filteredOrders) {
      const key = MOBILE_STATUS_TO_COL[order.status]
      if (key) map[key].push(order)
    }
    return map
  }, [filteredOrders])

  const effectiveColFilter = useMemo(() => {
    if (colFilter && (grouped[colFilter]?.length ?? 0) > 0) return colFilter
    if (colFilter) return colFilter
    const firstNonEmpty = MOBILE_COLUMNS.find((c) => (grouped[c.key]?.length ?? 0) > 0)
    return firstNonEmpty ? firstNonEmpty.key : 'new'
  }, [grouped, colFilter])

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.issues })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
  }, [qc])

  const onErr = useCallback(
    (err) => toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка'),
    [toast],
  )

  const { mutate: doConfirm, isPending: isConfirming } = useMutation({
    mutationFn: (order) => confirmOrder(getOrderId(order)),
    onSuccess: () => { invalidate(); toast.success('Заказ подтверждён') },
    onError: onErr,
  })
  const { mutate: doReturn } = useMutation({
    mutationFn: (order) => markReturn(getOrderId(order)),
    onSuccess: () => { invalidate(); toast.success('Заказ переведён в возврат') },
    onError: onErr,
  })

  const handleOrderAction = useCallback((action, order) => {
    if (action === 'confirm') { if (!isConfirming) doConfirm(order); return }
    if (action === 'return') { doReturn(order); return }
    if (['assign', 'reassign', 'unassign', 'cancel', 'issue', 'resolve', 'schedule'].includes(action)) {
      setActionSheet({ type: action, order })
      return
    }
  }, [doConfirm, doReturn, isConfirming])

  function logout() {
    navigate('/login', { replace: true })
  }

  return (
    <div
      className="dm-root"
      style={{
        minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
        background: C.bg, fontFamily: "'Golos Text','Inter',system-ui,-apple-system,sans-serif",
        color: C.text1, position: 'relative', paddingBottom: 90,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 14px' }}>
        <button
          onClick={() => setProfileOpen(true)}
          style={{
            width: 34, height: 34, border: 'none', padding: 0, borderRadius: 10, background: C.violet,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(99,102,241,.3)', flexShrink: 0, cursor: 'pointer',
          }}
        >
          <span style={{ color: '#fff', fontWeight: 900, fontSize: 15 }}>{profile.initials}</span>
        </button>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-.01em' }}>{TAB_TITLES[tab]}</div>
          <div style={{ fontSize: 10.5, color: C.text3, fontWeight: 600 }}>MegaMall Dispatch</div>
        </div>
      </div>

      {/* KPI strip — dispatch tab only */}
      {tab === 'dispatch' && (
        <div className="dm-scroll" style={{ display: 'flex', gap: 10, padding: '0 18px 14px', overflowX: 'auto' }}>
          <Kpi icon={<Truck size={17} />} iconBg={C.violetBg} iconColor={C.violetDk} value={courierList.length} label="Курьеров" />
          <Kpi icon={<Package size={17} />} iconBg={C.blueBg} iconColor={C.blue} value={counts.new + counts.confirmed + counts.delivery + counts.issues} label="Активные" />
          <button
            onClick={() => setCourierFilter((prev) => prev === 'unassigned' ? '' : 'unassigned')}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', borderRadius: 15, flexShrink: 0,
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              background: courierFilter === 'unassigned' ? C.redBg : C.card,
              border: `1px solid ${courierFilter === 'unassigned' ? C.redSoft : C.border}`,
            }}
          >
            <span style={{ width: 32, height: 32, borderRadius: 10, background: C.redBg, color: C.red, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><UserX size={17} /></span>
            <span>
              <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, color: C.red }}>{counts.unassigned}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.text3, marginTop: 3 }}>Без курьера</div>
            </span>
          </button>
        </div>
      )}

      {/* Tab content */}
      <div style={{ flex: 1 }}>
        {tab === 'dispatch' && (
          <DispatchTab
            search={search} onSearch={setSearch}
            dateFilter={dateFilter} onDateFilter={setDateFilter}
            columns={MOBILE_COLUMNS} colFilter={effectiveColFilter} onColFilter={setColFilter}
            grouped={grouped} counts={counts}
            customerMap={customerMap} courierMap={courierMap}
            onSelectOrder={setSelectedOrder}
            onAction={handleOrderAction}
            isConfirming={isConfirming}
            loading={board.isPending || news.isPending}
            onOpenCreate={() => setCreateOpen(true)}
          />
        )}
        {tab === 'couriers' && (
          <CouriersTab
            couriers={courierList}
            cashOwed={cashOwed}
            loading={couriersQ.isPending}
            onOpenCourierDetail={setCourierDetailId}
            onCouriersChanged={() => qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })}
          />
        )}
        {tab === 'cash' && <CashTab couriers={courierList} cashOwed={cashOwed} />}
        {tab === 'history' && <HistoryTab couriers={courierList} />}
      </div>

      {/* FAB — create office order (dispatch tab only) */}
      {tab === 'dispatch' && (
        <button
          onClick={() => setCreateOpen(true)}
          style={{
            position: 'fixed', right: 18, bottom: 96, zIndex: 22, width: 54, height: 54, borderRadius: 17,
            border: 'none', cursor: 'pointer', background: C.gradient, color: '#fff',
            boxShadow: '0 12px 26px rgba(99,102,241,.42)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      )}

      {/* Bottom nav */}
      <BottomNav tab={tab} onTab={setTab} counts={counts} />

      {/* Sheets */}
      <OrderDetailSheet
        order={selectedOrder}
        open={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        customerMap={customerMap}
        courierMap={courierMap}
        onAction={handleOrderAction}
        isConfirming={isConfirming}
      />
      <AssignSheet
        open={actionSheet?.type === 'assign' || actionSheet?.type === 'reassign'}
        mode={actionSheet?.type === 'reassign' ? 'reassign' : 'assign'}
        order={actionSheet?.order}
        onClose={() => setActionSheet(null)}
      />
      <CancelSheet
        open={actionSheet?.type === 'cancel'}
        order={actionSheet?.order}
        onClose={() => setActionSheet(null)}
      />
      <IssueSheet
        open={actionSheet?.type === 'issue' || actionSheet?.type === 'resolve'}
        mode={actionSheet?.type === 'resolve' ? 'resolve' : 'mark'}
        order={actionSheet?.order}
        onClose={() => setActionSheet(null)}
      />
      <ScheduleSheet
        open={actionSheet?.type === 'schedule'}
        order={actionSheet?.order}
        onClose={() => setActionSheet(null)}
      />
      <CreateOrderSheet open={createOpen} onClose={() => setCreateOpen(false)} />
      <CourierDetailSheet
        courierId={courierDetailId}
        couriers={courierList}
        open={!!courierDetailId}
        onClose={() => setCourierDetailId(null)}
      />
      <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} onLogout={logout} />
    </div>
  )
}

function Kpi({ icon, iconBg, iconColor, value, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 15px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 15, flexShrink: 0 }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.text3, marginTop: 3 }}>{label}</div>
      </div>
    </div>
  )
}

const NAV_ITEMS = [
  { key: 'dispatch', label: 'Доска' },
  { key: 'couriers', label: 'Курьеры' },
  { key: 'cash', label: 'Касса' },
  { key: 'history', label: 'История' },
]

function BottomNav({ tab, onTab }) {
  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        background: 'rgba(255,255,255,.92)', backdropFilter: 'blur(12px)',
        borderTop: `1px solid ${C.border}`, padding: '9px 12px 26px', display: 'flex',
      }}
    >
      {NAV_ITEMS.map((n) => {
        const active = tab === n.key
        return (
          <button
            key={n.key}
            onClick={() => onTab(n.key)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0',
              color: active ? C.text1 : C.text3,
            }}
          >
            <NavIcon k={n.key} active={active} />
            <span style={{ fontSize: 10, fontWeight: 700 }}>{n.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function NavIcon({ k, active }) {
  const color = active ? '#1C1C1A' : '#A3A39A'
  const sw = active ? 2.3 : 2
  if (k === 'dispatch') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  if (k === 'couriers') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d="M10 17h4V5H2v12h3" /><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1" /><circle cx="7.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>
  if (k === 'cash') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 6v12M18 6v12" /></svg>
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13a9 9 0 1 0 2.36-6.87L3 8" /><path d="M12 7v5l4 2" /></svg>
}
