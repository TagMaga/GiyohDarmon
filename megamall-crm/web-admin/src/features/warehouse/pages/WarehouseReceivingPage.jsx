import { useState } from 'react'
import { Download, PackagePlus, Plus, Trash2 } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import { getMovementType } from '../utils/warehouseHelpers'

export default function WarehouseReceivingPage() {
  const data = useWarehouseData()
  const [receivingOpen, setReceivingOpen] = useState(false)
  const [writeoffOpen, setWriteoffOpen] = useState(false)
  const rows = data.movements.filter((m) => {
    const type = getMovementType(m)
    return type === 'purchase' || type === 'adjustment' || type === 'writeoff'
  })

  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Приёмка и списания"
        subtitle="Поступления, списания и корректировки склада в одной ленте."
        icon={<Download size={20} />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setReceivingOpen(true)}>Новая приёмка</Button>
            <Button variant="danger" icon={<Plus size={15} />} onClick={() => setWriteoffOpen(true)}>Новое списание</Button>
          </div>
        }
      />
      <section className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-bold text-emerald-900">Приёмка</p>
          <p className="mt-1 text-xs text-emerald-800">Создаёт FIFO-партию с фиксированной закупочной ценой.</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-bold text-rose-900">Списания</p>
          <p className="mt-1 text-xs text-rose-800">Уменьшают доступный остаток и расходуют старые партии.</p>
        </div>
      </section>
      <MovementList rows={rows} data={data} emptyTitle="Операций пока нет" />
      <ReceivingModal open={receivingOpen} onClose={() => setReceivingOpen(false)} products={data.products} inventory={data.inventory} />
      <WriteoffModal open={writeoffOpen} onClose={() => setWriteoffOpen(false)} products={data.products} inventory={data.inventory} />
    </div>
  )
}
