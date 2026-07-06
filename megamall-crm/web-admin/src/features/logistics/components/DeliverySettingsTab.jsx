import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Zap, Save, CheckCircle2 } from 'lucide-react'
import useDeliverySettings from '../../seller/hooks/useDeliverySettings'
import { updateDeliverySettings } from '../../seller/api'
import { KEYS } from '../../../shared/queryKeys'

export default function DeliverySettingsTab() {
  const qc = useQueryClient()
  const { data, isLoading } = useDeliverySettings()

  const [normalFee, setNormalFee]   = useState('')
  const [expressFee, setExpressFee] = useState('')
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    if (data) {
      setNormalFee(String(data.normal_fee ?? 0))
      setExpressFee(String(data.fast_fee ?? 0))
    }
  }, [data])

  const mutation = useMutation({
    mutationFn: () => updateDeliverySettings({
      normal_fee: Number(normalFee)  || 0,
      fast_fee:   Number(expressFee) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.settings.delivery })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    mutation.mutate()
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Настройки доставки</h2>
        <p className="text-sm text-slate-500 mt-1">
          Тарифы доставки показываются продавцам при оформлении заказа. Введите 0 для бесплатной доставки.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                <Truck size={17} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Обычная доставка</p>
                <p className="text-xs text-slate-400">Стандартные сроки доставки</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Тариф доставки
              </label>
              <div className="relative mt-1.5">
                <input
                  type="number"
                  value={normalFee}
                  onChange={(e) => setNormalFee(e.target.value)}
                  min="0"
                  step="0.01"
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 pr-12 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">сом</span>
              </div>
              {Number(normalFee) === 0 && (
                <p className="text-xs text-emerald-600 font-semibold mt-1.5">Бесплатно для клиента</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                <Zap size={17} />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-800">Быстрая доставка</p>
                <p className="text-xs text-amber-600">Ускоренная доставка, приоритет курьера</p>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                Тариф доставки
              </label>
              <div className="relative mt-1.5">
                <input
                  type="number"
                  value={expressFee}
                  onChange={(e) => setExpressFee(e.target.value)}
                  min="0"
                  step="0.01"
                  className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2.5 pr-12 text-sm font-bold text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  placeholder="0"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-amber-500 font-medium">сом</span>
              </div>
              {Number(expressFee) === 0 && (
                <p className="text-xs text-emerald-600 font-semibold mt-1.5">Бесплатно для клиента</p>
              )}
            </div>
          </div>

          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">Обычная</span>
            <span className="font-bold text-slate-700">
              {Number(normalFee) > 0 ? `${Number(normalFee).toLocaleString('ru-RU')} сом` : 'Бесплатно'}
            </span>
          </div>
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 flex items-center justify-between text-sm">
            <span className="text-amber-600">Быстрая</span>
            <span className="font-bold text-amber-700">
              {Number(expressFee) > 0 ? `${Number(expressFee).toLocaleString('ru-RU')} сом` : 'Бесплатно'}
            </span>
          </div>

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all
              bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (
              <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : saved ? (
              <><CheckCircle2 size={16} /> Сохранено</>
            ) : (
              <><Save size={16} /> Сохранить тарифы</>
            )}
          </button>

          {mutation.isError && (
            <p className="text-xs text-rose-600 text-center">
              Ошибка сохранения: {mutation.error?.message ?? 'попробуйте ещё раз'}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
