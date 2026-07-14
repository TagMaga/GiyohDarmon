// Downscales/re-encodes an image file client-side before upload so phone-camera
// photos (often several MB) don't blow past the upload timeout on slow mobile
// connections. Falls back to the original file if anything goes wrong.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.8
const SKIP_BELOW_BYTES = 300 * 1024 // not worth re-encoding small files

export async function compressImage(file) {
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (file.size <= SKIP_BELOW_BYTES) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file

    const newName = file.name.replace(/\.\w+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
