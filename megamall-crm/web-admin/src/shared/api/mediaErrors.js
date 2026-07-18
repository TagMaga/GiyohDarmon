// Russian translations for internal/media's validation error codes (see
// internal/media/validate.go's ValidationError.Code values) — the backend
// message itself is developer-facing English, so every code the pipeline
// can return gets a user-facing Russian equivalent here; anything
// unrecognized falls back to a generic message rather than leaking the
// English text.
const MEDIA_ERROR_MESSAGES_RU = {
  FILE_TOO_LARGE: 'Файл слишком большой.',
  UNSUPPORTED_TYPE: 'Неподдерживаемый тип файла. Разрешены JPEG, PNG и WebP.',
  CORRUPT_IMAGE: 'Файл повреждён или не является изображением.',
  IMAGE_TOO_LARGE: 'Слишком большое разрешение изображения.',
  EMPTY_FILE: 'Файл пустой.',
  SIZE_MISMATCH: 'Загрузка прервана — попробуйте ещё раз.',
  READ_FAILED: 'Не удалось прочитать файл.',
  BAD_REQUEST: 'Некорректный запрос.',
  RATE_LIMITED: 'Слишком много загрузок. Подождите немного и попробуйте снова.',
  UNAUTHORIZED: 'Необходимо войти в систему заново.',
  NOT_FOUND: 'Изображение не найдено.',
  CONFLICT: 'Это изображение уже используется в другом товаре.',
  INTERNAL_ERROR: 'Ошибка сервера при обработке изображения. Попробуйте ещё раз.',
}

const GENERIC_FALLBACK_RU = 'Не удалось загрузить изображение. Попробуйте ещё раз.'

// PIPELINE_UNAVAILABLE_RU is shown for every PRIVATE-category upload
// (avatar, order_attachment, prepayment_proof, cash_handover_proof,
// user_document) when the media pipeline is unavailable server-side. Per
// the approved security model, private categories must show a clear error
// and stop — they must NEVER silently fall back to the legacy, publicly
// readable, unauthenticated /uploads endpoint. See the 2026-07-16 P0
// incident (/root/megamall-audits/megamall-p0-stage1-containment-report-
// 20260716.md): a private order attachment already leaked through that
// exact class of unauthenticated legacy storage once. Only PUBLIC
// categories (product_image, via shared/api/mediaUpload.js's smartUpload)
// are allowed to fall back to legacy /uploads.
const PIPELINE_UNAVAILABLE_RU =
  'Загрузка защищённых файлов временно недоступна. Обратитесь к администратору.'

// translateMediaError extracts the {code, message} pair from an axios error
// response envelope and returns a Russian message — the mapped translation
// when the code is recognized, a specific "pipeline unavailable" message
// for a 404 (see isMediaPipelineUnavailable), otherwise a generic Russian
// fallback (never the raw English backend message).
export function translateMediaError(err) {
  if (isMediaPipelineUnavailable(err)) return PIPELINE_UNAVAILABLE_RU
  const code = err?.response?.data?.error?.code
  if (code && MEDIA_ERROR_MESSAGES_RU[code]) return MEDIA_ERROR_MESSAGES_RU[code]
  return GENERIC_FALLBACK_RU
}

// isMediaPipelineUnavailable reports whether an error looks like "the
// /api/v1/media route doesn't exist" — i.e. MEDIA_PIPELINE_ENABLED=false on
// the server, where the route is never registered at all (see internal/
// media/routes.go), rather than a real validation/processing failure.
//
// PRIVATE-category callers must treat this as a hard stop (translateMediaError
// above already does) — never as a signal to fall back to the legacy
// /uploads flow. Only shared/api/mediaUpload.js's smartUpload (PUBLIC
// categories only) still uses a 404 that way.
export function isMediaPipelineUnavailable(err) {
  return err?.response?.status === 404
}
