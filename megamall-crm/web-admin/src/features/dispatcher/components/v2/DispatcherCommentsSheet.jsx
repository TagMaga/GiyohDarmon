import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Send, Loader2, MessageSquare } from 'lucide-react'
import Skeleton from '../../../../shared/components/Skeleton'
import { useToast } from '../../../../shared/components/ToastProvider'
import { fetchComments, addComment } from '../../api'
import { KEYS } from '../../../../shared/queryKeys'
import { fmtDate } from '../../statusConfig'

const ROLE_LABEL = {
  dispatcher: 'Диспетчер',
  owner:      'Владелец',
  seller:     'Продавец',
  courier:    'Курьер',
  manager:    'Менеджер',
}

const ROLE_COLOR = {
  dispatcher: 'bg-indigo-100 text-indigo-700',
  owner:      'bg-violet-100 text-violet-700',
  seller:     'bg-emerald-100 text-emerald-700',
  courier:    'bg-amber-100 text-amber-700',
  manager:    'bg-sky-100 text-sky-700',
}

export default function DispatcherCommentsSheet({ orderId, onClose }) {
  const qc      = useQueryClient()
  const toast   = useToast()
  const [text, setText] = useState('')
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  const { data: comments, isLoading } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn:  () => fetchComments(orderId),
    enabled:  !!orderId,
    staleTime: 20_000,
  })

  const list = Array.isArray(comments) ? comments : []

  const { mutate: send, isPending } = useMutation({
    mutationFn: () => addComment(orderId, { comment: text.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.comments(orderId) })
      setText('')
    },
    onError: (err) => toast.error(err?.response?.data?.error?.message ?? 'Ошибка'),
  })

  // Auto-scroll to bottom when comments load or new message added
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [list.length])

  // Focus input on open
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150)
  }, [])

  // Esc to close
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-fade-in"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="relative w-full bg-white rounded-t-2xl flex flex-col animate-slide-in-up shadow-card-lg"
        style={{ maxHeight: '80vh' }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-slate-400" />
            <h3 className="text-base font-bold text-slate-800">
              Комментарии
              {list.length > 0 && (
                <span className="ml-1.5 text-sm font-normal text-slate-400">({list.length})</span>
              )}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0 pb-2">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : list.length === 0 ? (
            <div className="py-10 text-center">
              <MessageSquare size={28} className="mx-auto text-slate-200 mb-2" />
              <p className="text-sm text-slate-400">Комментариев нет</p>
              <p className="text-xs text-slate-300 mt-1">Напишите первый комментарий</p>
            </div>
          ) : (
            list.map((c, i) => <CommentBubble key={c.id ?? i} comment={c} />)
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-slate-100 p-4 pb-safe">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Написать комментарий…"
              className="flex-1 text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 bg-slate-50"
            />
            <button
              disabled={!text.trim() || isPending}
              onClick={() => text.trim() && send()}
              className="p-2.5 bg-indigo-600 text-white rounded-xl disabled:opacity-40 hover:bg-indigo-700 active:bg-indigo-800 transition-colors flex-shrink-0"
            >
              {isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function CommentBubble({ comment: c }) {
  const roleCls = ROLE_COLOR[c.author_role] ?? 'bg-slate-100 text-slate-600'
  const roleLabel = ROLE_LABEL[c.author_role] ?? c.author_role

  return (
    <div className="bg-slate-50 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-semibold text-slate-800">
          {c.author_name ?? 'Пользователь'}
        </span>
        {c.author_role && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${roleCls}`}>
            {roleLabel}
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">
          {fmtDate(c.created_at)}
        </span>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{c.comment}</p>
    </div>
  )
}
