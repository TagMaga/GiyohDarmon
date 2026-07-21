/**
 * TeamLeadFinancePage — /team-lead/finance ("Финансы")
 *
 * Two sub-tabs (Teamlead Panel Redesign): "Обзор" is the original hero-card +
 * "Кому выплатить" checklist + bulk payout flow (unchanged logic, restyled
 * with mobileUi's M tokens to match the rest of the redesign); "По продавцам"
 * is new — a period-filtered, revenue-sorted seller list with a commission%
 * derived client-side as earned/gross (no explicit rate field on a payables
 * member), each row linking to TeamLeadSellerFinanceDetailPage.
 */
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, History, ChevronDown } from 'lucide-react'
import Modal            from '../../../shared/components/Modal'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { useToast }     from '../../../shared/components/ToastProvider'
import { fmtAmount }    from '../../../shared/orderStatusConfig'
import useCurrentUser   from '../../../shared/hooks/useCurrentUser'
import useMyPayouts     from '../../../shared/hooks/useMyPayouts'
import { generateUUID } from '../../../shared/utils/uuid'
import usePayables       from '../hooks/usePayables'
import useCreatePayouts  from '../hooks/useCreatePayouts'
import { M, Card, InitialsAvatar, Chip } from '../../seller/components/mobileUi'
import Alert from '../../../shared/components/Alert'

// Local Y/M/D, not toISOString() — that converts to UTC first and can shift
// the calendar date by a day depending on timezone/time-of-day.
function toYMD(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
function fmtRu(n) { return Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) }

const ROLE_LABEL = { manager: 'Менеджер', seller: 'Продавец' }
const METHODS = [
  { id: 'cash',          label: 'Наличные' },
  { id: 'bank_transfer', label: 'Перевод' },
  { id: 'card',          label: 'Карта' },
]
const PERIODS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'week',  label: 'Неделя' },
  { id: 'month', label: 'Месяц' },
]

function TabSwitcher({ tab, setTab }) {
  return (
    <div className="flex gap-1" style={{ background: '#EAE8E1', borderRadius: 13, padding: 4 }}>
      {[{ id: 'overview', label: 'Обзор' }, { id: 'byseller', label: 'По продавцам' }].map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTab(t.id)}
          className="flex-1 text-center transition-colors"
          style={tab === t.id
            ? { fontSize: 13, fontWeight: 700, color: M.ink, background: '#fff', padding: '9px', borderRadius: 10, boxShadow: '0 1px 3px rgba(20,20,20,.08)' }
            : { fontSize: 13, fontWeight: 600, color: M.sub, padding: '9px' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function OverviewTab() {
  const toast = useToast()
  const { userId } = useCurrentUser()

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)

  const { data: payables, isLoading, isError, error, refetch } = usePayables(userId, { from, to })
  const { data: payoutHistory = [], isLoading: historyLoading } = useMyPayouts()
  const members = payables?.members ?? []

  const [selected, setSelected] = useState(() => new Set())
  const [amounts, setAmounts]   = useState({})
  const [method, setMethod]     = useState('cash')
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Stable across retries of the *same* submission attempt (network error,
  // impatient re-click) so the server recognizes a resend and replays the
  // original result instead of creating a second batch of payouts. Only
  // rotates once a submission actually succeeds.
  const [idempotencyKey, setIdempotencyKey] = useState(() => generateUUID())

  // Seed amount inputs with "remaining" whenever fresh payables data arrives.
  useEffect(() => {
    setAmounts(prev => {
      const next = { ...prev }
      members.forEach(m => {
        if (next[m.payee_id] === undefined) next[m.payee_id] = String(m.remaining)
      })
      return next
    })
  }, [members])

  const createPayouts = useCreatePayouts(userId)

  function toggle(payeeId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(payeeId)) next.delete(payeeId)
      else next.add(payeeId)
      return next
    })
  }

  const selectedMembers = members.filter(m => selected.has(m.payee_id))
  const total = selectedMembers.reduce((s, m) => s + (parseFloat(amounts[m.payee_id]) || 0), 0)

  // Client-side mirror of the server's amount ceiling — catches the mistake
  // before a round-trip, but the server (validatePayoutItems) is the real
  // guard since this check alone is trivially bypassable.
  function isAmountInvalid(m) {
    const amt = parseFloat(amounts[m.payee_id]) || 0
    return amt <= 0 || amt > m.remaining + 0.01
  }
  const hasInvalidSelected = selectedMembers.some(isAmountInvalid)

  async function handleConfirm() {
    try {
      await createPayouts.mutateAsync({
        items: selectedMembers.map(m => ({
          payee_id: m.payee_id,
          amount: parseFloat(amounts[m.payee_id]) || 0,
        })),
        period_start: from,
        period_end: to,
        method,
        note: '',
        idempotency_key: idempotencyKey,
      })
      setConfirmOpen(false)
      setSelected(new Set())
      setIdempotencyKey(generateUUID()) // fresh key for the next, unrelated submission
      toast.success('Выплата проведена · появится в Финансах владельца')
    } catch (err) {
      toast.error(err?.response?.data?.error?.message ?? 'Не удалось провести выплату')
    }
  }

  return (
    <div className="space-y-4 pb-24">
      {isError && (
        <div className="flex items-center justify-between gap-2">
          <Alert variant="error" title="Не удалось загрузить доходы команды">
            {error?.response?.data?.error?.message ?? error?.message ?? 'Проверьте соединение и попробуйте снова.'}
          </Alert>
          <button
            type="button"
            onClick={() => refetch()}
            className="min-h-10 px-4 rounded-xl border border-slate-200 bg-white text-slate-700 text-[13px] font-bold flex-shrink-0"
          >
            Повторить
          </button>
        </div>
      )}
      {isLoading ? (
        <CardSkeleton />
      ) : isError ? null : (
        <Card style={{ borderRadius: 20, padding: 18 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            Ваш личный доход за период
          </div>
          <div style={{ fontSize: 33, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', lineHeight: 1, margin: '10px 0' }}>
            {fmtRu(payables?.personal_net)} <span style={{ fontSize: 17, fontWeight: 700, color: M.faint }}>с</span>
          </div>
          <p style={{ fontSize: 11.5, color: M.sub, fontWeight: 500 }}>
            Ваша доля пула команды (40%) — уже за вычетом продавцов и менеджеров
          </p>
          {/* Real subtraction: this one, unlike personal income above, actually
              is A − B = C — team_lead_pool_earned is already net, so it has no
              further subtraction of its own. */}
          <div className="flex justify-center items-center gap-2 flex-wrap" style={{ background: '#F5F4FE', borderRadius: 12, padding: '11px 12px', marginTop: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: M.ink }}>{fmtRu(payables?.team_earned)}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: M.muted }}>−</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: M.amber }}>{fmtRu(payables?.team_paid)}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: M.muted }}>=</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: M.indigoDeep }}>{fmtRu(payables?.team_remaining)}</span>
          </div>
          <p style={{ fontSize: 11, color: M.muted, fontWeight: 500, marginTop: 8, textAlign: 'center' }}>
            Доход команды − Уже выплачено = Осталось выплатить
          </p>
        </Card>
      )}

      <div className="flex items-center justify-between px-1">
        <h2 style={{ fontSize: 11.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase' }}>Кому выплатить</h2>
        <span style={{ fontSize: 12, color: M.sub, fontWeight: 600 }}>
          Выбрано: <b style={{ color: M.indigoDeep }}>{selected.size}</b> из {members.length}
        </span>
      </div>

      {/* Desktop: inline selection bar (fixed positioning would float over the sidebar) */}
      {selected.size > 0 && (
        <div
          className="hidden lg:flex items-center gap-3"
          style={{ background: '#fff', borderRadius: 16, boxShadow: '0 4px 16px rgba(20,20,20,.06)', border: `1px solid ${M.border}`, padding: 14 }}
        >
          <div className="flex-1">
            <p style={{ fontSize: 10, fontWeight: 700, color: M.muted, textTransform: 'uppercase' }}>Выбрано: {selected.size}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: M.ink }}>Итого: {fmtRu(total)} с</p>
          </div>
          <button
            className="rounded-xl px-5 py-3 text-white font-black text-sm disabled:opacity-40"
            style={{ background: M.dark }}
            disabled={hasInvalidSelected}
            onClick={() => setConfirmOpen(true)}
          >
            Выплатить
          </button>
        </div>
      )}

      <Card style={{ overflow: 'hidden' }}>
        {members.length === 0 && !isLoading && (
          <div className="p-8 text-center text-sm" style={{ color: M.muted }}>Нет данных о доходах команды за период</div>
        )}
        {members.map((m, i) => {
          const isFullyPaid = m.remaining <= 0
          const isChecked = selected.has(m.payee_id)
          return (
            <div
              key={m.payee_id}
              className={`p-4 flex gap-3 ${isFullyPaid ? 'opacity-50' : ''}`}
              style={{ borderBottom: i < members.length - 1 ? `1px solid ${M.bg}` : 'none' }}
            >
              <button
                type="button"
                disabled={isFullyPaid}
                onClick={() => toggle(m.payee_id)}
                className="w-[22px] h-[22px] rounded-lg border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                style={isChecked
                  ? { background: M.dark, borderColor: M.dark }
                  : { borderColor: '#D6D4CC', background: '#fff' }}
              >
                {isChecked && <Check size={13} className="text-white" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <InitialsAvatar name={m.full_name} size={36} radius={11} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }} className="truncate">{m.full_name}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#76766E', background: '#F0EFEA', padding: '2px 7px', borderRadius: 6, flexShrink: 0 }}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </div>
                <p style={{ fontSize: 11, color: M.muted, marginBottom: 8 }}>
                  {m.orders_count} {m.orders_count === 1 ? 'заказ' : 'заказов'} · сумма {fmtAmount(m.gross_amount)} с
                </p>
                <div className="flex gap-3.5 flex-wrap" style={{ fontSize: 11, marginBottom: 8 }}>
                  <div style={{ color: M.muted, fontWeight: 700 }}>Заработано<b style={{ display: 'block', color: M.ink, fontSize: 12, marginTop: 2 }}>{fmtAmount(m.earned)} с</b></div>
                  <div style={{ color: M.muted, fontWeight: 700 }}>Выплачено<b style={{ display: 'block', color: M.ink, fontSize: 12, marginTop: 2 }}>{fmtAmount(m.already_paid)} с</b></div>
                  <div style={{ color: M.muted, fontWeight: 700 }}>Осталось<b style={{ display: 'block', fontSize: 12, marginTop: 2, color: isFullyPaid ? M.green : M.indigoDeep }}>{fmtAmount(m.remaining)} с</b></div>
                </div>
                {isFullyPaid ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: M.green, background: M.greenBg, padding: '4px 8px', borderRadius: 7 }}>Выплачено полностью</span>
                ) : (
                  <>
                    <input
                      className="w-full text-right border-2 rounded-xl px-2.5 py-2 text-base font-black"
                      style={isChecked && isAmountInvalid(m)
                        ? { borderColor: '#FCA5A5', background: '#FEF2F2', color: '#DC2626' }
                        : { borderColor: '#E2E8F0', background: '#F8FAFF', color: M.indigoDeep }}
                      inputMode="numeric"
                      disabled={!isChecked}
                      value={amounts[m.payee_id] ?? ''}
                      onChange={e => setAmounts(prev => ({ ...prev, [m.payee_id]: e.target.value }))}
                    />
                    {isChecked && isAmountInvalid(m) && (
                      <p className="text-[10px] font-bold text-right mt-1" style={{ color: '#DC2626' }}>
                        Не более {fmtAmount(m.remaining)} с
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </Card>

      {/* Mobile: fixed sticky bar above the bottom nav */}
      {selected.size > 0 && (
        <div
          className="fixed left-3 right-3 bottom-24 z-30 lg:hidden flex items-center gap-3"
          style={{ background: '#fff', borderRadius: 16, boxShadow: '0 12px 28px rgba(15,31,55,.16)', border: `1px solid ${M.border}`, padding: 14 }}
        >
          <div className="flex-1">
            <p style={{ fontSize: 10, fontWeight: 700, color: M.muted, textTransform: 'uppercase' }}>Выбрано: {selected.size}</p>
            <p style={{ fontSize: 16, fontWeight: 800, color: M.ink }}>Итого: {fmtRu(total)} с</p>
          </div>
          <button
            className="rounded-xl px-5 py-3 text-white font-black text-sm disabled:opacity-40"
            style={{ background: M.dark }}
            disabled={hasInvalidSelected}
            onClick={() => setConfirmOpen(true)}
          >
            Выплатить
          </button>
        </div>
      )}

      <Card style={{ padding: 16 }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: M.bg, color: M.sub }}>
            <History size={15} />
          </span>
          <div>
            <h2 style={{ fontSize: 13.5, fontWeight: 800, color: M.ink }}>История выплат</h2>
            <p style={{ fontSize: 11, color: M.muted }}>Выплаты, полученные вами · по правам доступа сервера</p>
          </div>
        </div>
        {historyLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: M.bg }} />)}</div>
        ) : payoutHistory.length === 0 ? (
          <p style={{ background: M.bg, borderRadius: 12, padding: '12px 16px', fontSize: 13, color: M.muted }}>Выплат ещё не было.</p>
        ) : (
          <div>
            {payoutHistory.slice(0, 6).map((p, i) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-3" style={{ borderBottom: i < 5 ? `1px solid ${M.bg}` : 'none' }}>
                <div className="min-w-0">
                  <p style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{p.method ?? 'выплата'} · {p.status ?? 'оплачено'}</p>
                  <p style={{ fontSize: 11, color: M.muted }} className="truncate">{p.period_start} → {p.period_end}</p>
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: M.ink }} className="whitespace-nowrap">{fmtAmount(p.amount)} с</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Подтвердите выплату"
        description="Запись попадёт в единый леджер выплат и автоматически появится расходом в Финансах владельца"
      >
        <div className="card divide-y divide-slate-50 mb-4">
          {selectedMembers.map(m => (
            <div key={m.payee_id} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold text-slate-700">{m.full_name} · {ROLE_LABEL[m.role] ?? m.role}</span>
              <span className="text-sm font-black text-slate-900">{fmtAmount(amounts[m.payee_id])} с</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] font-bold text-slate-400 uppercase mb-2">Способ выплаты</p>
        <div className="flex gap-2 mb-5">
          {METHODS.map(mth => (
            <button
              key={mth.id}
              onClick={() => setMethod(mth.id)}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-colors"
              style={method === mth.id
                ? { borderColor: '#4F46E5', background: '#EEF2FF', color: '#4F46E5' }
                : { borderColor: '#F1F5F9', background: '#fff', color: '#94A3B8' }}
            >
              {mth.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between py-3 border-t border-slate-100 mb-4">
          <span className="text-sm font-bold text-slate-500">Итого к выплате</span>
          <span className="text-lg font-black text-indigo-600">{fmtRu(total)} с</span>
        </div>
        <button
          className="w-full rounded-2xl py-3.5 text-white font-black text-sm disabled:opacity-50"
          style={{ background: '#111827' }}
          disabled={createPayouts.isPending || hasInvalidSelected}
          onClick={handleConfirm}
        >
          {createPayouts.isPending ? 'Отправляем…' : 'Подтвердить выплату'}
        </button>
      </Modal>
    </div>
  )
}

function periodRange(period) {
  const now = new Date()
  if (period === 'today') {
    const d = toYMD(now)
    return { from: d, to: d }
  }
  if (period === 'week') {
    const start = new Date(now)
    start.setDate(start.getDate() - 6)
    return { from: toYMD(start), to: toYMD(now) }
  }
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

function BySellerTab() {
  const { userId } = useCurrentUser()
  const navigate = useNavigate()
  const [period, setPeriod] = useState('month')
  const { from, to } = useMemo(() => periodRange(period), [period])

  const { data: payables, isLoading } = usePayables(userId, { from, to })
  const sellers = useMemo(() => {
    const list = (payables?.members ?? []).filter(m => m.role === 'seller')
    return [...list].sort((a, b) => (b.gross_amount ?? 0) - (a.gross_amount ?? 0))
  }, [payables])

  const maxRevenue = sellers[0]?.gross_amount || 1

  return (
    <div className="space-y-3 pb-8">
      <div className="flex gap-[7px]">
        {PERIODS.map(p => (
          <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</Chip>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span style={{ fontSize: 12, fontWeight: 700, color: M.muted, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          {sellers.length} продавцов
        </span>
        <span className="inline-flex items-center gap-[5px]" style={{ fontSize: 12.5, fontWeight: 600, color: M.indigo }}>
          По выручке <ChevronDown size={13} />
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
      ) : sellers.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: M.muted }}>Нет данных о продавцах за период</p>
        </Card>
      ) : (
        sellers.map((m, i) => {
          const commissionPct = m.gross_amount > 0 ? (m.earned / m.gross_amount) * 100 : 0
          return (
            <Card
              key={m.payee_id}
              style={{ padding: 15, cursor: 'pointer' }}
              onClick={() => navigate(`/team-lead/team/${m.payee_id}`)}
            >
              <div className="flex items-center gap-[11px]">
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 22, height: 22, borderRadius: 7, fontSize: 12, fontWeight: 800, background: i === 0 ? '#FEF3C7' : '#F0EFEA', color: i === 0 ? '#B45309' : '#76766E' }}
                >
                  {i + 1}
                </span>
                <InitialsAvatar name={m.full_name} size={38} palette={i} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: M.ink }} className="truncate">{m.full_name}</div>
                  <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{m.orders_count} заказ{m.orders_count === 1 ? '' : 'ов'}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: M.ink }}>{fmtRu(m.gross_amount)} с</div>
                  <div style={{ fontSize: 11, color: M.muted, fontWeight: 600, marginTop: 2 }}>комиссия {commissionPct.toFixed(1).replace('.', ',')}%</div>
                </div>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: M.border, marginTop: 12, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (m.gross_amount / maxRevenue) * 100)}%`, height: '100%', background: M.indigo, borderRadius: 3 }} />
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}

export default function TeamLeadFinancePage() {
  const [tab, setTab] = useState('overview')

  return (
    <div className="min-h-screen" style={{ background: M.bg, fontFamily: M.font }}>
      <div className="max-w-2xl mx-auto lg:max-w-none" style={{ padding: '14px 20px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: '4px 0 14px' }}>Финансы</h1>
        <TabSwitcher tab={tab} setTab={setTab} />
        <div style={{ marginTop: 14 }}>
          {tab === 'overview' ? <OverviewTab /> : <BySellerTab />}
        </div>
      </div>
    </div>
  )
}
