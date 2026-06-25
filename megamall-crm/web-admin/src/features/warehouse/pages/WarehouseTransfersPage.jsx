import { useState } from 'react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import TransferModal from '../components/TransferModal'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import { getMovementType } from '../utils/warehouseHelpers'

export default function WarehouseTransfersPage() {
  const data = useWarehouseData()
  const [open, setOpen] = useState(false)
  const rows = data.movements.filter((m) => {
    const type = getMovementType(m)
    return type === 'transfer_in' || type === 'transfer_out'
  })

  return (
    <div className="animate-fade-in p-6">
      <PageHeader
        title="Перемещения"
        subtitle="Переносите остатки между складами с понятным источником и получателем."
        icon={<ArrowLeftRight size={20} />}
        action={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>Новое перемещение</Button>}
      />
      <MovementList rows={rows} data={data} emptyTitle="Перемещений пока нет" />
      <TransferModal open={open} onClose={() => setOpen(false)} products={data.products} warehouses={data.warehouses} inventory={data.inventory} />
    </div>
  )
}
