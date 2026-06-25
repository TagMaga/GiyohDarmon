import { MessageSquare } from 'lucide-react'
import { fmtDate } from '../../statusConfig'

const ROLE_LABEL = {
  dispatcher: 'Диспетчер',
  owner:      'Владелец',
  seller:     'Продавец',
  courier:    'Курьер',
  manager:    'Менеджер',
}

export default function DispatcherCommentsSummary({ comments = [], onShowAll }) {
  const list   = Array.isArray(comments) ? comments : []
  const latest = list[list.length - 1] ?? null

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <MessageSquare size={11} />
          Комментарии {list.length > 0 && `(${list.length})`}
        </h3>
        {list.length > 0 && (
          <button
            onClick={onShowAll}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold transition-colors"
          >
            Все →
          </button>
        )}
      </div>

      {!latest ? (
        <p className="text-xs text-slate-400 italic">Комментариев нет</p>
      ) : (
        <button
          onClick={onShowAll}
          className="w-full text-left bg-slate-50 hover:bg-slate-100 rounded-xl px-4 py-3 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-slate-700">
              {latest.author_name ?? 'Пользователь'}
            </span>
            {latest.author_role && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">
                {ROLE_LABEL[latest.author_role] ?? latest.author_role}
              </span>
            )}
            <span className="text-[10px] text-slate-400 ml-auto">
              {fmtDate(latest.created_at)}
            </span>
          </div>
          <p className="text-xs text-slate-600 line-clamp-2 text-left">{latest.comment}</p>
          {list.length > 1 && (
            <p className="text-[10px] text-indigo-500 mt-1.5">
              + ещё {list.length - 1} комментари{list.length - 1 === 1 ? 'й' : 'ев'}
            </p>
          )}
        </button>
      )}
    </section>
  )
}
