import { ArrowLeft, Archive } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../../../shared/components/PageHeader'
import Button from '../../../shared/components/Button'
import ProductArchivePanel from '../components/ProductArchivePanel'
import useWarehouseData from '../hooks/useWarehouseData'
import { useInventoryDistribution } from '../hooks/useTransfers'

export default function WarehouseArchivePage() {
  const navigate = useNavigate()
  const data = useWarehouseData()
  const distributionQ = useInventoryDistribution()

  return (
    <div className="animate-fade-in p-6 pb-20 lg:pb-6">
      <PageHeader
        title="Архив товаров"
        subtitle="Товары, снятые с продаж и скрытые из основного списка склада."
        icon={<Archive size={20} />}
        action={
          <Button
            variant="secondary"
            icon={<ArrowLeft size={15} />}
            onClick={() => navigate('/warehouse/inventory')}
          >
            К товарам
          </Button>
        }
      />

      <ProductArchivePanel
        products={data.products}
        inventory={data.inventory}
        distribution={distributionQ.data}
        loading={data.loading || distributionQ.isPending}
        error={data.error || distributionQ.error}
      />
    </div>
  )
}
