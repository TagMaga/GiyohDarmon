import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, Zap, MapPin, Save, CheckCircle2 } from 'lucide-react'

import Alert from '../../../shared/components/Alert'
import { fetchCities, fetchCourierPayout, updateCourierPayout } from '../api'

/**
 * CourierPayoutSection — owner-only per-courier delivery config.
 *
 * Courier payout is paid from the COMPANY MARGIN and is fully independent of the
 * client delivery fee. A courier earns this amount only after an order is
 * delivered (cancelled orders earn 0). Cities control assignment/visibility only.
 */
export default function CourierPayoutSection({ courierId }) {
  const qc = useQueryClient()

  const { data: cities = [] } = useQuery({
    queryKey: ['cities', 'active'],
    queryFn: () => fetchCities(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: profile, isLoading, isError, error } = useQuery({
    queryKey: ['courier-payout', courierId],
    queryFn: () => fetchCourierPayout(courierId),
  })

  const [payoutNormal, setPayoutNormal] = useState('')
  const [payoutFast,   setPayoutFast]   = useState('')
  const [isActive,     setIsActive]     = useState(true)
  const [cityIds,      setCityIds]      = useState([])
  const [saved,        setSaved]        = useState(false)

  useEffect(() => {
    if (profile) {
      setPayoutNormal(String(profile.payout_normal ?? 0))
      setPayoutFast(String(profile.payout_fast ?? 0))
      setIsActive(profile.is_active !== false)
      setCityIds(Array.isArray(profile.city_ids) ? profile.city_ids : [])
    }
  }, [profile])

  const mutation = useMutation({
    mutationFn: () => updateCourierPayout(courierId, {
      payout_normal: Number(payoutNormal) || 0,
      payout_fast:   Number(payoutFast)   || 0,
      is_active:     isActive,
      city_ids:      cityIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courier-payout', courierId] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const toggleCity = (id) =>
    setCityIds((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id])

  if (isLoading) {
    return <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
  }
  if (isError) {
    return (
      <Alert variant="error">
        {error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки'}
      </Alert>
    )
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); mutation.mutate() }}
      className="space-y-4"
    >
      <Alert variant="info">
        Выплата курьеру оплачивается из маржи компании и не зависит от платы клиента
        за доставку. Курьер получает выплату только после доставки заказа.
      </Alert>

      {/* Active toggle */}
      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Статус курьера</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Неактивные курьеры не получают новые заказы
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsActive((v) => !v)}
          className={`relative w-12 h-7 rounded-full transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
          aria-pressed={isActive}
        >
          <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {/* Payouts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
              <Truck size={15} />
            </div>
            <p className="text-sm font-semibold text-slate-800">Обычный заказ</p>
          </div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Выплата курьеру</label>
          <div className="relative mt-1.5">
            <input
              type="number" min="0" step="0.01"
              value={payoutNormal}
              onChange={(e) => setPayoutNormal(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 pr-12 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              placeholder="0"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-medium">сом</span>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
              <Zap size={15} />
            </div>
            <p className="text-sm font-semibold text-amber-800">Быстрый заказ</p>
          </div>
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Выплата курьеру</label>
          <div className="relative mt-1.5">
            <input
              type="number" min="0" step="0.01"
              value={payoutFast}
              onChange={(e) => setPayoutFast(e.target.value)}
              className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2.5 pr-12 text-sm font-bold text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              placeholder="0"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-amber-500 font-medium">сом</span>
          </div>
        </div>
      </div>

      {/* Cities */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <MapPin size={15} className="text-slate-400" />
          <p className="text-sm font-semibold text-slate-800">Города обслуживания</p>
        </div>
        {cities.length === 0 ? (
          <p className="text-xs text-slate-400">Нет активных городов</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cities.map((c) => {
              const on = cityIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCity(c.id)}
                  className={`px-3 py-2 rounded-xl text-sm font-semibold border transition-all min-h-[40px]
                    ${on ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={mutation.isPending}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {mutation.isPending ? (
          <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
        ) : saved ? (
          <><CheckCircle2 size={16} /> Сохранено</>
        ) : (
          <><Save size={16} /> Сохранить тариф курьера</>
        )}
      </button>

      {mutation.isError && (
        <p className="text-xs text-rose-600 text-center">
          {mutation.error?.response?.data?.error?.message ?? 'Ошибка сохранения'}
        </p>
      )}
    </form>
  )
}
