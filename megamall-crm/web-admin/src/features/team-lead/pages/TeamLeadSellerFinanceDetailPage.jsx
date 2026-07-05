/**
 * TeamLeadSellerFinanceDetailPage — /team-lead/team/:payeeId ("Продавец · Финансы")
 *
 * Full-page replacement for TeamLeadTeamPage's old MemberDetailSheet modal —
 * reachable both from the Team roster and from Finance → "По продавцам".
 * Reuses the exact same usePayables() member record both of those screens
 * already read (one source of truth for "how much is owed to X"), plus the
 * new GET /payouts/payee/:payeeId endpoint for payout history.
 *
 * No "city" field exists on a payables member — the mockup's city subtitle
 * is swapped for the role label, which is real data.
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronRight, Check } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { fmtAmount } from '../../../shared/orderStatusConfig'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import usePayables from '../hooks/usePayables'
import useCreatePayouts from '../hooks/useCreatePayouts'
import usePayeePayoutHistory from '../hooks/usePayeePayoutHistory'
import { M, MobileShell, Card, InitialsAvatar } from '../../seller/components/mobileUi'

function toYMD(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const ROLE_LABEL = { manager: 'Менеджер', seller: 'Продавец' }
const METHODS = [
  { id: 'cash',          label: 'Наличные' },
  { id: 'bank_transfer', label: 'Перевод' },
  { id: 'card',          label: 'Карта' },
]

function fmtRu(n) { return Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) }

export default function TeamLeadSellerFinanceDetailPage() {
  const { payeeId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { userId } = useCurrentUser()

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)

  const { data: payables, isLoading } = usePayables(userId, { from, to })
  const member = (payables?.members ?? []).find(m => m.payee_id === payeeId)
  const { data: history = [], isLoading: historyLoading } = usePayeePayoutHistory(payeeId)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [method, setMethod] = useState('cash')
  const createPayouts = useCreatePayouts(userId)

  const commissionPct = member?.gross_amount > 0 ? (member.earned / member.gross_amount) * 100 : 0
  const avgCheck = member?.orders_count > 0 ? member.gross_amount / member.orders_count : 0

  async function handlePay() {
    try {
      await createPayouts.mutateAsync({
        items: [{ payee_id: payeeId, amount: member.remaining }],
        period_start: from,
        period_end: to,
        method,
        note: '',
        idempotency_key: crypto.randomUUID(),
      })
      setConfirmOpen(false)
      toast.success('Выплата проведена · появится в Финансах владельца')
    } catch (err) {
      toast.error(err?.response?.data?.error?.message ?? 'Не удалось провести выплату')
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: 40, fontFamily: M.font, color: M.muted }}>Загрузка…</div>
    )
  }

  if (!member) {
    return (
      <div style={{ padding: 40, fontFamily: M.font, color: M.muted }}>
        Продавец не найден за этот период.
      </div>
    )
  }

  const HeaderBlock = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label="Назад"
        className="flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
        style={{ width: 38, height: 38, borderRadius: 12, background: '#fff', border: `1px solid ${M.borderAlt}`, color: M.ink }}
      >
        <ChevronRight size={18} className="rotate-180" />
      </button>
      <InitialsAvatar name={member.full_name} size={38} />
      <div className="min-w-0 flex-1">
        <h1 style={{ fontSize: 18, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: 0 }}>{member.full_name}</h1>
        <div style={{ fontSize: 12, color: M.muted, fontWeight: 500, marginTop: 2 }}>
          {ROLE_LABEL[member.role] ?? member.role} · комиссия {commissionPct.toFixed(1).replace('.', ',')}%
        </div>
      </div>
    </div>
  )

  const EarningsCard = (
    <Card style={{ borderRadius: 20, padding: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase' }}>Выручка за месяц</div>
      <div style={{ fontSize: 33, fontWeight: 800, color: M.ink, letterSpacing: '-.02em', lineHeight: 1, marginTop: 10 }}>
        {fmtRu(member.gross_amount)} <span style={{ fontSize: 17, fontWeight: 700, color: M.faint }}>с</span>
      </div>
      <div style={{ fontSize: 11.5, color: M.sub, fontWeight: 500, marginTop: 8 }}>
        {member.orders_count} заказ{member.orders_count === 1 ? '' : member.orders_count < 5 ? 'а' : 'ов'} · средний чек {fmtRu(Math.round(avgCheck))} с
      </div>
      <div className="flex items-center justify-center gap-2" style={{ background: '#F5F4FE', borderRadius: 12, padding: '11px 12px', marginTop: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: M.ink }}>{fmtRu(member.gross_amount)}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: M.muted }}>×</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: M.amber }}>{commissionPct.toFixed(1).replace('.', ',')}%</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: M.muted }}>=</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: M.indigoDeep }}>{fmtRu(member.earned)}</span>
      </div>
    </Card>
  )

  const OutstandingCard = (
    <Card style={{ borderRadius: 16, padding: 15, borderColor: '#E3E1FB' }} className="flex items-center justify-between">
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Остаток за месяц</div>
        <div style={{ fontSize: 11.5, color: M.muted, fontWeight: 500, marginTop: 2 }}>
          {member.remaining > 0 ? 'не выплачено' : 'выплачено полностью'}
        </div>
      </div>
      <span style={{ fontSize: 20, fontWeight: 800, color: member.remaining > 0 ? M.indigoDeep : M.green, fontVariantNumeric: 'tabular-nums' }}>
        {fmtRu(member.remaining)} с
      </span>
    </Card>
  )

  const HistoryList = (
    <Card style={{ borderRadius: 16, overflow: 'hidden' }}>
      {historyLoading ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: M.muted }}>Загрузка…</div>
      ) : history.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: M.muted }}>Выплат ещё не было</div>
      ) : (
        history.slice(0, 10).map((p, i) => (
          <div
            key={p.id ?? i}
            className="flex items-center gap-3"
            style={{ padding: '13px 15px', borderBottom: i < history.length - 1 ? `1px solid ${M.bg}` : 'none' }}
          >
            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: M.greenBg, color: M.green }}>
              <Check size={15} strokeWidth={2.4} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>Выплата</div>
              <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{p.period_start} → {p.period_end}</div>
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {fmtAmount(p.amount)} с
            </span>
          </div>
        ))
      )}
    </Card>
  )

  const PayBar = member.remaining > 0 && (
    <div
      className="fixed left-3 right-3 bottom-24 z-30 lg:hidden flex items-center justify-between gap-3"
      style={{ background: '#fff', borderRadius: 16, boxShadow: '0 12px 28px rgba(15,31,55,.16)', border: `1px solid ${M.border}`, padding: '13px 16px' }}
    >
      <div>
        <div style={{ fontSize: 10.5, color: M.muted, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase' }}>К выплате</div>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 2 }}>{fmtRu(member.remaining)} с</div>
      </div>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="flex-shrink-0 active:scale-95 transition-transform"
        style={{ background: M.dark, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: '12px 23px', borderRadius: 12, cursor: 'pointer' }}
      >
        Выплатить
      </button>
    </div>
  )

  const ConfirmModal = (
    <Modal
      open={confirmOpen}
      onClose={() => setConfirmOpen(false)}
      title="Подтвердите выплату"
      description={`${member.full_name} получит ${fmtRu(member.remaining)} сомони`}
    >
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
      <button
        className="w-full rounded-2xl py-3.5 text-white font-black text-sm disabled:opacity-50"
        style={{ background: '#111827' }}
        disabled={createPayouts.isPending}
        onClick={handlePay}
      >
        {createPayouts.isPending ? 'Отправляем…' : 'Подтвердить выплату'}
      </button>
    </Modal>
  )

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col gap-5" style={{ padding: '36px 44px', minHeight: '100vh', fontFamily: M.font }}>
        {HeaderBlock}
        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 380px' }}>
          <div className="flex flex-col gap-4">
            {EarningsCard}
            {OutstandingCard}
          </div>
          <div className="flex flex-col gap-3">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase' }}>История выплат</div>
            {HistoryList}
          </div>
        </div>
        {member.remaining > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="active:scale-95 transition-transform"
              style={{ background: M.dark, color: '#fff', border: 'none', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, padding: '13px 26px', borderRadius: 13, cursor: 'pointer' }}
            >
              Выплатить {fmtRu(member.remaining)} с
            </button>
          </div>
        )}
        {ConfirmModal}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-5">
          {HeaderBlock}
          <div className="space-y-3" style={{ marginTop: 14 }}>
            {EarningsCard}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase', margin: '17px 4px 10px' }}>К выплате сейчас</div>
            {OutstandingCard}
            <div style={{ fontSize: 11.5, fontWeight: 700, color: M.muted, letterSpacing: '.05em', textTransform: 'uppercase', margin: '20px 4px 10px' }}>История выплат</div>
            {HistoryList}
          </div>
        </div>
        {PayBar}
        {ConfirmModal}
      </MobileShell>
    </>
  )
}
