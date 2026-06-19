import { Banknote, Coins } from 'lucide-react'

/**
 * PaymentModeSelector — 2-tile radio: cash on delivery or prepayment.
 *
 * Props:
 *   mode           {string}   — 'cod' | 'prepayment'
 *   onChange       {fn}       — (mode) => void
 *   prepayAmount   {string}   — amount field value (when mode='prepayment')
 *   onPrepayChange {fn}       — (amount: string) => void
 *   prepayReceiver {string}   — where prepayment was received
 *   onReceiverChange {fn}     — (receiver: string) => void
 *   totalOrderAmount {number} — product_total + delivery_fee
 *   onFileChange   {fn}       — (file: File|null) => void
 *   proofFile      {File|null}
 *   chatUrl        {string}
 *   onChatUrlChange {fn}
 */
export default function PaymentModeSelector({
  mode,
  onChange,
  prepayAmount,
  onPrepayChange,
  prepayReceiver,
  onReceiverChange,
  totalOrderAmount = 0,
  onFileChange,
  proofFile,
  chatUrl,
  onChatUrlChange,
}) {
  const hasPrepay = mode === 'prepayment'
  const pa = Number(prepayAmount) || 0

  // Auto-classify for preview
  const label =
    pa <= 0 ? null
    : pa >= totalOrderAmount ? 'Полная предоплата'
    : 'Частичная предоплата'

  const amountToCollect = Math.max(0, totalOrderAmount - pa)

  return (
    <div className="space-y-3">
      <label className="input-label">Способ оплаты *</label>

      <div className="grid grid-cols-2 gap-2">
        {/* Cash on delivery */}
        <button
          type="button"
          onClick={() => onChange('cod')}
          className={`text-left p-3 rounded-xl border transition-all
            ${mode === 'cod'
              ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-500/20'
              : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2
            ${mode === 'cod' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
            <Banknote size={14} />
          </div>
          <p className={`text-xs font-semibold leading-tight
            ${mode === 'cod' ? 'text-emerald-800' : 'text-slate-700'}`}>
            Оплата при получении
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Полная оплата при доставке</p>
        </button>

        {/* Prepayment */}
        <button
          type="button"
          onClick={() => onChange('prepayment')}
          className={`text-left p-3 rounded-xl border transition-all
            ${hasPrepay
              ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-500/20'
              : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2
            ${hasPrepay ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
            <Coins size={14} />
          </div>
          <p className={`text-xs font-semibold leading-tight
            ${hasPrepay ? 'text-amber-800' : 'text-slate-700'}`}>
            Предоплата
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Введите сумму ниже</p>
        </button>
      </div>

      {/* Prepayment details */}
      {hasPrepay && (
        <div className="space-y-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
          <p className="text-xs font-semibold text-amber-800">
            Заказ отправится на проверку диспетчеру
          </p>

          {/* Amount */}
          <div className="space-y-1">
            <label className="input-label">Сумма предоплаты *</label>
            <div className="relative">
              <input
                type="number"
                value={prepayAmount}
                onChange={(e) => onPrepayChange(e.target.value)}
                placeholder="0.00"
                min="0.01"
                step="0.01"
                className="input pr-8 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                           [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">с</span>
            </div>
            {/* Auto-label preview */}
            {pa > 0 && totalOrderAmount > 0 && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-amber-700 font-semibold">{label}</span>
                {amountToCollect > 0 && (
                  <span className="text-slate-500">Остаток при получении: <b className="text-slate-700">{amountToCollect.toLocaleString('ru-RU')} с</b></span>
                )}
                {amountToCollect === 0 && (
                  <span className="text-emerald-600 font-semibold">Полностью оплачено</span>
                )}
              </div>
            )}
            {pa > totalOrderAmount && totalOrderAmount > 0 && (
              <p className="text-[11px] text-rose-600">Предоплата превышает сумму заказа</p>
            )}
          </div>

          {/* Where received */}
          <div className="space-y-1">
            <label className="input-label">Куда поступила предоплата</label>
            <select
              value={prepayReceiver}
              onChange={(e) => onReceiverChange(e.target.value)}
              className="input"
            >
              <option value="">— выберите —</option>
              <option value="dispatcher_card">Карта диспетчера</option>
              <option value="seller_card">Карта продавца</option>
              <option value="company_card">Карта компании</option>
              <option value="other">Другое</option>
            </select>
          </div>

          {/* Proof upload */}
          <div className="space-y-1">
            <label className="input-label">Подтверждение оплаты</label>
            <div className="flex gap-2">
              <label className="flex-1 cursor-pointer">
                <span className="block text-center text-xs font-semibold py-2.5 rounded-xl border border-dashed border-amber-300 bg-white text-amber-700 hover:bg-amber-50 transition-colors">
                  📎 Прикрепить файл / фото
                </span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => onFileChange?.(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            {/* Proof preview */}
            {proofFile && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-amber-200">
                {proofFile.type?.startsWith('image/') ? (
                  <img
                    src={URL.createObjectURL(proofFile)}
                    alt="proof"
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-amber-200"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-700 text-xs font-bold">
                    PDF
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-slate-700 truncate">{proofFile.name}</p>
                  <p className="text-[10px] text-slate-400">{(proofFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => onFileChange?.(null)}
                  className="text-slate-400 hover:text-rose-500 text-xs font-bold px-1"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Chat link */}
          <div className="space-y-1">
            <label className="input-label">Ссылка на переписку с клиентом (необязательно)</label>
            <input
              type="url"
              value={chatUrl}
              onChange={(e) => onChatUrlChange?.(e.target.value)}
              placeholder="https://t.me/…"
              className="input"
            />
          </div>
        </div>
      )}
    </div>
  )
}
