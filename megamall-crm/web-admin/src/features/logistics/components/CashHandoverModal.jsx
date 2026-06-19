/**
 * CashHandoverModal — form to record a new cash handover.
 */
import { useState } from 'react'
import Modal from '../../../shared/components/Modal'
import { useCreateHandover } from '../hooks/useHandovers'
import useLogisticsCouriers from '../hooks/useLogisticsCouriers'

export default function CashHandoverModal({ open, onClose }) {
  const { data: couriers = [] } = useLogisticsCouriers()
  const { mutate, isPending } = useCreateHandover()

  const [form, setForm] = useState({
    courier_id:          '',
    total_collected:     '',
    total_delivery_fees: '',
    total_to_return:     '',
    comment:             '',
  })
  const [err, setErr] = useState('')

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleSubmit() {
    if (!form.courier_id) { setErr('Выберите курьера'); return }
    setErr('')
    mutate(
      {
        courier_id:          form.courier_id,
        total_collected:     parseFloat(form.total_collected) || 0,
        total_delivery_fees: parseFloat(form.total_delivery_fees) || 0,
        total_to_return:     parseFloat(form.total_to_return) || 0,
        comment:             form.comment || undefined,
      },
      {
        onSuccess: () => {
          setForm({ courier_id: '', total_collected: '', total_delivery_fees: '', total_to_return: '', comment: '' })
          onClose()
        },
        onError: (e) => setErr(e?.response?.data?.error?.message ?? 'Ошибка сохранения'),
      }
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Записать передачу наличных"
      description="Новая запись будет создана со статусом «Ожидает»"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn btn-md btn-secondary">Отмена</button>
          <button onClick={handleSubmit} disabled={isPending} className="btn btn-md btn-primary">
            {isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{err}</p>}

        <div>
          <label className="input-label">Курьер *</label>
          <select
            className="input"
            value={form.courier_id}
            onChange={e => set('courier_id', e.target.value)}
          >
            <option value="">— выберите —</option>
            {couriers.map(c => (
              <option key={c.courier_id} value={c.courier_id}>{c.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="input-label">Всего собрано (сом)</label>
          <input type="number" step="0.01" placeholder="0" className="input"
            value={form.total_collected} onChange={e => set('total_collected', e.target.value)} />
        </div>

        <div>
          <label className="input-label">Тариф доставки (сом)</label>
          <input type="number" step="0.01" placeholder="0" className="input"
            value={form.total_delivery_fees} onChange={e => set('total_delivery_fees', e.target.value)} />
        </div>

        <div>
          <label className="input-label">К возврату (сом)</label>
          <input type="number" step="0.01" placeholder="0" className="input"
            value={form.total_to_return} onChange={e => set('total_to_return', e.target.value)} />
        </div>

        <div>
          <label className="input-label">Примечание</label>
          <textarea rows={2} className="input resize-none" placeholder="Необязательно…"
            value={form.comment} onChange={e => set('comment', e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
