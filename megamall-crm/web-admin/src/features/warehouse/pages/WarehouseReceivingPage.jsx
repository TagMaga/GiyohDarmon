import { useState } from 'react'
import { Download, PackagePlus } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import ReceivingModal from '../components/ReceivingModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import { getMovementType } from '../utils/warehouseHelpers'

export default function WarehouseReceivingPage() {
  const data = useWarehouseData()
  const [open, setOpen] = useState(false)
  const receivingRows = data.movements.filter((m) => {
    const type = getMovementType(m)
    return type === 'purchase' || type === 'adjustment'
  })

  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Приёмка"
        subtitle="Проводите приход по полученному количеству, а не вручную по итоговому остатку."
        icon={<Download size={20} />}
        action={<Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setOpen(true)}>Новый приход</Button>}
      />
      <section className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-bold text-emerald-900">Приход по количеству</p>
        <p className="mt-1 text-xs text-emerald-800">Введите фактически полученное количество. Остаток пересчитается автоматически.</p>
      </section>
      <MovementList rows={receivingRows} data={data} emptyTitle="Приходов пока нет" />
      <ReceivingModal open={open} onClose={() => setOpen(false)} products={data.products} warehouses={data.warehouses} inventory={data.inventory} />
    </div>
  )
}
