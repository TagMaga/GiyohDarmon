import { useState, useEffect } from 'react'
import { createPortal }        from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Send, MessageSquare, Loader2 } from 'lucide-react'
import Button   from '../../../shared/components/Button'
import Alert    from '../../../shared/components/Alert'
import Skeleton from '../../../shared/components/Skeleton'
import EmptyState from '../../../shared/components/EmptyState'
import { useToast } from '../../../shared/components/ToastProvider'
import { fetchComments, addComment } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { fmtDate } from '../statusConfig'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'

const VISIBILITY_LABELS = {
  internal:        'Внутренний',
  courier_visible: 'Виден курьеру',
  seller_visible:  'Виден продавцу',
}

/**
 * CommentsDrawer — slide-in panel (right side) for order comments.
 *
 * Props:
 *   open    {bool}
 *   onClose {fn}
 *   order   {object}
 */
export default function CommentsDrawer({ open, onClose, order }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [text,       setText]      = useState('')
  const [visibility, setVisibility] = useState('internal')

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Escape key
  useEffect(() => {
    if (!open) return
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', fn)
    return () => document.removeEventListener('keydown', fn)
  }, [open, onClose])

  const orderId = getOrderId(order)

  const { data: comments, isPending: commentsLoading, isError: commentsError } = useQuery({
    queryKey: KEYS.dispatcher.comments(orderId),
    queryFn:  () => fetchComments(orderId),
    enabled:  open && !!orderId,
    retry:    false, // endpoint might not exist — don't hammer it
  })

  const { mutate, isPending: sending, reset } = useMutation({
    mutationFn: () => addComment(orderId, { comment: text.trim(), visibility }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.comments(orderId) })
      toast.success('Комментарий добавлен')
      setText('')
      reset()
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message ?? 'Не удалось добавить комментарий')
    },
  })

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer — right side */}
      <div
        className="relative ml-auto w-full sm:w-[420px] h-full bg-white shadow-xl
                   flex flex-col animate-fade-in overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Комментарии</h2>
            {order && (
              <p className="text-xs text-slate-500 mt-0.5">
                Заказ {formatOrderLabel(order)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center
                       rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {commentsLoading && <Skeleton count={3} className="h-16 rounded-2xl" gap="gap-3" />}

          {commentsError && (
            <Alert variant="warning" title="Комментарии недоступны">
              Эндпоинт комментариев не вернул данные. Попробуйте позже.
            </Alert>
          )}

          {!commentsLoading && !commentsError && (!comments || comments.length === 0) && (
            <EmptyState
              icon={<MessageSquare size={22} />}
              title="Нет комментариев"
              description="Добавьте первый комментарий к этому заказу."
            />
          )}

          {!commentsLoading && Array.isArray(comments) && comments.map((c, i) => (
            <CommentItem key={c.id ?? i} comment={c} />
          ))}
        </div>

        {/* Add comment */}
        <div className="border-t border-slate-100 px-5 py-4 flex-shrink-0">
          <div className="space-y-3">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="input text-xs py-2"
            >
              {Object.entries(VISIBILITY_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="input resize-none flex-1 text-sm"
                rows={2}
                placeholder="Введите комментарий…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey && text.trim()) mutate()
                }}
              />
              <Button
                variant="primary"
                size="md"
                onClick={() => text.trim() && mutate()}
                loading={sending}
                disabled={!text.trim()}
                className="self-end"
                icon={<Send size={14} />}
              />
            </div>
            <p className="text-[10px] text-slate-400">Ctrl + Enter для отправки</p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function CommentItem({ comment }) {
  const vis = VISIBILITY_LABELS[comment.visibility] ?? comment.visibility ?? 'Внутренний'
  return (
    <div className="bg-slate-50 rounded-2xl p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">
          {comment.author?.full_name ?? comment.created_by ?? 'Система'}
        </span>
        <span className="text-[10px] text-slate-400 whitespace-nowrap">
          {fmtDate(comment.created_at)}
        </span>
      </div>
      <p className="text-sm text-slate-700 leading-relaxed">{comment.comment ?? comment.text}</p>
      <span className="inline-block text-[10px] text-slate-400 bg-white border border-slate-100 px-2 py-0.5 rounded-full">
        {vis}
      </span>
    </div>
  )
}
