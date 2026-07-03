/**
 * TeamLeadFinancePage — /team-lead/finance ("Финансы")
 *
 * Hero-card system re-skinned indigo/violet from CourierCashView.jsx — same
 * elements (white card, colored border/shadow, giant number, "A − B = C"
 * formula strip) but the giant number is the team lead's *personal net
 * income* (pool share minus staff payouts), not the team's unpaid balance —
 * that's a secondary chip below, matching the approved mockup design.
 *
 * Payables list + bulk "Выплатить" flow both read/write through usePayables /
 * useCreatePayouts, which share the exact same server-computed numbers used
 * by TeamLeadTeamPage's detail sheet.
 */
import { useState, useEffect, useMemo } from 'react'
import { Check } from 'lucide-react'
import Badge           from '../../../shared/components/Badge'
import Modal            from '../../../shared/components/Modal'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { useToast }     from '../../../shared/components/ToastProvider'
import { fmtAmount }    from '../../../shared/orderStatusConfig'
import useCurrentUser   from '../../../shared/hooks/useCurrentUser'
import usePayables       from '../hooks/usePayables'
import useCreatePayouts  from '../hooks/useCreatePayouts'

function toYMD(d) { return d.toISOString().slice(0, 10) }
function initialsOf(name) {
  return (name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function fmtRu(n) { return Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) }

const ROLE_LABEL = { manager: 'Менеджер', seller: 'Продавец' }
const ROLE_BADGE = { manager: 'indigo', seller: 'violet' }
const METHODS = [
  { id: 'cash',          label: 'Наличные' },
  { id: 'bank_transfer', label: 'Перевод' },
  { id: 'card',          label: 'Карта' },
]

export default function TeamLeadFinancePage() {
  const toast = useToast()
  const { userId } = useCurrentUser()

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)

  const { data: payables, isLoading } = usePayables(userId, { from, to })
  const members = payables?.members ?? []

  const [selected, setSelected] = useState(() => new Set())
  const [amounts, setAmounts]   = useState({})
  const [method, setMethod]     = useState('cash')
  const [confirmOpen, setConfirmOpen] = useState(false)

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
      })
      setConfirmOpen(false)
      setSelected(new Set())
      toast.success('Выплата проведена · появится в Финансах владельца')
    } catch (err) {
      toast.error(err?.response?.data?.error?.message ?? 'Не удалось провести выплату')
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Финансы команды</h1>
        <p className="text-xs text-slate-400">Выплаты — только участникам вашей команды</p>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : (
        <div
          className="rounded-[28px] p-6 relative overflow-hidden"
          style={{ background: '#fff', border: '1px solid #E3DBFF', boxShadow: '0 16px 34px rgba(79,70,229,.15)' }}
        >
          <div className="text-[11px] font-black uppercase tracking-wide" style={{ color: '#7C3AED' }}>
            Ваш личный доход за период
          </div>
          <div
            className="text-[42px] font-black tracking-tight my-2 leading-none"
            style={{
              background: 'linear-gradient(135deg,#4F46E5,#7C3AED)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {fmtRu(payables?.personal_net)} сомони
          </div>
          <div className="rounded-2xl py-3 px-3 flex justify-center gap-2 items-center text-base font-black flex-wrap" style={{ background: '#F6F5FF' }}>
            <span className="text-slate-900">{fmtRu(payables?.personal_pool)}</span>
            <span className="text-slate-400">−</span>
            <span style={{ color: '#B45309' }}>{fmtRu((payables?.personal_pool ?? 0) - (payables?.personal_net ?? 0))}</span>
            <span className="text-slate-400">=</span>
            <span className="text-indigo-600">{fmtRu(payables?.personal_net)}</span>
          </div>
          <p className="text-center text-slate-400 font-bold text-xs mt-3">
            Доход команды (40%) − Выплаты сотрудникам
          </p>
          <div className="mt-3.5 rounded-2xl px-3.5 py-2.5 flex justify-between items-center text-xs font-bold" style={{ background: '#F5F3FF', color: '#6D28D9' }}>
            <span>Осталось выплатить команде</span>
            <b>{fmtRu(payables?.team_remaining)} сомони</b>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-black uppercase tracking-wide text-slate-500">Кому выплатить</h2>
        <span className="text-xs text-slate-400">
          Выбрано: <b className="text-indigo-600">{selected.size}</b> из {members.length}
        </span>
      </div>

      <div className="card divide-y divide-slate-50">
        {members.length === 0 && !isLoading && (
          <div className="p-8 text-center text-sm text-slate-400">Нет данных о доходах команды за период</div>
        )}
        {members.map(m => {
          const isFullyPaid = m.remaining <= 0
          const isChecked = selected.has(m.payee_id)
          return (
            <div key={m.payee_id} className={`p-4 flex gap-3 ${isFullyPaid ? 'opacity-50' : ''}`}>
              <button
                type="button"
                disabled={isFullyPaid}
                onClick={() => toggle(m.payee_id)}
                className="w-[22px] h-[22px] rounded-lg border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                style={isChecked
                  ? { background: 'linear-gradient(135deg,#4F46E5,#6D28D9)', borderColor: '#4F46E5' }
                  : { borderColor: '#CBD5E1', background: '#fff' }}
              >
                {isChecked && <Check size={13} className="text-white" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }}
                  >
                    <span className="text-[11px] font-bold text-white">{initialsOf(m.full_name)}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 truncate">{m.full_name}</span>
                  <Badge variant={ROLE_BADGE[m.role] ?? 'slate'} size="sm">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                </div>
                <p className="text-[11px] text-slate-400 mb-2">
                  {m.orders_count} {m.orders_count === 1 ? 'заказ' : 'заказов'} · сумма {fmtAmount(m.gross_amount)} сомони
                </p>
                <div className="flex gap-3.5 text-[11px] mb-2">
                  <div className="text-slate-400 font-bold">Заработано<b className="block text-slate-900 text-xs mt-0.5">{fmtAmount(m.earned)} сомони</b></div>
                  <div className="text-slate-400 font-bold">Выплачено<b className="block text-slate-900 text-xs mt-0.5">{fmtAmount(m.already_paid)} сомони</b></div>
                  <div className="text-slate-400 font-bold">Осталось<b className={`block text-xs mt-0.5 ${isFullyPaid ? 'text-emerald-600' : 'text-indigo-600'}`}>{fmtAmount(m.remaining)} сомони</b></div>
                </div>
                {isFullyPaid ? (
                  <Badge variant="emerald" size="sm">Выплачено полностью</Badge>
                ) : (
                  <input
                    className="w-full text-right border-2 rounded-xl px-2.5 py-2 text-sm font-black"
                    style={{ borderColor: '#E2E8F0', background: '#F8FAFF', color: '#4F46E5' }}
                    inputMode="numeric"
                    disabled={!isChecked}
                    value={amounts[m.payee_id] ?? ''}
                    onChange={e => setAmounts(prev => ({ ...prev, [m.payee_id]: e.target.value }))}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {selected.size > 0 && (
        <div
          className="fixed left-3 right-3 bottom-24 z-30 rounded-2xl p-3.5 flex items-center gap-3 bg-white"
          style={{ boxShadow: '0 12px 28px rgba(15,31,55,.16)', border: '1px solid #F1F5F9' }}
        >
          <div className="flex-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase">Выбрано: {selected.size}</p>
            <p className="text-base font-black text-slate-900">Итого: {fmtRu(total)} сомони</p>
          </div>
          <button
            className="rounded-xl px-5 py-3 text-white font-black text-sm"
            style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)', boxShadow: '0 8px 18px rgba(79,70,229,.3)' }}
            onClick={() => setConfirmOpen(true)}
          >
            Выплатить
          </button>
        </div>
      )}

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
              <span className="text-sm font-black text-slate-900">{fmtAmount(amounts[m.payee_id])} сомони</span>
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
          <span className="text-lg font-black text-indigo-600">{fmtRu(total)} сомони</span>
        </div>
        <button
          className="w-full rounded-2xl py-3.5 text-white font-black text-sm disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#4F46E5,#6D28D9)' }}
          disabled={createPayouts.isPending}
          onClick={handleConfirm}
        >
          {createPayouts.isPending ? 'Отправляем…' : 'Подтвердить выплату'}
        </button>
      </Modal>
    </div>
  )
}
