import { useMemo } from 'react'
import useProducts from './useProducts'
import useInventory from './useInventory'
import useMovements from './useMovements'
import useBatches from './useBatches'
import useSuppliers from './useSuppliers'
import { buildProductMap, getId } from '../utils/warehouseHelpers'

export default function useWarehouseData({
  inventoryParams = {},
  movementParams = {},
} = {}) {
  const productsQ = useProducts()
  const suppliersQ = useSuppliers()

  const products = productsQ.data ?? []

  const inventoryQ = useInventory(inventoryParams)
  const movementsQ = useMovements(movementParams)
  const batchesQ = useBatches()

  const inventory = inventoryQ.data ?? []
  const movements = movementsQ.data ?? []
  const batches = batchesQ.data ?? []
  const suppliers = suppliersQ.data ?? []

  const productMap = useMemo(() => buildProductMap(products), [products])
  const supplierMap = useMemo(() => {
    const out = {}
    for (const s of suppliers) {
      const id = getId(s)
      if (id) out[id] = s
    }
    return out
  }, [suppliers])

  const loading = productsQ.isPending || inventoryQ.isPending || movementsQ.isPending || batchesQ.isPending
  const error = productsQ.error || inventoryQ.error || movementsQ.error || batchesQ.error || suppliersQ.error

  function refetchAll() {
    productsQ.refetch()
    inventoryQ.refetch()
    movementsQ.refetch()
    batchesQ.refetch()
    suppliersQ.refetch()
  }

  return {
    products,
    inventory,
    movements,
    batches,
    suppliers,
    productMap,
    supplierMap,
    loading,
    error,
    refetchAll,
    queries: { productsQ, inventoryQ, movementsQ, batchesQ, suppliersQ },
  }
}
