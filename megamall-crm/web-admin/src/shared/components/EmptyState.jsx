export default function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && (
        <div
          className="w-14 h-14 flex items-center justify-center mb-4 text-indigo-400"
          style={{
            background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
            borderRadius: '20px',
          }}
        >
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold text-slate-700 mb-1">{title}</p>
      {description && (
        <p className="text-[13px] text-slate-400 max-w-xs leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
