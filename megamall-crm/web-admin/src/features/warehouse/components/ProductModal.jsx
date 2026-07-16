import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, X } from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import Button from '../../../shared/components/Button'
import Alert from '../../../shared/components/Alert'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS } from '../../../shared/queryKeys'
import { translateMediaError } from '../../../shared/api/mediaErrors'
import { addProductImage, createProduct, updateProduct, uploadProductImageSmart } from '../api'
import {
  getId,
  getProductImage,
  getProductImageVariant,
  getProductName,
  getProductSku,
  getPurchasePrice,
  getSalePrice,
} from '../utils/warehouseHelpers'

const emptyForm = {
  name: '',
  sku: '',
  purchase_price: '',
  sale_price: '',
  image_url: '',
}

export default function ProductModal({ open, onClose, product, suppliers = [] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const isEdit = Boolean(product)
  const [form, setForm] = useState(emptyForm)
  const [imagePreview, setImagePreview] = useState(null) // local blob URL or existing URL
  // Upload state for the currently-picked file, if any — the file uploads
  // immediately on selection (not on form submit), so its progress/result/
  // error can be shown inline before the user even clicks Save.
  const [uploadProgress, setUploadProgress] = useState(null) // 0-100, or null when idle
  const [uploadError, setUploadError] = useState(null)       // Russian message, or null
  const [uploadResult, setUploadResult] = useState(null)     // { kind: 'media', asset } | { kind: 'legacy', url } | null
  const fileRef = useRef()

  useEffect(() => {
    if (!open) return
    if (!product) {
      setForm(emptyForm)
      setImagePreview(null)
      resetUpload()
      return
    }
    const existingImage = getProductImage(product)
    setForm({
      name: getProductName(product) === '—' ? '' : getProductName(product),
      sku: getProductSku(product) === '—' ? '' : getProductSku(product),
      purchase_price: getPurchasePrice(product) ?? '',
      sale_price: getSalePrice(product) ?? '',
      image_url: existingImage ?? '',
    })
    // Detail variant for the edit-form preview when available — falls back
    // to the legacy single URL automatically (see getProductImageVariant).
    setImagePreview(getProductImageVariant(product, 'detail') || null)
    resetUpload()
  }, [open, product])

  function resetUpload() {
    setUploadProgress(null)
    setUploadError(null)
    setUploadResult(null)
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // reset input so the same file can be re-selected
    if (!file) return

    setImagePreview(URL.createObjectURL(file))
    setUploadError(null)
    setUploadResult(null)
    setUploadProgress(0)

    try {
      const result = await uploadProductImageSmart(file, { onProgress: setUploadProgress })
      setUploadResult(result)
      if (result.kind === 'media') {
        // Prefer the server-processed card variant for the preview once
        // it's ready — more accurate than the local blob URL (shows the
        // actual crop/orientation/strip result).
        const cardUrl = result.asset?.variants?.find((v) => v.variant === 'card')?.url
        if (cardUrl) setImagePreview(cardUrl)
      }
    } catch (err) {
      setUploadError(translateMediaError(err))
      setUploadProgress(null)
    }
  }

  function removeImage() {
    // Only clears the pending local selection/preview — never deletes an
    // already-saved image on the server (this modal has no delete-image
    // affordance; that matches its pre-Phase-2 behavior). If the user had
    // just uploaded a new file via the media pipeline and then removes it
    // before saving, that asset is simply never attached to anything —
    // internal/media's quarantine-purge job reclaims genuinely orphaned
    // uploads on its own retention schedule, so no extra cleanup is needed
    // here.
    resetUpload()
    setImagePreview(isEdit ? (getProductImageVariant(product, 'detail') || null) : null)
    setForm(prev => ({ ...prev, image_url: isEdit ? (getProductImage(product) ?? '') : '' }))
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
      }
      if (isEdit) payload.sku = form.sku.trim()
      if (form.purchase_price !== '') payload.purchase_price = Number(form.purchase_price)
      if (form.sale_price !== '')     payload.sale_price     = Number(form.sale_price)

      // A newly uploaded image via the media pipeline is attached
      // atomically as part of create/update itself (the backend handles
      // rollback/quarantine on failure — see internal/products/service.go).
      if (uploadResult?.kind === 'media') {
        payload.primary_image_media_asset_id = uploadResult.asset.id
      }

      const saved = isEdit
        ? await updateProduct(getId(product), payload)
        : await createProduct(payload)

      const productId = getId(saved) ?? getId(product)

      // Legacy fallback path (media pipeline disabled on the server):
      // attach via the pre-Phase-2 image_url endpoint, unchanged from
      // before this phase.
      if (productId && uploadResult?.kind === 'legacy') {
        await addProductImage(productId, { image_url: uploadResult.url, is_primary: true, sort_order: 0 })
      }

      return saved
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.warehouse.products })
      toast.success(isEdit ? 'Товар обновлён' : 'Товар создан')
      onClose()
    },
  })

  function setField(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const errMsg = mutation.error?.response?.data?.error?.message ?? mutation.error?.message
  const isUploading = uploadProgress !== null && uploadProgress < 100 && !uploadError && !uploadResult
  const canSubmit = form.name.trim() && (!isEdit || form.sku.trim()) && !isUploading

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Редактировать товар' : 'Добавить товар'}
      description="Карточка товара для склада и продаж"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutation.isPending}>Отмена</Button>
          <Button variant="primary" onClick={() => canSubmit && mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            {isEdit ? 'Сохранить' : 'Создать товар'}
          </Button>
        </>
      }
    >
      {errMsg && <Alert variant="error" title="Ошибка" className="mb-4">{errMsg}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Название *" value={form.name} onChange={v => setField('name', v)} placeholder="Например, Пахлавон" />
        {isEdit && (
          <Field label="SKU *" value={form.sku} onChange={v => setField('sku', v)} placeholder="P-001" />
        )}
        <Field label="Закупочная цена" type="number" min="0" value={form.purchase_price} onChange={v => setField('purchase_price', v)} placeholder="0" />
        <Field label="Цена продажи" type="number" min="0" value={form.sale_price} onChange={v => setField('sale_price', v)} placeholder="0" />
      </div>

      {/* Photo upload */}
      <div className="mt-4">
        <span className="input-label block mb-1.5">Фото товара</span>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {imagePreview ? (
          <div className="relative w-32 h-32 rounded-2xl overflow-hidden border border-slate-200 group">
            <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
            {isUploading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/50">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/30">
                  <div
                    className="h-full rounded-full bg-white transition-[width] duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-medium text-white">{uploadProgress}%</span>
              </div>
            )}
            <button
              onClick={removeImage}
              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 w-32 h-32 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
          >
            <ImagePlus size={24} />
            <span className="text-[11px] font-medium">Загрузить</span>
          </button>
        )}
        {uploadError && (
          <p className="mt-2 text-[12px] font-medium text-rose-600">{uploadError}</p>
        )}
        {imagePreview && !isUploading && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-2 text-[11.5px] text-indigo-500 hover:underline"
          >
            Заменить фото
          </button>
        )}
      </div>
    </Modal>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder, min }) {
  return (
    <label>
      <span className="input-label">{label}</span>
      <input
        className="input"
        type={type}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}
