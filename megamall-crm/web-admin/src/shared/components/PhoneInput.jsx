export const PHONE_COUNTRIES = [
  { code: 'TJ', dial: '+992', digits: 9, flag: '🇹🇯', placeholder: '90 000 0000' },
  { code: 'RU', dial: '+7', digits: 10, flag: '🇷🇺', placeholder: '912 345 67 89' },
]

// Detects country + national number from a phone string regardless of spacing/plus sign.
export function detectPhoneCountry(phone) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('992')) return { country: PHONE_COUNTRIES[0], national: digits.slice(3) }
  if (digits.startsWith('7')) return { country: PHONE_COUNTRIES[1], national: digits.slice(1) }
  return null
}

export function isValidPhone(phone) {
  const detected = detectPhoneCountry(phone)
  return !!detected && detected.national.length === detected.country.digits
}

/**
 * PhoneInput — country-select + national-number phone field.
 *
 * Props:
 *   value    {string}  — full phone string, e.g. "+992900000000"
 *   onChange {fn}      — (phone) => void
 */
export default function PhoneInput({ value, onChange, className = '' }) {
  const detected = detectPhoneCountry(value)
  const country = detected?.country ?? PHONE_COUNTRIES[0]
  const nationalDigits = detected?.national ?? ''

  const handleCountryChange = (e) => {
    const next = PHONE_COUNTRIES.find((c) => c.code === e.target.value) ?? PHONE_COUNTRIES[0]
    onChange(next.dial)
  }

  const handleDigitsChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, country.digits)
    onChange(country.dial + digits)
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <select
        value={country.code}
        onChange={handleCountryChange}
        className="input w-[92px] px-2 text-sm flex-shrink-0"
      >
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.flag} {c.dial}</option>
        ))}
      </select>

      <div className="relative flex-1">
        <input
          type="tel"
          inputMode="numeric"
          value={nationalDigits}
          onChange={handleDigitsChange}
          placeholder={country.placeholder}
          className="input pr-10"
          autoComplete="tel"
        />
      </div>
    </div>
  )
}
