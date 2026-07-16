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

// translateMediaError extracts the {code, message} pair from an axios error
// response envelope and returns a Russian message — the mapped translation
// when the code is recognized, otherwise a generic Russian fallback (never
// the raw English backend message).
export function translateMediaError(err) {
  const code = err?.response?.data?.error?.code
  if (code && MEDIA_ERROR_MESSAGES_RU[code]) return MEDIA_ERROR_MESSAGES_RU[code]
  return GENERIC_FALLBACK_RU
}

// isMediaPipelineUnavailable reports whether an error looks like "the
// /api/v1/media route doesn't exist" — i.e. MEDIA_PIPELINE_ENABLED=false on
// the server, where the route is never registered at all (see internal/
// media/routes.go), rather than a real validation/processing failure.
// Callers use this to fall back to the legacy /uploads flow transparently.
export function isMediaPipelineUnavailable(err) {
  return err?.response?.status === 404
}
