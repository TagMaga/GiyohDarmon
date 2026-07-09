// ── Defensive field accessors ──────────────────────────────────────────────────

export function getId(obj) {
  if (!obj) return null
  return obj.id ?? obj.ID ?? null
}

export function isUUID(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function getValidId(obj) {
  const id = getId(obj)
  return isUUID(id) ? id : null
}

export function getProductId(obj) {
  if (!obj) return null
  return obj.product_id ?? obj.ProductID ?? null
}

export function getQuantity(obj) {
  if (!obj) return 0
  return obj.quantity ?? obj.Quantity ?? 0
}

export function getAvailableQty(obj) {
  if (!obj) return 0
  return obj.available_quantity ?? obj.AvailableQuantity ?? getQuantity(obj)
}

export function getReservedQty(obj) {
  if (!obj) return 0
  return obj.reserved_quantity ?? obj.ReservedQuantity ?? 0
}

export function isLowStock(obj) {
  if (!obj) return false
  return obj.is_low_stock ?? obj.IsLowStock ?? false
}

export function isOutOfStock(obj) {
  if (!obj) return false
  return (obj.quantity ?? obj.Quantity ?? 0) <= 0
}

export function getStockStatus(inv) {
  if (!inv) return 'unknown'
  const qty = inv.quantity ?? inv.Quantity ?? 0
  if (qty <= 0) return 'out_of_stock'
  if (inv.is_low_stock ?? inv.IsLowStock ?? false) return 'low_stock'
  return 'in_stock'
}

export const STOCK_STATUS_LABEL = {
  in_stock:    'В наличии',
  low_stock:   'Мало',
  out_of_stock:'Нет в наличии',
  unknown:     '—',
}

export const STOCK_STATUS_BADGE = {
  in_stock:    'emerald',
  low_stock:   'amber',
  out_of_stock:'rose',
  unknown:     'slate',
}

// ── Product helpers ────────────────────────────────────────────────────────────

export function getProductName(p) {
  if (!p) return '—'
  return p.name ?? p.Name ?? '—'
}

export function getProductSku(p) {
  if (!p) return '—'
  return p.sku ?? p.SKU ?? '—'
}

export function getProductBarcode(p) {
  if (!p) return '—'
  return p.barcode ?? p.Barcode ?? '—'
}

export function getProductSupplierId(p) {
  if (!p) return null
  return p.supplier_id ?? p.SupplierID ?? null
}

export function getProductImage(p) {
  if (!p) return null
  const direct = p.product_image_url ?? p.ProductImageURL ?? p.image_url ?? p.ImageURL ?? p.image ?? p.Image
  if (direct) return direct
  const images = Array.isArray(p.images) ? p.images : (Array.isArray(p.Images) ? p.Images : [])
  const primary = images.find((img) => img.is_primary ?? img.IsPrimary)
  const image = primary ?? images[0]
  return image?.image_url ?? image?.ImageURL ?? image?.url ?? image?.URL ?? null
}

export function getSupplierName(supplier) {
  if (!supplier) return '—'
  return supplier.name ?? supplier.Name ?? '—'
}

export function getSalePrice(p) {
  if (!p) return null
  return p.sale_price ?? p.SalePrice ?? null
}

export function getPurchasePrice(p) {
  if (!p) return null
  return p.purchase_price ?? p.PurchasePrice ?? null
}

export function isProductActive(p) {
  if (!p) return false
  return p.is_active ?? p.IsActive ?? false
}

export function getLastMovementForProduct(productId, movements = []) {
  return movements.find((m) => {
    const pid = m.product_id ?? m.ProductID
    return pid === productId
  }) ?? null
}

// ── Movement helpers ───────────────────────────────────────────────────────────

export const MOVEMENT_LABEL = {
  purchase:     'Приход',
  sale:         'Продажа',
  return:       'Возврат',
  transfer_in:  'Перемещение (+)',
  transfer_out: 'Перемещение (−)',
  adjustment:   'Корректировка',
  writeoff:     'Списание',
}

export const MOVEMENT_BADGE = {
  purchase:     'emerald',
  sale:         'sky',
  return:       'violet',
  transfer_in:  'indigo',
  transfer_out: 'orange',
  adjustment:   'amber',
  writeoff:     'rose',
}

export function getMovementType(m) {
  return m?.movement_type ?? m?.MovementType ?? null
}

// ── Formatters ─────────────────────────────────────────────────────────────────

const currFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export function fmtMoney(n) {
  const num = Number(n)
  return Number.isNaN(num) ? '—' : `${currFmt.format(num)} с`
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
})
export function fmtDate(iso) {
  if (!iso) return '—'
  try { return dateFmt.format(new Date(iso)) } catch { return iso }
}

// ── Build lookup maps ──────────────────────────────────────────────────────────

/** Build { id → product } map from products array */
export function buildProductMap(products) {
  const map = {}
  for (const p of (products ?? [])) {
    const id = getId(p)
    if (id) map[id] = p
  }
  return map
}
