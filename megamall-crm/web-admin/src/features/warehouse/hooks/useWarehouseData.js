import { useMemo } from 'react'
import useProducts from './useProducts'
import useWarehouses from './useWarehouses'
import useInventory from './useInventory'
import useMovements from './useMovements'
import useBatches from './useBatches'
import useCategories from './useCategories'
import useSuppliers from './useSuppliers'
import {
  buildProductMap,
  buildWarehouseMap,
  getId,
  isUUID,
} from '../utils/warehouseHelpers'

export default function useWarehouseData({
  inventoryParams = {},
  movementParams = {},
  warehouseId = '',
  scopeToWarehouse = false,
} = {}) {
  const productsQ = useProducts()
  const warehousesQ = useWarehouses()
  const categoriesQ = useCategories()
  const suppliersQ = useSuppliers()

  const products = productsQ.data ?? []
  const warehouses = warehousesQ.data ?? []
  const validWarehouseIds = useMemo(
    () => new Set(warehouses.map(getId).filter(isUUID)),
    [warehouses]
  )
  const selectedWarehouseId = isUUID(warehouseId) && validWarehouseIds.has(warehouseId)
    ? warehouseId
    : ''
  const warehouseScopedParams = selectedWarehouseId ? { warehouse_id: selectedWarehouseId } : {}
  const queryEnabled = !scopeToWarehouse || (!warehousesQ.isPending && Boolean(selectedWarehouseId))
  const inventoryQ = useInventory(
    { ...warehouseScopedParams, ...inventoryParams },
    { enabled: queryEnabled }
  )
  const movementsQ = useMovements(
    { ...warehouseScopedParams, ...movementParams },
    { enabled: queryEnabled }
  )
  const batchesQ = useBatches(
    warehouseScopedParams,
    { enabled: queryEnabled }
  )

  const inventory = inventoryQ.data ?? []
  const movements = movementsQ.data ?? []
  const batches = batchesQ.data ?? []
  const categories = categoriesQ.data ?? []
  const suppliers = suppliersQ.data ?? []

  const productMap = useMemo(() => buildProductMap(products), [products])
  const warehouseMap = useMemo(() => buildWarehouseMap(warehouses), [warehouses])
  const categoryMap = useMemo(() => {
    const out = {}
    for (const c of categories) {
      const id = getId(c)
      if (id) out[id] = c
    }
    return out
  }, [categories])
  const supplierMap = useMemo(() => {
    const out = {}
    for (const s of suppliers) {
      const id = getId(s)
      if (id) out[id] = s
    }
    return out
  }, [suppliers])

  const loading = productsQ.isPending || warehousesQ.isPending || (queryEnabled && (inventoryQ.isPending || movementsQ.isPending || batchesQ.isPending))
  const error = productsQ.error || warehousesQ.error || inventoryQ.error || movementsQ.error || batchesQ.error || categoriesQ.error || suppliersQ.error

  function refetchAll() {
    productsQ.refetch()
    warehousesQ.refetch()
    inventoryQ.refetch()
    movementsQ.refetch()
    batchesQ.refetch()
    categoriesQ.refetch()
    suppliersQ.refetch()
  }

  return {
    products,
    warehouses,
    inventory,
    movements,
    batches,
    categories,
    suppliers,
    productMap,
    warehouseMap,
    categoryMap,
    supplierMap,
    selectedWarehouseId,
    hasWarehouses: warehouses.length > 0,
    warehousesLoading: warehousesQ.isPending,
    loading,
    error,
    refetchAll,
    queries: { productsQ, warehousesQ, inventoryQ, movementsQ, batchesQ, categoriesQ, suppliersQ },
  }
}
