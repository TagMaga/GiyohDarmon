import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftRight, Building2, Download, PackagePlus, Plus, Trash2, Truck } from 'lucide-react'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import ReceivingModal from '../components/ReceivingModal'
import WriteoffModal from '../components/WriteoffModal'
import { LostReportsPanel, NewTransferModal, PendingReturnsPanel } from '../components/TransferComponents'
import useWarehouseData from '../hooks/useWarehouseData'
import { MovementList } from './WarehouseMovementsPage'
import { getMovementType, isProductActive } from '../utils/warehouseHelpers'

const INK = '#0B1020'
const MUTED = '#8A91A3'
const GRADIENT = 'linear-gradient(135deg, #4F46E5, #6D28D9)'
const CARD_SHADOW = '0 2px 8px rgba(15,23,42,.05)'

export default function WarehouseReceivingPage() {
  const navigate = useNavigate()
  const data = useWarehouseData()
  const [receivingOpen, setReceivingOpen] = useState(false)
  const [writeoffOpen, setWriteoffOpen] = useState(false)
  const [showNewTransfer, setShowNewTransfer] = useState(false)
  const activeProducts = useMemo(() => data.products.filter(isProductActive), [data.products])
  const rows = data.movements.filter((m) => {
    const type = getMovementType(m)
    return type === 'purchase' || type === 'adjustment' || type === 'writeoff' || type === 'sale'
  })

  return (
    <>
    <div className="space-y-4 p-4 pb-8 lg:hidden" style={{ background: '#F4F5F9' }}>
      <div>
        <h1 className="text-[22px] font-extrabold leading-none tracking-tight" style={{ color: INK, letterSpacing: '-0.5px' }}>Приёмка</h1>
        <p className="mt-1 text-[12.5px] font-medium" style={{ color: MUTED }}>Поступления, списания и корректировки</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => setReceivingOpen(true)}
          className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[18px] text-white"
          style={{ background: GRADIENT, boxShadow: '0 8px 20px rgba(79,70,229,.3)' }}
        >
          <PackagePlus size={18} /><span className="text-[11.5px] font-bold">Новая приёмка</span>
        </button>
        <button onClick={() => setWriteoffOpen(true)} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[18px] bg-white text-slate-700" style={{ boxShadow: CARD_SHADOW }}>
          <Trash2 size={18} className="text-rose-600" /><span className="text-[11.5px] font-bold">Новое списание</span>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button onClick={() => navigate('/warehouse/pharmacies')} className="flex min-h-[46px] items-center justify-center gap-2 rounded-[15px] bg-white text-[13px] font-bold text-slate-700" style={{ boxShadow: CARD_SHADOW }}>
          <Building2 size={16} />Выдать аптеке
        </button>
        <button onClick={() => setShowNewTransfer(true)} className="flex min-h-[46px] items-center justify-center gap-2 rounded-[15px] bg-white text-[13px] font-bold text-slate-700" style={{ boxShadow: CARD_SHADOW }}>
          <ArrowLeftRight size={16} />Новая передача
        </button>
      </div>

      <div>
        <p className="mb-2.5 text-[16px] font-extrabold" style={{ color: INK }}>Операции</p>
        <MovementList rows={rows} data={data} emptyTitle="Операций пока нет" showEntryActions />
      </div>
      <div className="space-y-4">
        <PendingReturnsPanel />
        <LostReportsPanel />
      </div>
    </div>

    <div className="hidden animate-fade-in p-6 lg:block">
      <PageHeader
        title="Приёмка и списания"
        subtitle="Поступления, списания и корректировки склада в одной ленте."
        icon={<Download size={20} />}
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" icon={<Building2 size={15} />} onClick={() => navigate('/warehouse/pharmacies')}>Выдать аптеке</Button>
            <Button variant="secondary" icon={<Truck size={15} />} onClick={() => setShowNewTransfer(true)}>Новая передача</Button>
            <Button variant="primary" icon={<PackagePlus size={15} />} onClick={() => setReceivingOpen(true)}>Новая приёмка</Button>
            <Button variant="danger" icon={<Plus size={15} />} onClick={() => setWriteoffOpen(true)}>Новое списание</Button>
          </div>
        }
      />
      <MovementList rows={rows} data={data} emptyTitle="Операций пока нет" showEntryActions />
      <div className="mt-5 space-y-4">
        <PendingReturnsPanel />
        <LostReportsPanel />
      </div>
    </div>

      <ReceivingModal open={receivingOpen} onClose={() => setReceivingOpen(false)} products={activeProducts} inventory={data.inventory} />
      <WriteoffModal open={writeoffOpen} onClose={() => setWriteoffOpen(false)} products={activeProducts} inventory={data.inventory} />
      <NewTransferModal open={showNewTransfer} onClose={() => setShowNewTransfer(false)} products={activeProducts} />
    </>
  )
}
