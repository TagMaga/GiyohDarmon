import { useMemo, useState } from 'react'
import { Phone, UserCheck, UserPlus } from 'lucide-react'

const COUNTRIES = [
  { code: 'TJ', dial: '+992', digits: 9, flag: '🇹🇯', placeholder: '90 000 0000' },
  { code: 'RU', dial: '+7', digits: 10, flag: '🇷🇺', placeholder: '912 345 67 89' },
]

// Detects country + national number from a phone string regardless of spacing/plus sign.
function detectCountry(phone) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('992')) return { country: COUNTRIES[0], national: digits.slice(3) }
  if (digits.startsWith('7')) return { country: COUNTRIES[1], national: digits.slice(1) }
  return null
}

export function isValidPhone(phone) {
  const detected = detectCountry(phone)
  return !!detected && detected.national.length === detected.country.digits
}

/**
 * PhoneSearchField — phone input that searches existing customers.
 *
 * Props:
 *   phone          {string}
 *   onChange       {fn}     — (phone) => void
 *   customers      {Array}  — full customer list from useCustomers
 *   selectedId     {string|null}
 *   onSelect       {fn}     — (customer) => void  — called when user selects a match
 *   onClearSelection {fn}   — clear selected customer
 */
export default function PhoneSearchField({
  phone,
  onChange,
  customers = [],
  selectedId,
  onSelect,
  onClearSelection,
}) {
  const [touched, setTouched] = useState(false)
  const detected = detectCountry(phone)
  const country = detected?.country ?? COUNTRIES[0]
  const nationalDigits = detected?.national ?? ''
  const showError = touched && phone.trim().length > 0 && !isValidPhone(phone)

  const handleCountryChange = (e) => {
    const next = COUNTRIES.find((c) => c.code === e.target.value) ?? COUNTRIES[0]
    onChange(next.dial)
    if (selectedId) onClearSelection()
  }

  const handleDigitsChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, country.digits)
    onChange(country.dial + digits)
    if (selectedId) onClearSelection()
  }

  // Filter customers by phone substring (show results when phone >= 4 chars)
  const matches = useMemo(() => {
    const q = phone.trim().replace(/\s+/g, '')
    if (q.length < 4) return []
    return customers.filter((c) =>
      c.phone?.replace(/\s+/g, '').includes(q) ||
      (c.phone_secondary ?? '').replace(/\s+/g, '').includes(q)
    ).slice(0, 5)
  }, [phone, customers])

  const selected = selectedId ? customers.find((c) => c.id === selectedId) : null

  return (
    <div className="space-y-2">
      <label className="input-label">
        <span className="flex items-center gap-1.5">
          <Phone size={13} className="text-slate-400" />
          Телефон клиента *
        </span>
      </label>

      <div className="flex gap-2">
        <select
          value={country.code}
          onChange={handleCountryChange}
          className="input w-[92px] px-2 text-sm flex-shrink-0"
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <input
            type="tel"
            inputMode="numeric"
            value={nationalDigits}
            onChange={handleDigitsChange}
            onBlur={() => setTouched(true)}
            placeholder={country.placeholder}
            className={`input pr-10 ${
              selected ? 'border-emerald-400 ring-2 ring-emerald-500/20'
              : showError ? 'border-red-400 focus:ring-red-500/25 focus:border-red-400'
              : ''
            }`}
            autoComplete="tel"
          />
          {selected && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <UserCheck size={16} className="text-emerald-500" />
            </div>
          )}
        </div>
      </div>

      {showError && (
        <p className="text-xs text-red-500">
          Введите корректный номер — {country.digits} цифр после {country.dial}
        </p>
      )}

      {/* Selected customer badge */}
      {selected && (
        <div className="flex items-center justify-between px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2">
            <UserCheck size={14} className="text-emerald-600 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-emerald-800">{selected.full_name}</p>
              <p className="text-[10px] text-emerald-600">{selected.phone} · Существующий клиент</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-[10px] text-emerald-600 hover:text-emerald-800 font-medium underline"
          >
            Изменить
          </button>
        </div>
      )}

      {/* Matching customer cards (shown when no selection yet) */}
      {!selected && matches.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-card">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c)}
              className="w-full flex items-start gap-3 px-4 py-3 hover:bg-indigo-50
                         transition-colors border-b border-slate-100 last:border-0 text-left"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-indigo-600">
                  {c.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{c.full_name}</p>
                <p className="text-xs text-slate-500">{c.phone}</p>
                {c.city && <p className="text-[10px] text-slate-400">{c.city}</p>}
              </div>
              <span className="ml-auto text-xs text-indigo-600 font-medium flex-shrink-0 mt-1">
                Выбрать
              </span>
            </button>
          ))}
        </div>
      )}

      {/* No match hint */}
      {!selected && phone.trim().length >= 4 && matches.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
          <UserPlus size={13} className="text-slate-400 flex-shrink-0" />
          <p className="text-xs text-slate-500">
            Клиент не найден — будет создан автоматически при оформлении
          </p>
        </div>
      )}
    </div>
  )
}
