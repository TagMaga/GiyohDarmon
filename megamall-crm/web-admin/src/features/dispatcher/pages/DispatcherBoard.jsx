import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Truck, UserCheck, Package, UserX, Flame, Banknote, Flag,
  ClipboardList, Wallet, Check, AlertTriangle, CalendarDays, ChevronDown, WifiOff, Search, Image as ImageIcon, X,
  Pencil, DollarSign, Power, Plus,
} from 'lucide-react'
import { EditCourierModal, TariffsModal, ToggleActiveModal } from '../components/CourierManageModals'
import useAuthStore   from '../../../shared/store/authStore'
import { useToast }   from '../../../shared/components/ToastProvider'
import { KEYS }       from '../../../shared/queryKeys'
import AccountMenu    from '../../../shared/components/AccountMenu'

import CreateOfficeOrderModal from '../components/CreateOfficeOrderModal'
import AssignCourierModal    from '../components/AssignCourierModal'
import UnassignModal         from '../components/UnassignModal'
import ScheduleModal         from '../components/ScheduleModal'
import IssueModal            from '../components/IssueModal'
import CancelModal           from '../components/CancelModal'
import CommentsDrawer        from '../components/CommentsDrawer'
import OrderDrawer           from '../components/OrderDrawer'
import RejectPrepaymentModal from '../components/RejectPrepaymentModal'
import CommandPalette        from '../components/CommandPalette'
import useCustomerMap        from '../hooks/useCustomerMap'

import {
  fetchBoard, fetchNewOrders, fetchIssueOrders, fetchDeliveredOrders,
  fetchCouriersOverview, fetchHandovers, fetchCashSettlement, fetchCashTransactions, fetchDispatchOrderHistory,
  confirmOrder, markReturn, verifyPrepayment, confirmCashTransaction, rejectCashTransaction,
} from '../api'
import { getOrderId, getCourierId, buildCourierMap, resolveCourier, resolveCourierDisplay, formatOrderLabel } from '../utils/orderHelpers'
import { resolveCustomer, resolveAddress, resolveCity } from '../utils/resolveCustomer'
import { fmt, fmtDate, isOverdue, isToday, isTomorrow, orderAge, orderAgeMinutes } from '../statusConfig'
import './DispatcherBoardV2.css'

const arr = (d) => Array.isArray(d) ? d : (d?.orders ?? d?.data ?? d?.items ?? d?.handovers ?? [])
const meta = (d) => d?.meta ?? {}

const ACTION_MODAL = {
  assign: 'assign',
  reassign: 'reassign',
  unassign: 'unassign',
  schedule: 'schedule',
  issue: 'issue',
  resolve: 'resolve',
  cancel: 'cancel',
  comment: 'comments',
}

const COLUMNS = [
  { key: 'new', label: 'Новые', color: 'var(--text3)', statuses: ['new'] },
  { key: 'confirmed', label: 'Подтверждены', color: 'var(--blue)', statuses: ['confirmed'] },
  { key: 'delivery', label: 'В доставке', color: 'var(--amber)', statuses: ['assigned', 'in_delivery'] },
  { key: 'done', label: 'Доставлено', color: 'var(--green)', statuses: ['delivered'] },
  { key: 'issues', label: 'Проблемы', color: 'var(--red)', statuses: ['issue'] },
]

const STATUS_TO_COL = {
  new: 'new',
  confirmed: 'confirmed',
  assigned: 'delivery',
  in_delivery: 'delivery',
  delivered: 'done',
  issue: 'issues',
}

const EMPTY_FILTERS = { courier: '', date: 'all', tab: 'dispatch', mobileStatus: 'new' }
const CASH_PRESETS = [
  { value: 'all', label: 'Все время' },
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'last7', label: 'Последние 7 дней' },
  { value: 'last14', label: 'Последние 14 дней' },
  { value: 'last30', label: 'Последние 30 дней' },
  { value: 'month', label: 'Этот месяц' },
  { value: 'prevMonth', label: 'Прошлый месяц' },
  { value: 'custom', label: 'Custom range' },
]

export default function DispatcherBoard() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const { phone, clearAuth } = useAuthStore()

  const [modal, setModal] = useState(null)
  const [activeOrder, setActiveOrder] = useState(null)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [couriersOpen, setCouriersOpen] = useState(false)
  const [createOrderOpen, setCreateOrderOpen] = useState(false)
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [cashRange, setCashRange] = useState(() => ({ preset: 'all', from: '', to: '' }))
  const [cashCourier, setCashCourier] = useState('')
  const [transactionsRange, setTransactionsRange] = useState(() => ({ preset: 'all', from: '', to: '' }))
  const [transactionsCourier, setTransactionsCourier] = useState('')
  const [transactionsStatus, setTransactionsStatus] = useState('')
  const [transactionsPage, setTransactionsPage] = useState(1)
  const [historyRange, setHistoryRange] = useState(() => ({ preset: 'all', from: '', to: '' }))
  const [historyFilters, setHistoryFilters] = useState(() => ({
    status: '',
    product: '',
    courier: '',
    seller: '',
    search: '',
    page: 1,
  }))
  const [photoPreview, setPhotoPreview] = useState(null)
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark'
    // One-time migration: pre-fix, useTheme.js wrote the main admin theme into
    // dispatch-v2-theme, which could be 'light'. Clear that stale value once so
    // the dispatcher always starts dark for existing users after this deploy.
    if (!localStorage.getItem('dispatch-v2-migrated-v1')) {
      localStorage.removeItem('dispatch-v2-theme')
      localStorage.setItem('dispatch-v2-migrated-v1', '1')
    }
    return window.localStorage.getItem('dispatch-v2-theme') || 'dark'
  })

  const board = useQuery({ queryKey: KEYS.dispatcher.board, queryFn: fetchBoard, refetchInterval: 30_000, staleTime: 25_000 })
  const news = useQuery({ queryKey: KEYS.dispatcher.newOrders, queryFn: fetchNewOrders, refetchInterval: 30_000, staleTime: 25_000 })
  const issues = useQuery({ queryKey: KEYS.dispatcher.issues, queryFn: fetchIssueOrders, refetchInterval: 30_000, staleTime: 25_000 })
  const delivered = useQuery({ queryKey: KEYS.dispatcher.delivered, queryFn: fetchDeliveredOrders, refetchInterval: 60_000, staleTime: 55_000 })
  const couriers = useQuery({ queryKey: KEYS.dispatcher.couriers, queryFn: fetchCouriersOverview, refetchInterval: 30_000, staleTime: 20_000 })
  const handovers = useQuery({ queryKey: KEYS.dispatcher.handovers, queryFn: fetchHandovers, refetchInterval: 60_000, staleTime: 45_000 })
  const cashParams = useMemo(() => buildCashParams(cashRange, cashCourier), [cashRange, cashCourier])
  const cashSettlement = useQuery({
    queryKey: KEYS.dispatcher.cashSettlement(cashParams),
    queryFn: () => fetchCashSettlement(cashParams),
    refetchInterval: 60_000,
    staleTime: 45_000,
  })
  const transactionParams = useMemo(() => ({
    ...buildCashParams(transactionsRange, transactionsCourier),
    page: transactionsPage,
    limit: 30,
    ...(transactionsStatus ? { status: transactionsStatus } : {}),
  }), [transactionsRange, transactionsCourier, transactionsPage, transactionsStatus])
  const cashTransactions = useQuery({
    queryKey: KEYS.dispatcher.cashTransactions(transactionParams),
    queryFn: () => fetchCashTransactions(transactionParams),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const historyParams = useMemo(() => ({
    ...buildCashParams(historyRange, historyFilters.courier),
    page: historyFilters.page,
    limit: 30,
    ...(historyFilters.status ? { status: historyFilters.status } : {}),
    ...(historyFilters.product.trim() ? { product: historyFilters.product.trim() } : {}),
    ...(historyFilters.seller.trim() ? { seller: historyFilters.seller.trim() } : {}),
    ...(historyFilters.search.trim() ? { search: historyFilters.search.trim() } : {}),
  }), [historyRange, historyFilters])
  const orderHistory = useQuery({
    queryKey: KEYS.dispatcher.orderHistory(historyParams),
    queryFn: () => fetchDispatchOrderHistory(historyParams),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const allOrders = useMemo(() => {
    const seen = new Set()
    const merged = []
    for (const order of [...arr(news.data), ...arr(board.data), ...arr(issues.data), ...arr(delivered.data)]) {
      const id = getOrderId(order)
      if (id && !seen.has(id)) {
        seen.add(id)
        merged.push(order)
      }
    }
    return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [news.data, board.data, issues.data, delivered.data])

  const customerMap = useCustomerMap(allOrders)
  const courierList = arr(couriers.data)
  const courierMap = useMemo(() => buildCourierMap(courierList), [courierList])
  const handoverList = arr(handovers.data)

  const counts = useMemo(() => {
    const c = { new: 0, confirmed: 0, delivery: 0, done: 0, issues: 0, overdue: 0, unassigned: 0 }
    for (const order of allOrders) {
      const col = STATUS_TO_COL[order.status]
      if (col) c[col] += 1
      if (isOverdue(order)) c.overdue += 1
      if (order.status === 'confirmed' && !getCourierId(order)) c.unassigned += 1
    }
    return c
  }, [allOrders])

  const cashOwed = useMemo(
    () => courierList.reduce((sum, courier) => sum + Number(courier.cash_owed ?? 0), 0),
    [courierList],
  )

  const filteredOrders = useMemo(() => {
    return allOrders.filter((order) => {
      if (filters.courier === 'unassigned') {
        // Show only confirmed orders with no courier assigned
        if (order.status !== 'confirmed') return false
        if (getCourierId(order)) return false
      } else if (filters.courier) {
        if (getCourierId(order) !== filters.courier) return false
      }
      if (filters.date !== 'all') {
        const when = order.scheduled_at || order.delivery_date
        if (filters.date === 'overdue' && !isOverdue(order)) return false
        if (filters.date === 'today' && !isToday(when)) return false
        if (filters.date === 'tomorrow' && !isTomorrow(when)) return false
      }
      return true
    })
  }, [allOrders, filters.courier, filters.date])

  const grouped = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((col) => [col.key, []]))
    for (const order of filteredOrders) {
      const key = STATUS_TO_COL[order.status]
      if (key) map[key].push(order)
    }
    return map
  }, [filteredOrders])

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

  const { mutate: doConfirm } = useMutation({
    mutationFn: (order) => confirmOrder(requiredOrderId(order)),
    onSuccess: () => { invalidate(); toast.success('Заказ подтверждён') },
    onError: onErr,
  })
  const { mutate: doReturn } = useMutation({
    mutationFn: (order) => markReturn(requiredOrderId(order)),
    onSuccess: () => { invalidate(); toast.success('Заказ переведён в возврат') },
    onError: onErr,
  })
  const { mutate: doVerifyPrepayment } = useMutation({
    mutationFn: (order) => verifyPrepayment(requiredOrderId(order)),
    onSuccess: () => { invalidate(); toast.success('Предоплата подтверждена') },
    onError: onErr,
  })
  const { mutate: doConfirmTransaction, isPending: confirmingTransaction } = useMutation({
    mutationFn: (id) => confirmCashTransaction(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatcher'] })
      toast.success('Транзакция подтверждена')
    },
    onError: onErr,
  })
  const { mutate: doRejectTransaction, isPending: rejectingTransaction } = useMutation({
    mutationFn: ({ id, reason }) => rejectCashTransaction(id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatcher'] })
      toast.success('Транзакция отклонена')
    },
    onError: onErr,
  })

  const handleAction = useCallback((action, order) => {
    if (action === 'confirm') { doConfirm(order); return }
    if (action === 'return') { doReturn(order); return }
    if (action === 'verify_prepayment') { doVerifyPrepayment(order); return }
    if (action === 'reject_prepayment') { setActiveOrder(order); setModal('reject_prepayment'); return }
    const key = ACTION_MODAL[action]
    if (key) {
      if (!getOrderId(order)) { toast.error('ID заказа не найден'); return }
      setActiveOrder(order)
      setModal(key)
    }
  }, [doConfirm, doReturn, doVerifyPrepayment, toast])

  const handleRefresh = useCallback(async () => {
    await Promise.all([board.refetch(), news.refetch(), issues.refetch(), delivered.refetch(), couriers.refetch(), handovers.refetch(), cashSettlement.refetch(), cashTransactions.refetch(), orderHistory.refetch()])
    toast.success('Данные обновлены')
  }, [board, news, issues, delivered, couriers, handovers, cashSettlement, cashTransactions, orderHistory, toast])

  useEffect(() => {
    function onKey(e) {
      const tag = e.target?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShortcutsOpen((open) => !open)
        return
      }
      if (typing || paletteOpen || modal) return
      if (e.key === 'r' || e.key === 'R') handleRefresh()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paletteOpen, modal, handleRefresh])

  useEffect(() => {
    window.localStorage.setItem('dispatch-v2-theme', theme)
  }, [theme])

  const closeModal = useCallback(() => {
    setModal(null)
    setActiveOrder(null)
  }, [])

  // Mobile board shows one column at a time. If the user hasn't manually picked a
  // column and the default (or current) one is empty, fall back to the first
  // non-empty column by board priority (left→right) so a mobile dispatcher never
  // lands on "Пусто" while real orders wait in another column (P6).
  const effectiveMobileStatus = useMemo(() => {
    if ((grouped[filters.mobileStatus]?.length ?? 0) > 0) return filters.mobileStatus
    if (filters.mobileTouched) return filters.mobileStatus
    const firstNonEmpty = COLUMNS.find((c) => (grouped[c.key]?.length ?? 0) > 0)
    return firstNonEmpty ? firstNonEmpty.key : filters.mobileStatus
  }, [grouped, filters.mobileStatus, filters.mobileTouched])

  const currentMobileOrders = grouped[effectiveMobileStatus] ?? []
  const isLoading = board.isPending || news.isPending

  function logout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="dispatch-v2" data-theme={theme}>
      <TopbarV2
        phone={phone}
        problemCount={counts.issues + counts.overdue}
        onPalette={() => setPaletteOpen(true)}
        onShortcuts={() => setShortcutsOpen((open) => !open)}
        onRefresh={handleRefresh}
        onLogout={logout}
        onCouriers={() => setCouriersOpen(true)}
        theme={theme}
        onToggleTheme={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
      />

      <KpiBar counts={counts} couriers={courierList} orders={allOrders} cashOwed={cashOwed} setFilters={setFilters} onCreateOrder={() => setCreateOrderOpen(true)} />

      <TabBar
        tab={filters.tab}
        date={filters.date}
        counts={counts}
        onTab={(tab) => setFilters((prev) => ({ ...prev, tab }))}
        onDate={(date) => setFilters((prev) => ({ ...prev, date }))}
      />

      <main className="dv2-main">
        {couriersOpen && <div className="dv2-mobile-overlay" onClick={() => setCouriersOpen(false)} />}
        <CourierRail
          couriers={courierList}
          activeCourier={filters.courier}
          mobileOpen={couriersOpen}
          unassignedCount={counts.unassigned}
          onSelect={(id) => {
            setFilters((prev) => ({ ...prev, courier: prev.courier === id ? '' : id }))
            setCouriersOpen(false)
          }}
        />

        {filters.tab === 'cash' ? (
          <CashView
            rows={arr(cashSettlement.data)}
            couriers={courierList}
            range={cashRange}
            courierId={cashCourier}
            loading={cashSettlement.isPending}
            error={cashSettlement.error}
            onRange={setCashRange}
            onCourier={setCashCourier}
            onRetry={() => cashSettlement.refetch()}
            onCourierUpdated={() => {
              qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
              cashSettlement.refetch()
            }}
          />
        ) : filters.tab === 'cashRegister' ? (
          <CashTransactionsView
            rows={arr(cashTransactions.data)}
            pageMeta={meta(cashTransactions.data)}
            couriers={courierList}
            range={transactionsRange}
            courierId={transactionsCourier}
            status={transactionsStatus}
            loading={cashTransactions.isPending}
            error={cashTransactions.error}
            confirming={confirmingTransaction}
            rejecting={rejectingTransaction}
            onRange={(range) => { setTransactionsRange(range); setTransactionsPage(1) }}
            onCourier={(id) => { setTransactionsCourier(id); setTransactionsPage(1) }}
            onStatus={(status) => { setTransactionsStatus(status); setTransactionsPage(1) }}
            onPage={setTransactionsPage}
            onRetry={() => cashTransactions.refetch()}
            onConfirm={(id) => doConfirmTransaction(id)}
            onReject={(id, reason) => doRejectTransaction({ id, reason })}
            onPreview={setPhotoPreview}
          />
        ) : filters.tab === 'history' ? (
          <OrderHistoryView
            rows={arr(orderHistory.data)}
            pageMeta={meta(orderHistory.data)}
            couriers={courierList}
            range={historyRange}
            filters={historyFilters}
            loading={orderHistory.isPending}
            error={orderHistory.error}
            onRange={(range) => { setHistoryRange(range); setHistoryFilters((prev) => ({ ...prev, page: 1 })) }}
            onFilters={(next) => setHistoryFilters((prev) => ({ ...prev, ...next, page: next.page ?? 1 }))}
            onPage={(page) => setHistoryFilters((prev) => ({ ...prev, page }))}
            onRetry={() => orderHistory.refetch()}
          />
        ) : (
          <section className="dv2-board-wrap">
            <div className="dv2-board">
              {COLUMNS.map((col) => (
                <Column
                  key={col.key}
                  col={col}
                  orders={grouped[col.key] ?? []}
                  loading={isLoading}
                  customerMap={customerMap}
                  courierMap={courierMap}
                  selectedOrder={selectedOrder}
                  onSelect={setSelectedOrder}
                  onAction={handleAction}
                />
              ))}
            </div>

            <div className="dv2-mobile-board">
              <div className="dv2-mobile-datebar">
                {dateOptions().map((opt) => (
                  <button key={opt.value} className={`dv2-chip-mobile ${filters.date === opt.value ? 'active' : ''}`} onClick={() => setFilters((prev) => ({ ...prev, date: opt.value }))}>
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="dv2-mobile-tabs">
                {COLUMNS.map((col) => (
                  <button key={col.key} className={`dv2-chip-mobile ${effectiveMobileStatus === col.key ? 'active' : ''}`} onClick={() => setFilters((prev) => ({ ...prev, mobileStatus: col.key, mobileTouched: true }))}>
                    {col.label} <span>{grouped[col.key]?.length || 0}</span>
                  </button>
                ))}
              </div>
              <div className="dv2-mobile-list">
                {currentMobileOrders.length === 0 ? (
                  <EmptyState />
                ) : (
                  currentMobileOrders.map((order) => (
                    <OrderCard
                      key={getOrderId(order)}
                      order={order}
                      customerMap={customerMap}
                      courierMap={courierMap}
                      selected={selectedOrder && getOrderId(selectedOrder) === getOrderId(order)}
                      onSelect={setSelectedOrder}
                      onAction={handleAction}
                    />
                  ))
                )}
              </div>
            </div>

            <OrderDrawer
              order={selectedOrder}
              open={!!selectedOrder}
              customerMap={customerMap}
              courierMap={courierMap}
              onClose={() => setSelectedOrder(null)}
              onAction={handleAction}
            />
          </section>
        )}
      </main>

      <BottomNav tab={filters.tab} counts={counts} onTab={(tab) => setFilters((prev) => ({ ...prev, tab }))} />

      <CreateOfficeOrderModal open={createOrderOpen} onClose={() => setCreateOrderOpen(false)} />
      <AssignCourierModal    open={modal === 'assign'}            onClose={closeModal} order={activeOrder} mode="assign" />
      <AssignCourierModal    open={modal === 'reassign'}          onClose={closeModal} order={activeOrder} mode="reassign" />
      <UnassignModal         open={modal === 'unassign'}          onClose={closeModal} order={activeOrder} courierMap={courierMap} />
      <ScheduleModal         open={modal === 'schedule'}          onClose={closeModal} order={activeOrder} />
      <IssueModal            open={modal === 'issue'}             onClose={closeModal} order={activeOrder} mode="mark" />
      <IssueModal            open={modal === 'resolve'}           onClose={closeModal} order={activeOrder} mode="resolve" />
      <CancelModal           open={modal === 'cancel'}            onClose={closeModal} order={activeOrder} />
      <CommentsDrawer        open={modal === 'comments'}          onClose={closeModal} order={activeOrder} />
      <RejectPrepaymentModal open={modal === 'reject_prepayment'} onClose={closeModal} order={activeOrder} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onCommand={(action) => {
        if (action === 'refresh') handleRefresh()
        if (action === 'viewCouriers') setCouriersOpen(true)
        if (action === 'viewCash') setFilters((prev) => ({ ...prev, tab: 'cash' }))
        if (action === 'viewIssues') setFilters((prev) => ({ ...prev, mobileStatus: 'issues' }))
      }} orders={allOrders} />
      <ShortcutsToast open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <PhotoPreviewModal url={photoPreview} onClose={() => setPhotoPreview(null)} />
    </div>
  )
}

function TopbarV2({ problemCount, onPalette, onShortcuts, onRefresh, onCouriers, theme, onToggleTheme }) {
  return (
    <header className="dv2-topbar">
      <div className="dv2-brand">
        <div className="dv2-brand-icon">◆</div>
        <div>
          <div className="dv2-brand-main">MegaMall Dispatch</div>
          <div className="dv2-brand-tag">Control Center</div>
        </div>
      </div>
      <div className="dv2-sep" />
      <button className="dv2-cmd" onClick={onPalette}>⌘ <span>Команды</span><kbd>K</kbd></button>
      <button className="dv2-icon-btn dv2-mobile-action" onClick={onCouriers}>☰</button>
      <div className="dv2-spacer" />
      <div className="dv2-pill"><span className="dv2-dot-live" /> Онлайн</div>
      <button className="dv2-icon-btn" onClick={onRefresh} title="Обновить">↻</button>
      <button className="dv2-icon-btn tb-icon-btn dv2-hide-mobile" id="tb-shortcuts-btn" onClick={onShortcuts} title="Горячие клавиши">⌨️</button>
      <button className="dv2-icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>{theme === 'dark' ? '☀️' : '🌙'}</button>
      <button className="dv2-icon-btn dv2-hide-mobile" title="Уведомления">🔔{problemCount > 0 && <span className="dv2-notif">{problemCount}</span>}</button>
      <AccountMenu variant="dark" />
    </header>
  )
}

function ShortcutsToast({ open, onClose }) {
  if (!open) return null

  return (
    <div className="dv2-shortcuts">
      <div className="dv2-shortcuts-head">
        <div className="dv2-shortcuts-title">Горячие клавиши</div>
        <button className="dv2-shortcuts-close" onClick={onClose}>×</button>
      </div>
      <Shortcut label="Командная палитра" keys="⌘ / Ctrl + K" />
      <Shortcut label="Обновить данные" keys="R" />
      <Shortcut label="Показать подсказки" keys="⌘ / Ctrl + /" />
      <Shortcut label="Открыть заказ" keys="Click" />
    </div>
  )
}

function Shortcut({ label, keys }) {
  return (
    <div className="dv2-shortcut-row">
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </div>
  )
}

function KpiBar({ counts, couriers, orders, cashOwed, setFilters, onCreateOrder }) {
  const active = counts.new + counts.confirmed + counts.delivery + counts.issues
  const deliveredToday = orders.filter((order) => order.status === 'delivered' && isToday(order.delivered_at || order.updated_at || order.created_at)).length
  const busyCouriers = couriers.filter((courier) => Number(courier.active_orders ?? 0) > 0).length
  const freeCouriers = Math.max(0, couriers.length - busyCouriers)
  const intakeDisabled = couriers.filter((courier) => courier.order_intake_enabled === false).length

  return (
    <div className="dv2-kpibar">
      <Kpi icon={<Truck size={18} />} value={couriers.length} label="Курьеров" />
      <Kpi icon={<UserCheck size={18} />} value={freeCouriers} label="Свободны" />
      <Kpi alert={intakeDisabled > 0} icon={<UserX size={18} />} value={intakeDisabled} label="Не принимают" />
      <Kpi icon={<Package size={18} />} value={active} label="Активные" />
      <div className="dv2-kpi-sep" />
      <Kpi mobileExtra alert={counts.unassigned > 0} icon={<UserX size={18} />} value={counts.unassigned} label="Без курьера" onClick={() => setFilters((p) => ({ ...p, mobileStatus: 'confirmed', mobileTouched: true }))} />
      <Kpi mobileExtra alert={counts.issues + counts.overdue > 0} icon={<Flame size={18} />} value={counts.issues + counts.overdue} label="Проблемы" onClick={() => setFilters((p) => ({ ...p, mobileStatus: 'issues', mobileTouched: true }))} />
      <Kpi mobileExtra icon={<Banknote size={18} />} value={fmt(cashOwed)} label="Наличные" />
      <div className="dv2-kpi-sep" />
      <Kpi mobileExtra icon={<Flag size={18} />} value={deliveredToday} label="Сегодня" />
      <div className="dv2-kpi-sep dv2-hide-mobile" />
      <button
        className="dv2-kpi dv2-hide-mobile"
        onClick={onCreateOrder}
        title="Создать офисный заказ"
        style={{ cursor: 'pointer', color: 'var(--blue)', gap: 6 }}
      >
        <span className="dv2-kpi-icon"><Plus size={18} /></span>
        <div>
          <div className="dv2-kpi-val" style={{ fontSize: 13 }}>Заказ</div>
          <div className="dv2-kpi-lbl">Офис</div>
        </div>
      </button>
    </div>
  )
}

function Kpi({ icon, value, label, alert, onClick, mobileExtra }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp className={`dv2-kpi ${alert ? 'alert' : ''} ${mobileExtra ? 'dv2-kpi-mobile-extra' : ''}`} onClick={onClick}>
      <span className="dv2-kpi-icon">{icon}</span>
      <div>
        <div className="dv2-kpi-val">{value}</div>
        <div className="dv2-kpi-lbl">{label}</div>
      </div>
    </Comp>
  )
}

function TabBar({ tab, date, counts, onTab, onDate }) {
  return (
    <div className="dv2-tabbar">
      <button className={`dv2-tab ${tab === 'dispatch' ? 'active' : ''}`} onClick={() => onTab('dispatch')}><ClipboardList size={15} /> Операционная доска</button>
      <button className={`dv2-tab ${tab === 'cash' ? 'active' : ''}`} onClick={() => onTab('cash')}><Wallet size={15} /> Курьеры</button>
      <button className={`dv2-tab ${tab === 'cashRegister' ? 'active' : ''}`} onClick={() => onTab('cashRegister')}><Banknote size={15} /> 💵 Касса</button>
      <button className={`dv2-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => onTab('history')}><ClipboardList size={15} /> 📋 История</button>
      <div className="dv2-spacer" />
      <div className={`dv2-date-tabs ${tab !== 'dispatch' ? 'hidden' : ''}`}>
        {dateOptions().map((opt) => (
          <button key={opt.value} className={`dv2-date ${date === opt.value ? 'active' : ''}`} onClick={() => onDate(opt.value)}>{opt.label}</button>
        ))}
      </div>
    </div>
  )
}

function CourierRail({ couriers, activeCourier, mobileOpen, onSelect, unassignedCount }) {
  const busy = couriers.filter((courier) => Number(courier.active_orders ?? 0) > 0).length
  const overloaded = couriers.filter((courier) => Number(courier.active_orders ?? 0) >= 5).length
  const cashRisk = couriers.filter((courier) => Number(courier.cash_owed ?? 0) > 0).length
  const intakeDisabled = couriers.filter((courier) => courier.order_intake_enabled === false).length

  return (
    <aside className={`dv2-couriers ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="dv2-cs-header">
        <div className="dv2-section-label">Флот курьеров</div>
        <div className="dv2-fleet-stats">
          <FleetStat tone="green" value={Math.max(0, couriers.length - busy)} label="Свободны" />
          <FleetStat tone="amber" value={busy} label="Заняты" />
          <FleetStat tone="red" value={overloaded} label="Перегруз" />
          <FleetStat tone="red" value={intakeDisabled} label="Не принимают" />
          <FleetStat tone="gray" value={cashRisk} label="Долг" />
        </div>
      </div>
      <div className="dv2-courier-list">
        {/* Special "unassigned" filter row */}
        <button
          className={`dv2-courier ${activeCourier === 'unassigned' ? 'selected' : ''}`}
          onClick={() => onSelect('unassigned')}
          style={{ marginBottom: 6 }}
        >
          <div className="dv2-courier-top">
            <div className="dv2-courier-avatar" style={{ background: '#6366f1' }}>
              <UserX size={12} />
            </div>
            <div className="dv2-courier-name">Без курьера</div>
            {unassignedCount > 0 && (
              <span style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8 }}>
                {unassignedCount}
              </span>
            )}
          </div>
          <div className="dv2-courier-row" style={{ fontSize: 10, color: 'var(--text3)' }}>
            Подтверждённые без назначения
          </div>
        </button>

        {couriers.length === 0 ? <EmptyState title="Нет курьеров" sub="Курьеры появятся после загрузки" /> : couriers.map((courier, i) => (
          <CourierCard key={courier.courier_id ?? courier.id ?? i} courier={courier} selected={activeCourier === (courier.courier_id ?? courier.id)} onSelect={onSelect} />
        ))}
      </div>
    </aside>
  )
}

function FleetStat({ tone, value, label }) {
  return (
    <div className={`dv2-cs-stat ${tone}`}>
      <div className="dv2-cs-stat-val">{value}</div>
      <div className="dv2-cs-stat-lbl">{label}</div>
    </div>
  )
}

function CourierCard({ courier, selected, onSelect }) {
  const id = courier.courier_id ?? courier.id
  const name = courier.full_name ?? courier.courier?.full_name ?? 'Курьер'
  const active = Number(courier.active_orders ?? 0)
  const cash = Number(courier.cash_owed ?? 0)
  const intakeEnabled = courier.order_intake_enabled !== false
  const loadPct = Math.min(100, Math.round((active / 6) * 100))
  const loadTone = active >= 5 ? 'red' : active >= 3 ? 'amber' : 'green'
  const dot = !intakeEnabled ? 'overloaded' : active >= 5 ? 'overloaded' : active > 0 ? 'busy' : 'available'

  return (
    <button className={`dv2-courier ${selected ? 'selected' : ''} ${!intakeEnabled ? 'intake-off' : ''}`} onClick={() => onSelect(id)}>
      <div className="dv2-courier-top">
        <div className="dv2-courier-avatar" style={{ background: avatarColor(name) }}>{initials(name)}</div>
        <div className="dv2-courier-name">{name}</div>
        <span className={`dv2-status-dot ${dot}`} />
      </div>
      <div>
        <div className="dv2-bar-label"><span>Нагрузка</span><span>{active}/6</span></div>
        <div className="dv2-bar-track"><div className={`dv2-bar-fill ${loadTone}`} style={{ width: `${loadPct}%` }} /></div>
      </div>
      <div className="dv2-courier-row">
        <span>Активных <strong>{active}</strong></span>
        <span className="dv2-cash">{fmt(cash)} сом</span>
      </div>
      {Array.isArray(courier.city_names) && courier.city_names.length > 0 && (
        <div className="dv2-courier-cities">
          {courier.city_names.map((name) => (
            <span key={name} className="dv2-city-tag">{name}</span>
          ))}
        </div>
      )}
      {!intakeEnabled && (
        <div className="dv2-courier-intake-off">
          <strong>Приём заказов: выключен</strong>
          {courier.order_intake_reason ? <span>{courier.order_intake_reason}</span> : null}
        </div>
      )}
    </button>
  )
}

function Column({ col, orders, loading, customerMap, courierMap, selectedOrder, onSelect, onAction }) {
  return (
    <section className="dv2-col" style={{ '--col-color': col.color }}>
      <div className="dv2-col-head">
        <div className="dv2-col-title">{col.label}</div>
        <div className="dv2-col-cnt">{orders.length}</div>
      </div>
      <div className="dv2-col-body">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="loading-skeleton" style={{ height: 92 }} />)
        ) : orders.length === 0 ? (
          <EmptyState />
        ) : (
          orders.map((order) => (
            <OrderCard
              key={getOrderId(order)}
              order={order}
              customerMap={customerMap}
              courierMap={courierMap}
              selected={selectedOrder && getOrderId(selectedOrder) === getOrderId(order)}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))
        )}
      </div>
    </section>
  )
}

function OrderCard({ order, customerMap, courierMap, selected, onSelect, onAction }) {
  const customer = resolveCustomer(order, customerMap)
  const courierDisp = resolveCourierDisplay(order, courierMap)
  const address = resolveAddress(order) || customer?.address || resolveCity(order) || customer?.city || '—'
  const mins = orderAgeMinutes(order)
  const urgentClass = mins >= 60 || order.status === 'issue' || isOverdue(order) ? 'urgent-red' : mins >= 30 ? 'urgent-amber' : ''
  const cardColor = order.status === 'new' ? 'var(--text3)' : order.status === 'confirmed' ? 'var(--blue)' : order.status === 'issue' ? 'var(--red)' : order.status === 'delivered' ? 'var(--green)' : 'var(--amber)'
  const isCash = order.payment_method === 'cash' || order.payment_method === 'наличные'
  const hasPrepay = order.prepayment_status || Number(order.prepayment_amount ?? 0) > 0

  return (
    <div
      className={`dv2-order ${selected ? 'selected' : ''} ${urgentClass}`}
      style={{ '--card-color': cardColor }}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(order)}
      onKeyDown={(e) => {
        // Only respond when the card itself is focused — not a child action
        // button — so Enter/Space on an action never also opens the drawer.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(order)
        }
      }}
    >
      <div className="dv2-oc-head">
        <span className="dv2-oc-num">#{formatOrderLabel(order)}</span>
        <span className="dv2-oc-badges">
          {isCash && <span className="dv2-badge cash">cash</span>}
          {!isCash && order.payment_method && <span className="dv2-badge card">card</span>}
          {hasPrepay && <span className="dv2-badge claimable">prepay</span>}
          {(mins >= 30 || isOverdue(order)) && <span className="dv2-badge urgent">{orderAge(order)}</span>}
          {order.status === 'issue' && <span className="dv2-badge issue">issue</span>}
          {isToday(order.scheduled_at || order.delivery_date) && <span className="dv2-badge today">today</span>}
          {isTomorrow(order.scheduled_at || order.delivery_date) && <span className="dv2-badge tomorrow">tomorrow</span>}
        </span>
      </div>
      <div className="dv2-oc-name">{customer.full_name || customer.phone || 'Клиент —'}</div>
      <div className="dv2-oc-addr">{address}</div>
      <div className="dv2-oc-foot">
        <div className="dv2-oc-amount">{fmt(order.total_amount)} сом</div>
        <div className="dv2-oc-courier"><span className="dv2-oc-dot" /><span>{courierDisp.name || 'Без курьера'}</span></div>
      </div>
      <div className="dv2-oc-actions" onClick={(e) => e.stopPropagation()}>
        {order.status === 'new' && <button className="dv2-oc-action" aria-label="Подтвердить" onClick={() => onAction('confirm', order)}><Check size={15} /></button>}
        {order.status === 'confirmed' && <button className="dv2-oc-action" aria-label="Назначить курьера" onClick={() => onAction('assign', order)}><Truck size={15} /></button>}
        {!['delivered', 'cancelled'].includes(order.status) && <button className="dv2-oc-action" aria-label="Проблема" onClick={() => onAction('issue', order)}><AlertTriangle size={15} /></button>}
      </div>
    </div>
  )
}

function DetailPanel({ order, customerMap, courierMap, onClose, onAction }) {
  const customer = order ? resolveCustomer(order, customerMap) : null
  const courier  = order ? resolveCourier(order, courierMap)  : null
  const actions  = order ? primaryActions(order.status) : []

  return (
    <>
      {order && <div className="dv2-detail-backdrop" onClick={onClose} />}
      <aside className={`dv2-detail${order ? ' open' : ''}`}>
        {order && (
          <>
            <div className="dv2-dp-header">
              <div className="dv2-dp-left">
                <div className="dv2-dp-num">#{formatOrderLabel(order)}</div>
                <div className="dv2-dp-date">{fmtDate(order.created_at)}</div>
              </div>
              <button className="dv2-dp-close" onClick={onClose}>×</button>
            </div>
            <div className="dv2-dp-body">
              <section className="dv2-dp-section">
                <div className="dv2-dp-title">Заказ</div>
                <div className="dv2-info-grid">
                  <Info label="Клиент" value={customer.full_name || '—'} />
                  <Info label="Телефон" value={customer.phone || '—'} />
                  <Info label="Сумма" value={`${fmt(order.total_amount)} сом`} />
                  <Info label="Возраст" value={orderAge(order) || '—'} />
                  <Info full label="Адрес" value={resolveAddress(order) || customer?.address || resolveCity(order) || customer?.city || '—'} />
                </div>
              </section>
              <section className="dv2-dp-section">
                <div className="dv2-dp-title">Курьер</div>
                {courier?.full_name ? (
                  <div className="dv2-dp-courier">
                    <div className="dv2-courier-avatar" style={{ background: avatarColor(courier.full_name) }}>{initials(courier.full_name)}</div>
                    <div>
                      <div className="dv2-courier-name">{courier.full_name}</div>
                      <div className="dv2-oc-courier">{courier.phone || 'Назначен'}</div>
                    </div>
                  </div>
                ) : (
                  <div className="dv2-info full"><div className="dv2-info-val">Курьер не назначен</div></div>
                )}
              </section>
            </div>
            <div className="dv2-dp-actions">
              {actions.map((action) => (
                <button key={action.key} className={`dv2-btn ${action.className}`} onClick={() => onAction(action.key, order)}>{action.label}</button>
              ))}
              <div className="dv2-btn-row">
                <button className="dv2-btn dv2-btn-ghost" onClick={() => onAction('comment', order)}>Комментарий</button>
                <button className="dv2-btn dv2-btn-danger" onClick={() => onAction('cancel', order)}>Отмена</button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

function Info({ label, value, full }) {
  return (
    <div className={`dv2-info ${full ? 'full' : ''}`}>
      <div className="dv2-info-lbl">{label}</div>
      <div className="dv2-info-val">{value}</div>
    </div>
  )
}

function CashView({ rows, couriers, range, courierId, loading, error, onRange, onCourier, onRetry, onCourierUpdated }) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const [editTarget,   setEditTarget]   = useState(null)
  const [tariffsTarget, setTariffsTarget] = useState(null)
  const [toggleTarget, setToggleTarget] = useState(null)

  const courierMap = useMemo(() => {
    const m = {}
    for (const c of (couriers ?? [])) m[c.courier_id ?? c.id] = c
    return m
  }, [couriers])

  const visibleRows = useMemo(() => {
    if (range.preset === 'all') return rows
    return rows.filter(hasCashSettlementActivity)
  }, [range.preset, rows])

  const summary = useMemo(() => {
    const delivered = visibleRows.reduce((sum, row) => sum + Number(row.delivered ?? 0), 0)
    const failed = visibleRows.reduce((sum, row) => sum + Number(row.failed ?? 0), 0)
    const debt = visibleRows.reduce((sum, row) => sum + Number(row.cash_debt ?? 0), 0)
    const earnings = visibleRows.reduce((sum, row) => sum + Number(row.earnings ?? 0), 0)
    const total = delivered + failed
    return {
      delivered,
      failed,
      debt,
      earnings,
      success: total > 0 ? (delivered * 100) / total : null,
    }
  }, [visibleRows])

  useEffect(() => {
    if (!error) return
    console.error('Cash settlement load failed:', error)
  }, [error])

  return (
  <>
    <section className="dv2-cash-view">
      <div className="dv2-cash-compact-bar">
        <CashRangePicker range={range} open={rangeOpen} onOpen={setRangeOpen} onRange={onRange} />
        <select
          className="dv2-cash-select"
          value={courierId}
          onChange={(e) => onCourier(e.target.value)}
          aria-label="Курьер"
        >
          <option value="">Все курьеры</option>
          {couriers.map((courier) => {
            const id = courier.courier_id ?? courier.id
            return <option key={id} value={id}>{courier.full_name ?? courier.courier_name ?? 'Курьер'}</option>
          })}
        </select>
      </div>

      <div className="dv2-kpi-strip">
        <CashMetric label="Долг" value={`${fmt(summary.debt)} сом`} tone="red" />
        <CashMetric label="Доставлено" value={fmt(summary.delivered)} tone="green" />
        <CashMetric label="Неудача" value={fmt(summary.failed)} tone="amber" />
        <CashMetric label="Заработок" value={`${fmt(summary.earnings)} сом`} tone="purple" />
        <CashMetric label="Успех" value={summary.success == null ? '—' : `${Math.round(summary.success)}%`} tone="blue" />
      </div>

      <div className="dv2-cash-table-wrap">
        <div className="dv2-cash-head">
          <div className="dv2-cash-title small">Курьеры</div>
          <div className="dv2-cash-status pending">Найдено: {visibleRows.length}</div>
        </div>
        {error ? (
          <div className="dv2-cash-state dv2-cash-error">
            <div className="dv2-cash-state-icon"><WifiOff size={22} /></div>
            <div className="dv2-empty-title">Не удалось загрузить данные кассового расчёта</div>
            <div className="dv2-empty-sub">Проверьте подключение к серверу<br />или повторите попытку позже.</div>
            <button className="dv2-btn dv2-btn-ghost" onClick={onRetry}>Повторить</button>
          </div>
        ) : loading ? (
          <div className="dv2-cash-state">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="loading-skeleton" style={{ height: 48 }} />)}
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="dv2-cash-state">
            <EmptyState title="Нет данных за выбранный период" sub="Измените период или выберите всех курьеров" />
          </div>
        ) : (
          <>
        <table className="dv2-cash-table">
          <thead>
            <tr>
              <th>Курьер</th>
              <th>Активный</th>
              <th>Доставлено</th>
              <th>Неудача</th>
              <th>Успех</th>
              <th>Ср. время</th>
              <th>Долг</th>
              <th>Заработок</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const courier = courierMap[row.courier_id] ?? { courier_id: row.courier_id, full_name: row.courier_name, is_active: true }
              return (
              <tr key={row.courier_id}>
                <td><CourierCell row={row} /></td>
                <td>{fmt(row.active_orders ?? 0)}</td>
                <td><span className="dv2-cash-num green">{fmt(row.delivered ?? 0)}</span></td>
                <td><span className="dv2-cash-num red">{fmt(row.failed ?? 0)}</span></td>
                <td>{formatPercent(row.success_rate)}</td>
                <td>{formatDuration(row.avg_delivery_seconds)}</td>
                <td><span className="dv2-cash-num red">{fmt(row.cash_debt ?? 0)} сом</span></td>
                <td><span className="dv2-cash-num purple">{fmt(row.earnings ?? 0)} сом</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      title="Изменить"
                      onClick={() => setEditTarget(courier)}
                      style={{ background: 'rgba(139,92,246,0.12)', border: 'none', borderRadius: 7, color: '#8b5cf6', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                    ><Pencil size={14} /></button>
                    <button
                      title="Тарифы"
                      onClick={() => setTariffsTarget(courier)}
                      style={{ background: 'rgba(16,185,129,0.12)', border: 'none', borderRadius: 7, color: '#10b981', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                    ><DollarSign size={14} /></button>
                    <button
                      title={courier.is_active ? 'Выключить' : 'Включить'}
                      onClick={() => setToggleTarget(courier)}
                      style={{ background: courier.is_active ? 'rgba(239,68,68,0.10)' : 'rgba(16,185,129,0.10)', border: 'none', borderRadius: 7, color: courier.is_active ? '#ef4444' : '#10b981', cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center' }}
                    ><Power size={14} /></button>
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        <div className="dv2-cash-cards">
          {visibleRows.map((row) => <CashCourierCard key={row.courier_id} row={row} />)}
        </div>
          </>
        )}
      </div>
    </section>

    {editTarget && (
      <EditCourierModal
        courier={editTarget}
        onClose={() => setEditTarget(null)}
        onSuccess={() => { setEditTarget(null); onCourierUpdated?.() }}
      />
    )}
    {tariffsTarget && (
      <TariffsModal
        courier={tariffsTarget}
        onClose={() => setTariffsTarget(null)}
      />
    )}
    {toggleTarget && (
      <ToggleActiveModal
        courier={toggleTarget}
        onClose={() => setToggleTarget(null)}
        onSuccess={() => { setToggleTarget(null); onCourierUpdated?.() }}
      />
    )}
  </>
  )
}

function hasCashSettlementActivity(row) {
  return Number(row.delivered ?? 0) > 0 ||
    Number(row.failed ?? 0) > 0 ||
    Number(row.cash_debt ?? 0) > 0 ||
    Number(row.earnings ?? 0) > 0
}

function CashTransactionsView({
  rows, pageMeta, couriers, range, courierId, status, loading, error, confirming, rejecting,
  onRange, onCourier, onStatus, onPage, onRetry, onConfirm, onReject, onPreview,
}) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const [localSearch, setLocalSearch] = useState('')

  const filteredRows = useMemo(() => {
    const q = localSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const courier = (r.courier_name ?? r.courier?.full_name ?? '').toLowerCase()
      const note = (r.admin_note ?? r.reason ?? r.note ?? '').toLowerCase()
      const amount = String(r.amount ?? '')
      return courier.includes(q) || note.includes(q) || amount.includes(q)
    })
  }, [rows, localSearch])

  useEffect(() => {
    if (!error) return
    console.error('Cash transactions load failed:', error)
  }, [error])

  return (
    <section className="dv2-cash-view">
      <div className="dv2-cash-compact-bar dv2-cashregister-bar">
        <label className="dv2-search-field dv2-history-search">
          <Search size={15} />
          <input
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Транзакция, курьер, примечание…"
            aria-label="Поиск"
          />
        </label>
        <div className="dv2-history-filters">
          <CashRangePicker range={range} open={rangeOpen} onOpen={setRangeOpen} onRange={onRange} />
          <select className="dv2-cash-select" value={courierId} onChange={(e) => onCourier(e.target.value)} aria-label="Курьер">
            <option value="">Все курьеры</option>
            {couriers.map((courier) => {
              const id = courier.courier_id ?? courier.id
              return <option key={id} value={id}>{courier.full_name ?? courier.courier_name ?? 'Курьер'}</option>
            })}
          </select>
          <select className="dv2-cash-select" value={status} onChange={(e) => onStatus(e.target.value)} aria-label="Статус">
            <option value="">Все статусы</option>
            <option value="pending">🟡 Ожидает</option>
            <option value="confirmed">🟢 Принят</option>
            <option value="rejected">🔴 Отклонён</option>
          </select>
        </div>
      </div>

      <DataPanel
        title="Транзакции"
        count={pageMeta.total ?? rows.length}
        rowCount={filteredRows.length}
        loading={loading}
        error={error}
        emptyTitle="Нет данных за выбранный период"
        onRetry={onRetry}
      >
        <table className="dv2-cash-table dv2-data-table">
          <thead>
            <tr>
              <th>Курьер</th>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Статус</th>
              <th>Примечание</th>
              <th>Фото</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <CashTransactionRow
                key={row.id}
                row={row}
                busy={confirming || rejecting}
                onConfirm={onConfirm}
                onReject={onReject}
                onPreview={onPreview}
              />
            ))}
          </tbody>
        </table>
        <div className="dv2-cash-cards">
          {filteredRows.map((row) => (
            <CashTransactionCard
              key={row.id}
              row={row}
              busy={confirming || rejecting}
              onConfirm={onConfirm}
              onReject={onReject}
              onPreview={onPreview}
            />
          ))}
        </div>
        <Pagination meta={pageMeta} onPage={onPage} />
      </DataPanel>
    </section>
  )
}

function CashTransactionRow({ row, busy, onConfirm, onReject, onPreview }) {
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')
  const isPending = row.status === 'pending'
  const note = transactionNote(row)

  function submitReject() {
    const trimmed = reason.trim()
    if (!trimmed) return
    onReject(row.id, trimmed)
    setReason('')
    setReasonOpen(false)
  }

  return (
    <tr>
      <td><TransactionCourier row={row} /></td>
      <td>{formatFullDate(row.created_at)}</td>
      <td><span className="dv2-cash-num green">{formatMoney(row.amount)}</span></td>
      <td><StatusBadge status={row.status} /></td>
      <td className="dv2-note-cell">{note || '—'}</td>
      <td><PhotoButton url={row.photo_url} onPreview={onPreview} /></td>
      <td>
        {isPending ? (
          <div className="dv2-action-stack">
            <div className="dv2-btn-row">
              <button className="dv2-btn dv2-btn-success" disabled={busy} onClick={() => onConfirm(row.id)}>Confirm</button>
              <button className="dv2-btn dv2-btn-danger" disabled={busy} onClick={() => setReasonOpen((open) => !open)}>Reject</button>
            </div>
            {reasonOpen && (
              <div className="dv2-reject-box">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отказа" />
                <button className="dv2-btn dv2-btn-danger" disabled={!reason.trim() || busy} onClick={submitReject}>OK</button>
              </div>
            )}
          </div>
        ) : '—'}
      </td>
    </tr>
  )
}

function CashTransactionCard({ row, busy, onConfirm, onReject, onPreview }) {
  const [reason, setReason] = useState('')
  const isPending = row.status === 'pending'
  return (
    <div className="dv2-cash-card">
      <div className="dv2-card-headline">
        <TransactionCourier row={row} />
        <StatusBadge status={row.status} />
      </div>
      <div className="dv2-cash-card-grid">
        <Info label="Дата" value={formatFullDate(row.created_at)} />
        <Info label="Сумма" value={formatMoney(row.amount)} />
        <Info full label="Примечание" value={transactionNote(row) || '—'} />
        <Info label="Фото" value={<PhotoButton url={row.photo_url} onPreview={onPreview} />} />
      </div>
      {isPending && (
        <div className="dv2-card-actions">
          <button className="dv2-btn dv2-btn-success" disabled={busy} onClick={() => onConfirm(row.id)}>Confirm</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина отказа" />
          <button className="dv2-btn dv2-btn-danger" disabled={!reason.trim() || busy} onClick={() => { onReject(row.id, reason.trim()); setReason('') }}>Reject</button>
        </div>
      )}
    </div>
  )
}

function OrderHistoryView({ rows, pageMeta, couriers, range, filters, loading, error, onRange, onFilters, onPage, onRetry }) {
  const [rangeOpen, setRangeOpen] = useState(false)

  useEffect(() => {
    if (!error) return
    console.error('Dispatch order history load failed:', error)
  }, [error])

  return (
    <section className="dv2-cash-view dv2-history-view">
      <div className="dv2-history-toolbar">
        <label className="dv2-search-field dv2-history-search">
          <Search size={15} />
          <input value={filters.search} onChange={(e) => onFilters({ search: e.target.value })} placeholder="Поиск по ID, клиенту, телефону, адресу…" aria-label="Поиск заказов" />
        </label>

        <div className="dv2-history-filters">
          <CashRangePicker range={range} open={rangeOpen} onOpen={setRangeOpen} onRange={onRange} />
          <select className="dv2-cash-select" value={filters.status} onChange={(e) => onFilters({ status: e.target.value })} aria-label="Статус">
            <option value="">Все статусы</option>
            {ORDER_STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <select className="dv2-cash-select" value={filters.courier} onChange={(e) => onFilters({ courier: e.target.value })} aria-label="Курьер">
            <option value="">Все курьеры</option>
            {couriers.map((courier) => {
              const id = courier.courier_id ?? courier.id
              return <option key={id} value={id}>{courier.full_name ?? courier.courier_name ?? 'Курьер'}</option>
            })}
          </select>
          <label className="dv2-search-field"><Search size={14} /><input value={filters.seller} onChange={(e) => onFilters({ seller: e.target.value })} placeholder="Seller" aria-label="Seller" /></label>
          <label className="dv2-search-field"><Search size={14} /><input value={filters.product} onChange={(e) => onFilters({ product: e.target.value })} placeholder="Товар" aria-label="Товар" /></label>
        </div>
      </div>

      <DataPanel
        title="Заказы"
        count={pageMeta.total ?? rows.length}
        deliveredCount={pageMeta.delivered_count}
        totalIncome={pageMeta.total_income}
        rowCount={rows.length}
        loading={loading}
        error={error}
        emptyTitle="Нет данных за выбранный период"
        onRetry={onRetry}
      >
        <table className="dv2-cash-table dv2-data-table dv2-history-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Дата</th>
              <th>Статус</th>
              <th>Товар</th>
              <th>Курьер</th>
              <th>Seller</th>
              <th>Сумма</th>
              <th>Тариф</th>
              <th>Доставлен</th>
              <th>Ср. время</th>
              <th>Причина отмены</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <OrderHistoryRowView key={row.id} row={row} />)}
          </tbody>
        </table>
        <div className="dv2-cash-cards">
          {rows.map((row) => <OrderHistoryCard key={row.id} row={row} />)}
        </div>
        <Pagination meta={pageMeta} onPage={onPage} />
      </DataPanel>
    </section>
  )
}

function OrderHistoryRowView({ row }) {
  return (
    <tr>
      <td><span className="dv2-cash-num">#{row.order_number || row.id}</span></td>
      <td>{formatFullDate(row.created_at)}</td>
      <td><OrderStatusBadge status={row.status} /></td>
      <td><ProductLines products={row.products} /></td>
      <td>{row.courier_name || '—'}</td>
      <td>{row.seller_name || '—'}</td>
      <td><span className="dv2-cash-num">{formatMoney(row.total_amount)}</span></td>
      <td><span className="dv2-cash-num purple">{formatMoney(row.delivery_fee)}</span></td>
      <td>{formatFullDate(row.delivered_at)}</td>
      <td>{formatDuration(row.process_seconds)}</td>
      <td className="dv2-note-cell">{['cancelled', 'returned'].includes(row.status) ? (row.cancellation_reason || '—') : '—'}</td>
    </tr>
  )
}

function OrderHistoryCard({ row }) {
  return (
    <div className="dv2-cash-card">
      <div className="dv2-card-headline">
        <span className="dv2-cash-num">#{row.order_number || row.id}</span>
        <OrderStatusBadge status={row.status} />
      </div>
      <div className="dv2-cash-card-grid">
        <Info label="Дата" value={formatFullDate(row.created_at)} />
        <Info label="Сумма" value={formatMoney(row.total_amount)} />
        <Info label="Курьер" value={row.courier_name || '—'} />
        <Info label="Seller" value={row.seller_name || '—'} />
        <Info label="Тариф" value={formatMoney(row.delivery_fee)} />
        <Info label="Доставлен" value={formatFullDate(row.delivered_at)} />
        <Info label="Ср. время" value={formatDuration(row.process_seconds)} />
        <Info full label="Товар" value={<ProductLines products={row.products} />} />
        <Info full label="Причина отмены" value={['cancelled', 'returned'].includes(row.status) ? (row.cancellation_reason || '—') : '—'} />
      </div>
    </div>
  )
}

function DataPanel({ title, count, deliveredCount, totalIncome, rowCount, loading, error, emptyTitle, onRetry, children }) {
  return (
    <div className="dv2-cash-table-wrap">
      <div className="dv2-cash-head">
        <div className="dv2-cash-title small">{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="dv2-cash-status pending">Найдено: {fmt(count ?? 0)}</div>
          {deliveredCount != null && (
            <div className="dv2-cash-status settled">Доставлено: {fmt(deliveredCount)}</div>
          )}
          {totalIncome != null && totalIncome > 0 && (
            <div className="dv2-cash-status settled">Сумма: {formatMoney(totalIncome)}</div>
          )}
        </div>
      </div>
      {error ? (
        <div className="dv2-cash-state dv2-cash-error">
          <div className="dv2-cash-state-icon"><WifiOff size={22} /></div>
          <div className="dv2-empty-title">Не удалось загрузить данные</div>
          <div className="dv2-empty-sub">Проверьте подключение к серверу<br />или повторите попытку позже.</div>
          <button className="dv2-btn dv2-btn-ghost" onClick={onRetry}>Повторить</button>
        </div>
      ) : loading ? (
        <div className="dv2-cash-state">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="loading-skeleton" style={{ height: 48 }} />)}
        </div>
      ) : rowCount === 0 ? (
        <div className="dv2-cash-state">
          <EmptyState title={emptyTitle} sub="Измените фильтры или период" />
        </div>
      ) : children}
    </div>
  )
}

const ORDER_STATUS_OPTIONS = [
  { value: 'new', label: 'Новый' },
  { value: 'confirmed', label: 'Подтверждён' },
  { value: 'prepayment_pending', label: 'Ожидает предоплату' },
  { value: 'prepayment_received', label: 'Предоплата получена' },
  { value: 'assigned', label: 'Назначен' },
  { value: 'in_delivery', label: 'В доставке' },
  { value: 'delivered', label: 'Доставлен' },
  { value: 'returned', label: 'Возврат' },
  { value: 'cancelled', label: 'Отменён' },
  { value: 'issue', label: 'Проблема' },
]

function TransactionCourier({ row }) {
  return (
    <div className="dv2-cash-courier">
      <div className="dv2-courier-avatar" style={{ background: avatarColor(row.courier_name) }}>{initials(row.courier_name)}</div>
      <div>
        <div className="dv2-cash-courier-name">{row.courier_name || 'Курьер'}</div>
        <div className="dv2-cash-courier-phone">{row.courier_phone || '—'}</div>
      </div>
    </div>
  )
}

const STATUS_META = {
  confirmed: { dot: '🟢', label: 'Принят',   tone: 'settled'  },
  pending:   { dot: '🟡', label: 'Ожидает',  tone: 'pending'  },
  rejected:  { dot: '🔴', label: 'Отклонён', tone: 'mismatch' },
}
function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.pending
  return <span className={`dv2-cash-status ${m.tone}`}>{m.dot} {m.label}</span>
}

function OrderStatusBadge({ status }) {
  const label = ORDER_STATUS_OPTIONS.find((opt) => opt.value === status)?.label ?? status ?? '—'
  const tone = status === 'delivered' ? 'settled' : ['cancelled', 'returned', 'issue'].includes(status) ? 'mismatch' : 'pending'
  return <span className={`dv2-cash-status ${tone}`}>{label}</span>
}

function PhotoButton({ url, onPreview }) {
  if (!url) return <span className="dv2-muted">—</span>
  return (
    <button className="dv2-photo-thumb dv2-photo-lg" onClick={() => onPreview(url)} title="Нажмите для полноэкранного просмотра">
      <ImageIcon size={16} className="dv2-photo-icon" />
      <img src={url} alt="" />
    </button>
  )
}

function ProductLines({ products = [] }) {
  if (!products.length) return '—'
  return (
    <div className="dv2-product-lines">
      {products.map((product) => (
        <div key={`${product.product_id}-${product.name}`}>{product.name || 'Товар'} ×{product.quantity ?? 0}</div>
      ))}
    </div>
  )
}

function Pagination({ meta: pageMeta, onPage }) {
  const page = Number(pageMeta.page ?? 1)
  const totalPages = Number(pageMeta.total_pages ?? 1)
  if (totalPages <= 1) return null
  return (
    <div className="dv2-pagination">
      <button className="dv2-btn dv2-btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Назад</button>
      <span>{page} / {totalPages}</span>
      <button className="dv2-btn dv2-btn-ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Вперёд</button>
    </div>
  )
}

function PhotoPreviewModal({ url, onClose }) {
  if (!url) return null
  return (
    <div className="dv2-lightbox" onClick={onClose}>
      <button className="dv2-lightbox-close" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      <img src={url} alt="Фото транзакции" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}

function transactionNote(row) {
  const parts = []
  if (row.note) parts.push(row.note)
  if (row.status === 'rejected' && row.rejection_reason && row.rejection_reason !== row.note) {
    parts.push(`Причина: ${row.rejection_reason}`)
  }
  return parts.join(' · ')
}

function CashRangePicker({ range, open, onOpen, onRange }) {
  const activeLabel = cashRangeLabel(range)
  const fromRef = useRef(null)
  const toRef = useRef(null)

  function applyPreset(value) {
    onRange(cashPresetRange(value, range))
    if (value !== 'custom') onOpen(false)
  }

  function applyCustomRange() {
    const from = fromRef.current?.value ?? ''
    const to = toRef.current?.value ?? ''
    if (!from || !to) return
    onRange({ preset: 'custom', from, to })
    onOpen(false)
  }

  return (
    <div className="dv2-cash-range">
      <button className="dv2-cash-range-btn" onClick={() => onOpen(!open)} aria-expanded={open}>
        <CalendarDays size={15} />
        <span>{activeLabel}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="dv2-cash-range-popover">
          <div className="dv2-cash-presets">
            {CASH_PRESETS.map((preset) => (
              <button
                key={preset.value}
                className={`dv2-cash-preset ${range.preset === preset.value ? 'active' : ''}`}
                onClick={() => applyPreset(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="dv2-cash-custom">
            <label>
              <span>С</span>
              <input
                ref={fromRef}
                type="date"
                defaultValue={range.from}
                aria-label="Дата с"
              />
            </label>
            <label>
              <span>По</span>
              <input
                ref={toRef}
                type="date"
                defaultValue={range.to}
                aria-label="Дата по"
              />
            </label>
            <button className="dv2-cash-apply" onClick={applyCustomRange}>
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CashMetric({ label, value, tone }) {
  return (
    <div className={`dv2-cash-metric ${tone}`}>
      <div className="dv2-cash-metric-label">{label}</div>
      <div className="dv2-cash-metric-value">{value}</div>
    </div>
  )
}

function CourierCell({ row }) {
  return (
    <div className="dv2-cash-courier">
      <div className="dv2-courier-avatar" style={{ background: avatarColor(row.courier_name) }}>{initials(row.courier_name)}</div>
      <div>
        <div className="dv2-cash-courier-name">{row.courier_name || 'Курьер'}</div>
        <div className="dv2-cash-courier-phone">{row.courier_phone || '—'}</div>
      </div>
      <span className={`dv2-cash-online ${row.is_online ? 'online' : 'offline'}`}>{row.is_online ? 'online' : 'offline'}</span>
    </div>
  )
}

function CashCourierCard({ row }) {
  return (
    <div className="dv2-cash-card">
      <CourierCell row={row} />
      <div className="dv2-cash-card-grid">
        <Info label="Активный" value={fmt(row.active_orders ?? 0)} />
        <Info label="Доставлено" value={fmt(row.delivered ?? 0)} />
        <Info label="Неудача" value={fmt(row.failed ?? 0)} />
        <Info label="Успех" value={formatPercent(row.success_rate)} />
        <Info label="Ср. время" value={formatDuration(row.avg_delivery_seconds)} />
        <Info label="Долг" value={`${fmt(row.cash_debt ?? 0)} сом`} />
        <Info full label="Заработок" value={`${fmt(row.earnings ?? 0)} сом`} />
      </div>
    </div>
  )
}

function BottomNav({ tab, counts, onTab }) {
  return (
    <nav className="dv2-bottom-nav">
      <button className={`dv2-bn-item ${tab === 'dispatch' ? 'active' : ''}`} onClick={() => onTab('dispatch')}><span className="dv2-bn-icon"><ClipboardList size={20} /></span><span className="dv2-bn-label">Доска</span></button>
      <button className={`dv2-bn-item ${tab === 'cash' ? 'active' : ''}`} onClick={() => onTab('cash')}><span className="dv2-bn-icon"><Wallet size={20} /></span><span className="dv2-bn-label">Расчёт</span></button>
      <button className={`dv2-bn-item ${tab === 'cashRegister' ? 'active' : ''}`} onClick={() => onTab('cashRegister')}><span className="dv2-bn-icon"><Banknote size={20} /></span><span className="dv2-bn-label">Касса</span></button>
      <button className={`dv2-bn-item ${tab === 'history' ? 'active' : ''}`} onClick={() => onTab('history')}><span className="dv2-bn-icon"><ClipboardList size={20} /></span><span className="dv2-bn-label">История</span></button>
    </nav>
  )
}

function EmptyState({ title = 'Пусто', sub = 'Нет заказов в этой колонке' }) {
  return <div className="dv2-empty"><div className="dv2-empty-icon">□</div><div className="dv2-empty-title">{title}</div><div className="dv2-empty-sub">{sub}</div></div>
}

function primaryActions(status) {
  if (status === 'new') return [{ key: 'confirm', label: 'Подтвердить', className: 'dv2-btn-primary' }]
  if (status === 'confirmed') return [{ key: 'assign', label: 'Назначить курьера', className: 'dv2-btn-primary' }]
  if (status === 'assigned') return [{ key: 'reassign', label: 'Переназначить', className: 'dv2-btn-ghost' }]
  if (status === 'issue') return [{ key: 'resolve', label: 'Решить проблему', className: 'dv2-btn-success' }]
  return [{ key: 'issue', label: 'Отметить проблему', className: 'dv2-btn-danger' }]
}

function dateOptions() {
  return [
    { value: 'all', label: 'Все' },
    { value: 'today', label: 'Сегодня' },
    { value: 'tomorrow', label: 'Завтра' },
    { value: 'overdue', label: 'Просрочено' },
  ]
}

function buildCashParams(range, courierId) {
  const params = {}
  if (courierId) params.courier_id = courierId
  if (range.from) params.from = `${range.from}T00:00:00.000Z`
  if (range.to) params.to = `${range.to}T23:59:59.999Z`
  return params
}

function cashRangeLabel(range) {
  if (range.preset !== 'custom') {
    return CASH_PRESETS.find((preset) => preset.value === range.preset)?.label ?? 'Все время'
  }
  if (range.from && range.to) {
    return `${formatShortDate(range.from)} — ${formatShortDate(range.to)}`
  }
  return 'Custom range'
}

function formatShortDate(value) {
  const [year, month, day] = value.split('-')
  if (!year || !month || !day) return value
  return `${day}.${month}.${year}`
}

function formatFullDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value) {
  return `${fmt(value ?? 0)} сом`
}

function cashPresetRange(preset, current) {
  if (preset === 'custom') return { ...current, preset: 'custom' }
  if (preset === 'all') return { preset: 'all', from: '', to: '' }

  const now = new Date()
  const today = localDateOnly(now)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)

  if (preset === 'today') return { preset, from: today, to: today }
  if (preset === 'yesterday') {
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    return { preset, from: localDateOnly(y), to: localDateOnly(y) }
  }
  if (preset === 'last7') return rollingRange(preset, 7)
  if (preset === 'last14') return rollingRange(preset, 14)
  if (preset === 'last30') return rollingRange(preset, 30)
  if (preset === 'month') return { preset, from: localDateOnly(startOfMonth), to: today }
  if (preset === 'prevMonth') return { preset, from: localDateOnly(prevMonthStart), to: localDateOnly(prevMonthEnd) }
  return { preset: 'all', from: '', to: '' }
}

function rollingRange(preset, days) {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)
  return { preset, from: localDateOnly(start), to: localDateOnly(now) }
}

function localDateOnly(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Math.round(Number(value))}%`
}

function formatDuration(seconds) {
  if (seconds == null || Number(seconds) <= 0) return '—'
  const minutes = Math.round(Number(seconds) / 60)
  if (minutes < 60) return `${minutes} мин`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`
}

function requiredOrderId(order) {
  const id = getOrderId(order)
  if (!id) throw new Error('ID заказа не найден')
  return id
}

function initials(name = '') {
  return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'
}

function avatarColor(name = '') {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#a78bfa', '#ef4444']
  const index = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length
  return colors[index]
}
