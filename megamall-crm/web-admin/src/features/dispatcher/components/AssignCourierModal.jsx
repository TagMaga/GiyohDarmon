import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { X, Truck, Wallet } from 'lucide-react'
import { useToast } from '../../../shared/components/ToastProvider'
import { assignCourier, reassignCourier, fetchCouriersOverview } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { getOrderId, formatOrderLabel } from '../utils/orderHelpers'
import { fmt } from '../statusConfig'

/**
 * AssignCourierModal — courier picker.
 * Renders as a bottom sheet on all viewport sizes for touch-friendly UX.
 * Couriers are displayed as tappable cards (not a <select>).
 */
export default function AssignCourierModal({ open, onClose, order, mode = 'assign' }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [courierId, setCourierId] = useState('')
  const [note,      setNote]      = useState('')
  const [showNote,  setShowNote]  = useState(false)

  const { data: couriersData, isPending: couriersLoading } = useQuery({
    queryKey: KEYS.dispatcher.couriers,
    queryFn:  fetchCouriersOverview,
    enabled:  open,
    staleTime: 5 * 60_000,
  })

  const couriers = Array.isArray(couriersData)
    ? couriersData
    : (couriersData?.couriers ?? couriersData?.data ?? [])
  const intakeEnabledCouriers = useMemo(
    () => couriers.filter((c) => c.order_intake_enabled !== false),
    [couriers],
  )

  // Auto-select the only courier when assigning
  useEffect(() => {
    if (mode === 'assign' && intakeEnabledCouriers.length === 1 && !courierId) {
      setCourierId(intakeEnabledCouriers[0].courier_id ?? intakeEnabledCouriers[0].id ?? '')
    }
  }, [intakeEnabledCouriers, mode, courierId])

  // Reset on close
  useEffect(() => {
    if (!open) { setCourierId(''); setNote(''); setShowNote(false) }
  }, [open])

  const mutFn = mode === 'reassign' ? reassignCourier : assignCourier
  const title = mode === 'reassign' ? 'Переназначить курьера' : 'Назначить курьера'

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      const orderId = getOrderId(order)
      if (!orderId) throw new Error('ID заказа не найден')
      return mutFn(orderId, { courier_id: courierId, note })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
      toast.success(mode === 'reassign' ? 'Курьер переназначен' : 'Курьер назначен')
      handleClose()
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error?.message ?? err?.message ?? 'Ошибка')
    },
  })

  function handleClose() {
    reset()
    setCourierId('')
    setNote('')
    setShowNote(false)
    onClose()
  }

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px] animate-fade-in" onClick={handleClose} />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg mx-auto rounded-t-2xl overflow-hidden flex flex-col animate-slide-in-up"
        style={{
          background: '#FFFFFF',
          border: '1px solid #EAE8E2',
          maxHeight: '88vh',
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: '#E4E2DC' }} />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: '1px solid #EAE8E2' }}
        >
          <div>
            <p className="text-sm font-bold text-[#1C1C1A]">{title}</p>
            {order && (
              <p className="text-[11px] text-[#A3A39A] mt-0.5">
                Заказ #{formatOrderLabel(order)}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-[#F0EFEA] text-[#A3A39A] hover:text-[#1C1C1A] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Single-courier hint */}
        {mode === 'assign' && intakeEnabledCouriers.length === 1 && !couriersLoading && (
          <div className="mx-4 mt-3 flex-shrink-0 px-3 py-2 rounded-lg text-xs text-[#B45309]" style={{ background: '#FBEFD6', border: '1px solid #F3DCB2' }}>
            Единственный доступный курьер выбран автоматически
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mx-4 mt-3 flex-shrink-0 px-3 py-2 rounded-lg text-xs text-[#BE123C]" style={{ background: '#FDE7EC', border: '1px solid #F4C9D4' }}>
            {error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка'}
          </div>
        )}

        {/* Courier list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
          {couriersLoading && (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: '#F0EFEA' }} />
            ))
          )}
          {!couriersLoading && couriers.length === 0 && (
            <div className="py-8 text-center">
              <Truck size={24} className="text-[#D6D3CB] mx-auto mb-2" />
              <p className="text-sm text-[#A3A39A]">Нет доступных курьеров</p>
            </div>
          )}
          {!couriersLoading && couriers.map((c) => {
            const id      = c.courier_id ?? c.id
            const name    = c.full_name ?? c.courier?.full_name ?? 'Курьер'
            const phone   = c.phone ?? c.courier?.phone ?? ''
            const load    = c.active_orders ?? 0
            const cash    = c.cash_owed ?? 0
            const intakeEnabled = c.order_intake_enabled !== false
            const sel     = courierId === id

            return (
              <button
                key={id}
                onClick={() => intakeEnabled && setCourierId(id)}
                disabled={!intakeEnabled}
                className="w-full text-left rounded-xl px-3 py-2.5 transition-all"
                style={{
                  background: sel ? '#EEF0FF' : intakeEnabled ? '#FBFAF7' : '#FEF3F5',
                  border: `1px solid ${sel ? '#6366f1' : intakeEnabled ? '#EAE8E2' : '#F4C9D4'}`,
                  boxShadow: sel ? '0 0 0 1px rgba(99,102,241,0.25)' : undefined,
                  opacity: intakeEnabled ? 1 : 0.72,
                  cursor: intakeEnabled ? 'pointer' : 'not-allowed',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0"
                    style={{
                      background: sel ? '#E7E5FB' : '#F0EFEA',
                      color: sel ? '#4338CA' : '#A3A39A',
                    }}
                  >
                    {name[0]?.toUpperCase() ?? '?'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#1C1C1A] truncate">{name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {phone && (
                        <span className="text-[10px] text-[#A3A39A] font-mono">{phone}</span>
                      )}
                      {load > 0 && (
                        <span className="text-[10px] text-[#B45309]">
                          <Truck size={8} className="inline mr-0.5" />{load} акт.
                        </span>
                      )}
                      {cash > 0 && (
                        <span className="text-[10px] text-[#047857]">
                          <Wallet size={8} className="inline mr-0.5" />{fmt(cash)} сом
                        </span>
                      )}
                      {!intakeEnabled && (
                        <span className="text-[10px] text-[#BE123C]">Приём заказов выключен</span>
                      )}
                    </div>
                  </div>

                  {/* Radio circle */}
                  <div
                    className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
                    style={{ borderColor: sel ? '#6366f1' : '#D6D3CB' }}
                  >
                    {sel && <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#6366f1' }} />}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Note (collapsible) */}
        <div className="flex-shrink-0 px-4 pb-2">
          {!showNote ? (
            <button
              onClick={() => setShowNote(true)}
              className="text-xs text-[#A3A39A] hover:text-[#1C1C1A] transition-colors py-1"
            >
              + Добавить заметку для курьера
            </button>
          ) : (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Инструкции для курьера…"
              rows={2}
              className="w-full resize-none text-xs text-[#1C1C1A] placeholder-[#A3A39A] rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/40"
              style={{ background: '#FBFAF7', border: '1px solid #EAE8E2' }}
            />
          )}
        </div>

        {/* Footer actions */}
        <div
          className="flex-shrink-0 flex gap-2.5 px-4 pb-8 pt-2"
          style={{ borderTop: '1px solid #EAE8E2' }}
        >
          <button
            onClick={handleClose}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-[#76766E] transition-colors hover:bg-[#F0EFEA]"
            style={{ border: '1px solid #EAE8E2' }}
          >
            Отмена
          </button>
          <button
            onClick={() => courierId && mutate()}
            disabled={!courierId || isPending}
            className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: courierId ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'rgba(99,102,241,0.3)' }}
          >
            {isPending ? 'Назначаем…' : mode === 'reassign' ? 'Переназначить' : 'Назначить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
