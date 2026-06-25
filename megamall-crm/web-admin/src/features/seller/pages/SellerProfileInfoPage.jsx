import { useState, useEffect } from 'react'
import Alert from '../../../shared/components/Alert'
import Button from '../../../shared/components/Button'
import { useSellerMe, usePatchMe } from '../hooks/useSellerMe'
import { useToast } from '../../../shared/components/ToastProvider'
import { MessageCircle, Phone, User2, Shield } from 'lucide-react'

export default function SellerProfileInfoPage() {
  const { data: me, isLoading } = useSellerMe()
  const patch = usePatchMe()
  const toast = useToast()
  const [telegramChatId, setTelegramChatId] = useState('')

  useEffect(() => {
    if (me?.telegram_chat_id != null) setTelegramChatId(me.telegram_chat_id)
  }, [me])

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="card h-16 animate-pulse" />)}
      </div>
    )
  }

  const errMsg = patch.error?.response?.data?.error?.message ?? patch.error?.message

  function handleSave() {
    patch.mutate(
      { telegram_chat_id: telegramChatId.trim() || null },
      { onSuccess: () => toast.success('Сохранено') }
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Read-only info ──────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <InfoRow icon={<User2 size={15} className="text-slate-500" />} label="Имя" value={me?.full_name ?? '—'} />
        <div className="h-px bg-slate-50" />
        <InfoRow
          icon={<Phone size={15} className="text-slate-500" />}
          label="Телефон"
          value={
            me?.phone
              ? <a href={`tel:${me.phone}`} className="text-indigo-600">{me.phone}</a>
              : '—'
          }
        />
        <div className="h-px bg-slate-50" />
        <InfoRow
          icon={<Shield size={15} className="text-slate-500" />}
          label="Роль"
          value={
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
              Продавец
            </span>
          }
        />
      </div>

      {/* ── Telegram edit ───────────────────────────────────────────────── */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
               style={{ background: 'linear-gradient(135deg,#2481CC,#1A6CB0)' }}>
            <MessageCircle size={15} color="white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900">Telegram</p>
            <p className="text-xs text-slate-400">Для уведомлений о заказах</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Chat ID</p>
          <input
            className="input"
            placeholder="-100123456789"
            value={telegramChatId}
            onChange={e => setTelegramChatId(e.target.value)}
          />
          <p className="mt-1.5 text-[11px] text-slate-400">
            Найдите Chat ID через бота @userinfobot в Telegram
          </p>
        </div>

        {errMsg && <Alert variant="error">{errMsg}</Alert>}

        <Button variant="primary" loading={patch.isPending} onClick={handleSave}>
          Сохранить
        </Button>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-slate-500 min-w-0">
        {icon}
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <span className="text-sm font-semibold text-slate-900 text-right">{value}</span>
    </div>
  )
}
