/**
 * TeamLeadTeamPage — /team-lead/team ("Моя команда")
 *
 * Merges the previously-separate Managers/Sellers pages into one view with
 * Менеджеры/Продавцы sub-tabs. Row stats and the detail sheet both source
 * from usePayables() (GET /payouts/payables/team-lead/:id) — the same
 * server-computed numbers the Финансы screen uses for payouts, so this page
 * and the payout flow never disagree on "how much has this person earned."
 */
import { useState, useMemo } from 'react'
import { Users, ChevronRight } from 'lucide-react'
import Badge             from '../../../shared/components/Badge'
import Modal              from '../../../shared/components/Modal'
import EmptyState         from '../../../shared/components/EmptyState'
import { CardSkeleton }   from '../../../shared/components/Skeleton'
import { fmtAmount, fmtDate, STATUS_BADGE } from '../../../shared/orderStatusConfig'
import useCurrentUser     from '../../../shared/hooks/useCurrentUser'
import usePayables        from '../hooks/usePayables'
import useOwnerOrders     from '../../orders/hooks/useOwnerOrders'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'

function toYMD(d) { return d.toISOString().slice(0, 10) }

function initialsOf(name) {
  return (name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

const ROLE_LABEL = { manager: 'Менеджер', seller: 'Продавец' }
const ROLE_BADGE = { manager: 'indigo', seller: 'violet' }

function MemberRow({ member, onClick }) {
  return (
    <div className="card p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)' }}
      >
        <span className="text-xs font-bold text-white">{initialsOf(member.full_name)}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900 truncate">{member.full_name}</p>
          <Badge variant={ROLE_BADGE[member.role] ?? 'slate'} size="sm">{ROLE_LABEL[member.role] ?? member.role}</Badge>
        </div>
        <p className="text-xs text-slate-400 mt-0.5">
          Заказов: <b className="text-slate-600">{member.orders_count}</b> · Доход за период: <b className="text-slate-600">{fmtAmount(member.earned)} сомони</b>
        </p>
      </div>
      <ChevronRight size={16} className="text-slate-300 flex-shrink-0" />
    </div>
  )
}

function MemberDetailSheet({ member, orders, onClose }) {
  const myOrders = useMemo(() => {
    if (!member) return []
    return orders
      .filter(o => (o.seller_id ?? o.SellerID) === member.payee_id || (o.manager_id ?? o.ManagerID) === member.payee_id)
      .slice(0, 20)
  }, [orders, member?.payee_id])

  const formula = member?.role === 'manager'
    ? 'Свой заказ × 20% + остальные заказы × 3% = Доход'
    : '(Сумма заказов − Доставка) × 10% = Доход'

  return (
    <Modal
      open={!!member}
      onClose={onClose}
      title={member?.full_name ?? ''}
      description={ROLE_LABEL[member?.role] ?? member?.role}
    >
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-slate-50 rounded-2xl p-3 text-center">
          <p className="text-sm font-black text-slate-900">{fmtAmount(member?.gross_amount)}</p>
          <p className="text-[10px] text-slate-400 uppercase mt-0.5">Сумма заказов</p>
        </div>
        <div className="bg-slate-50 rounded-2xl p-3 text-center">
          <p className="text-sm font-black text-slate-900">{fmtAmount(member?.earned)}</p>
          <p className="text-[10px] text-slate-400 uppercase mt-0.5">Доход</p>
        </div>
        <div className="bg-slate-50 rounded-2xl p-3 text-center">
          <p className="text-sm font-black text-indigo-600">{fmtAmount(member?.remaining)}</p>
          <p className="text-[10px] text-slate-400 uppercase mt-0.5">Нужно выплатить</p>
        </div>
      </div>
      <div className="rounded-2xl px-4 py-3 mb-5 text-center text-xs font-bold text-violet-700" style={{ background: '#F6F5FF' }}>
        {formula}
      </div>
      <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">Недавние заказы</p>
      {myOrders.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Нет заказов за период</p>
      ) : (
        <div className="space-y-2">
          {myOrders.map((o, i) => {
            const status = o.status ?? o.Status ?? ''
            const amount = Number(o.total_amount ?? o.amount ?? 0)
            return (
              <div key={getOrderId(o) ?? i} className="flex items-center justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold text-indigo-700">{formatOrderLabel(o)}</p>
                  <p className="text-[11px] text-slate-400">{fmtDate(o.created_at ?? o.CreatedAt)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-semibold text-slate-700">{fmtAmount(amount)} сомони</span>
                  <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{status}</Badge>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

export default function TeamLeadTeamPage() {
  const [subTab, setSubTab] = useState('manager')
  const [selected, setSelected] = useState(null)
  const { userId } = useCurrentUser()

  const now  = new Date()
  const from = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  const to   = toYMD(now)

  const { data: payables, isLoading } = usePayables(userId, { from, to })
  const members  = payables?.members ?? []
  const managers = members.filter(m => m.role === 'manager')
  const sellers  = members.filter(m => m.role === 'seller')
  const list     = subTab === 'manager' ? managers : sellers

  const orderParams = useMemo(() => ({
    team_lead_id: userId, from, to, limit: 500, page: 1,
  }), [userId, from, to])
  const { items: orders = [] } = useOwnerOrders(orderParams)

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Моя команда</h1>
        <p className="text-xs text-slate-400">Видно: только ваша команда · текущий месяц</p>
      </div>

      <div
        className="flex gap-1 rounded-2xl p-1"
        style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}
      >
        {[
          { id: 'manager', label: `Менеджеры · ${managers.length}` },
          { id: 'seller',  label: `Продавцы · ${sellers.length}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
            style={subTab === t.id
              ? { background: 'white', color: '#4F46E5', boxShadow: '0 2px 8px rgba(16,24,40,0.08)' }
              : { color: '#94A3B8' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title={subTab === 'manager' ? 'Нет менеджеров в команде' : 'Нет продавцов в команде'}
          description="Добавьте сотрудника через HR-панель, чтобы он появился здесь."
        />
      ) : (
        <div className="space-y-3">
          {list.map(m => (
            <MemberRow key={m.payee_id} member={m} onClick={() => setSelected(m)} />
          ))}
        </div>
      )}

      <MemberDetailSheet member={selected} orders={orders} onClose={() => setSelected(null)} />
    </div>
  )
}
