import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import WriteoffModal from '../components/WriteoffModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import { getMovementType } from '../utils/warehouseHelpers'

export default function WarehouseWriteoffsPage() {
  const data = useWarehouseData()
  const [open, setOpen] = useState(false)
  const rows = data.movements.filter((m) => getMovementType(m) === 'writeoff')
  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Списания"
        subtitle="Брак, потери, просрочка и корректировки остатков."
        icon={<Trash2 size={20} />}
        action={<Button variant="danger" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Новое списание</Button>}
      />
      <MovementList rows={rows} data={data} emptyTitle="Списаний пока нет" />
      <WriteoffModal open={open} onClose={() => setOpen(false)} products={data.products} inventory={data.inventory} />
    </div>
  )
}
