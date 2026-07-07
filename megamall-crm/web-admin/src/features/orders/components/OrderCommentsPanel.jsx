import { useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { fmtDate } from '../../../shared/orderStatusConfig'
import { useAddOrderComment, useOrderComments } from '../hooks/useOrderComments'

const ROLE_LABELS = {
  seller: 'Продавец',
  manager: 'Менеджер',
  sales_team_lead: 'Тимлид',
  dispatcher: 'Диспетчер',
  owner: 'Владелец',
  courier: 'Курьер',
}

export function roleLabel(role) {
  return ROLE_LABELS[role] ?? role ?? 'Роль'
}

export default function OrderCommentsPanel({ orderId, compact = false }) {
  const [text, setText] = useState('')
  const { data: comments = [], isLoading, isError, error } = useOrderComments(orderId)
  const addComment = useAddOrderComment(orderId)

  const send = () => {
    const value = text.trim()
    if (!value || addComment.isPending) return
    addComment.mutate(value, { onSuccess: () => setText('') })
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className={`${compact ? 'p-0' : 'p-5'} flex-1 space-y-3`}>
        {isLoading && <p className="text-xs text-slate-400 text-center py-6">Загрузка…</p>}

        {isError && (
          <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 text-sm text-rose-700">
            {error?.response?.data?.error?.message ?? 'Комментарии недоступны'}
          </div>
        )}

        {!isLoading && !isError && comments.length === 0 && (
          <div className="text-center py-8">
            <MessageCircle size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-400">Нет комментариев</p>
            <p className="text-xs text-slate-300 mt-1">Добавьте первый комментарий</p>
          </div>
        )}

        {comments.map((c, i) => (
          <div key={c.id ?? i} className="rounded-2xl px-4 py-3 bg-slate-50 border border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-700 truncate">{c.author_name ?? '—'}</span>
                <span className="ml-2 inline-flex text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                  {roleLabel(c.author_role)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtDate(c.created_at)}</span>
            </div>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{c.comment ?? c.text}</p>
          </div>
        ))}
      </div>

      <div className={`${compact ? 'pt-3' : 'px-5 py-3'} flex items-center gap-2 flex-shrink-0 border-t border-slate-100`}>
        <input
          className="input flex-1 text-base py-2.5"
          placeholder="Написать комментарий…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
        />
        <button
          onClick={send}
          disabled={!text.trim() || addComment.isPending}
          className="w-10 h-10 flex items-center justify-center rounded-2xl text-white disabled:opacity-40 active:scale-95 transition-transform bg-indigo-600"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
