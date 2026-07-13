import { useEffect, useId, useState } from 'react'

/**
 * DateInput — typeable, masked date field. Displays/accepts DD.MM.YYYY,
 * stores/emits the backend's ISO YYYY-MM-DD.
 *
 * Only calls onChange for a value the field owner should actually persist:
 * a fully valid calendar date, or an empty string (field cleared). While the
 * user is mid-typing an incomplete or currently-invalid date, onChange is
 * not called — the last known-good value stays as the source of truth, and
 * an inline error explains what's wrong instead.
 *
 * Props:
 *   value       {string}   ISO 'YYYY-MM-DD' or '' — the stored value
 *   onChange    {fn}       (isoValue: string) => void
 *   label       {string}   optional — rendered via <label>, tied to the
 *                           input via a generated id (or `id` if passed)
 *   required    {bool}
 *   disabled    {bool}
 *   id          {string}
 *   className   {string}   input classes (default matches the app's `.input`)
 *   onValidityChange {fn}  optional (isValid: bool) => void — for forms that
 *                           want to gate submit on "no unresolved bad dates"
 */
function isoToDisplay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return ''
  const [, y, mo, d] = m
  return `${d}.${mo}.${y}`
}

function digitsToDisplay(digits) {
  let out = digits.slice(0, 2)
  if (digits.length > 2) out += '.' + digits.slice(2, 4)
  if (digits.length > 4) out += '.' + digits.slice(4, 8)
  return out
}

function isRealCalendarDate(day, month, year) {
  if (year < 1900 || year > 2100) return false
  if (month < 1 || month > 12) return false
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

export default function DateInput({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  id,
  className = 'input',
  onValidityChange,
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  const [draft, setDraft] = useState(() => isoToDisplay(value))
  const [error, setError] = useState('')

  // Reset the draft when the stored ISO value changes externally (e.g. data
  // loaded, or our own onChange round-tripped a newly-valid date back in).
  // Never fires mid-typing, since onChange only fires for valid/empty input.
  useEffect(() => {
    setDraft(isoToDisplay(value))
    setError('')
  }, [value])

  function handleChange(e) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    setDraft(digitsToDisplay(digits))

    if (digits.length === 0) {
      setError('')
      onChange('')
      onValidityChange?.(true)
      return
    }
    if (digits.length < 8) {
      setError('')
      onValidityChange?.(false)
      return
    }
    const day = parseInt(digits.slice(0, 2), 10)
    const month = parseInt(digits.slice(2, 4), 10)
    const year = parseInt(digits.slice(4, 8), 10)
    if (!isRealCalendarDate(day, month, year)) {
      setError('Некорректная дата')
      onValidityChange?.(false)
      return
    }
    setError('')
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    onValidityChange?.(true)
  }

  function handleBlur() {
    if (!draft) {
      if (required) { setError('Обязательное поле'); onValidityChange?.(false) }
      return
    }
    const digitCount = draft.replace(/\D/g, '').length
    if (digitCount < 8) {
      setError('Введите полную дату')
      onValidityChange?.(false)
    }
  }

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder="дд.мм.гггг"
        disabled={disabled}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={label ? `${className} mt-1` : className}
      />
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
