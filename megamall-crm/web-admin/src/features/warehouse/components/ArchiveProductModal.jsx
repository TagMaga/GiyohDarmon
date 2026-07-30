import { Archive, AlertTriangle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { updateProduct } from '../api'
import { aggregateStocks } from './InventoryFilters'
import { getId, getProductName, getProductSku } from '../utils/warehouseHelpers'

export default function ArchiveProductModal({ product, stocks = [], onClose }) {
  const qc = useQueryClient()
  const toast = useToast()
  const metrics = aggregateStocks(stocks)
  const hasStock = metrics.quantity > 0 || metrics.reserved > 0 || metrics.blocked > 0

  const mutation = useMutation({
    mutationFn: () => updateProduct(getId(product), { is_active: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      qc.invalidateQueries({ queryKey: KEYS.seller.products })
      toast.success('Товар перемещён в архив')
      onClose()
    },
  })

  const errMsg = mutation.error?.response?.data?.error?.message ?? mutation.error?.message

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title="Переместить товар в архив?"
      description="Архивирование можно отменить в любой момент."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Отмена</Button>
          <Button
            variant="danger"
            icon={<Archive size={15} />}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            В архив
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Не удалось архивировать" className="mb-4">{errMsg}</Alert>}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="font-bold text-slate-950">{getProductName(product)}</p>
        <p className="mt-0.5 font-mono text-xs text-slate-400">{getProductSku(product)}</p>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-slate-600">
        Товар исчезнет из основного списка склада и из выбора при создании новых заказов.
        История, остатки, движения и фотографии сохранятся.
      </p>

      {hasStock && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle size={17} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold">У товара есть складские остатки</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Всего: {metrics.quantity} шт.; главный склад: {metrics.mainQuantity} шт.;
                у курьеров: {metrics.courierQuantity} шт.; резерв: {metrics.reserved} шт.;
                в передаче: {metrics.blocked} шт.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Остатки не удалятся и будут видны в разделе «Архив».
              </p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
