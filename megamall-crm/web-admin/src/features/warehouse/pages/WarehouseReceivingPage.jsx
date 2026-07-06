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
      <MovementList rows={rows} data={data} emptyTitle="Операций пока нет" showEntryActions onlyLatestEntryEditable />
      <ReceivingModal open={receivingOpen} onClose={() => setReceivingOpen(false)} products={data.products} inventory={data.inventory} />
      <WriteoffModal open={writeoffOpen} onClose={() => setWriteoffOpen(false)} products={data.products} inventory={data.inventory} />
    </div>
  )
}
