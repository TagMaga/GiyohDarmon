/**
 * CourierManageModals — three dispatcher-only courier management modals:
 *   1. EditCourierModal        — edit the courier's service-zone cities. Name/surname/
 *                                password/phone are owned by HR (People) now.
 *   2. TariffsModal            — per-courier range-based tariff rules (normal / fast)
 *   3. ToggleOrderIntakeModal  — enable / disable a courier's ability to take new orders
 */
import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, X, MapPin } from 'lucide-react'
import {
  updateCourier,
  updateCourierOrderIntake,
  setCourierAccountActive,
  fetchCourierTariffs,
  createCourierTariff,
  deleteCourierTariff,
  fetchCities,
  createCity,
} from '../api'

// ── Design tokens (match DispatcherBoardV2) ──────────────────────────────────
const T = {
  bg:     '#F4F3EF',
  panel:  '#FFFFFF',
  card:   '#FBFAF7',
  border: '#EAE8E2',
  text1:  '#1C1C1A',
  text2:  '#76766E',
  text3:  '#A3A39A',
  violet: '#6366f1',
  green:  '#047857',
  red:    '#BE123C',
  amber:  '#B45309',
  blue:   '#0369A1',
}

const field = {
  base: {
    width: '100%', background: T.card, border: `1px solid ${T.border}`,
    borderRadius: 10, color: T.text1, fontSize: 14, padding: '9px 12px',
    outline: 'none', boxSizing: 'border-box',
  },
}

// ── Shared modal shell ────────────────────────────────────────────────────────
function ModalShell({ title, subtitle, onClose, children, width = 520 }) {
  const ref = useRef()
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.72)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={ref}
        style={{
          width: '100%', maxWidth: width, maxHeight: '90vh',
          background: T.panel, borderRadius: 18,
          border: `1px solid ${T.border}`,
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          padding: '20px 24px 16px', borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text1 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#F0EFEA', border: 'none', borderRadius: 8,
              color: T.text2, cursor: 'pointer', padding: '6px 10px', fontSize: 16,
              marginLeft: 12, flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Label({ children, required }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>
      {children}{required && <span style={{ color: T.red, marginLeft: 3 }}>*</span>}
    </div>
  )
}

function FieldGroup({ children }) {
  return <div style={{ marginBottom: 16 }}>{children}</div>
}

function ErrorMsg({ msg }) {
  if (!msg) return null
  return <div style={{ marginTop: 8, fontSize: 13, color: T.red }}>{msg}</div>
}

function PrimaryBtn({ onClick, disabled, loading, children, color = T.violet }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        background: disabled || loading ? 'rgba(99,102,241,0.4)' : color,
        color: '#fff', border: 'none', borderRadius: 10,
        padding: '11px 20px', fontWeight: 700, fontSize: 14,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.7 : 1,
        minWidth: 100,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      {loading ? '...' : children}
    </button>
  )
}

function GhostBtn({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent', color: T.text2,
        border: `1px solid ${T.border}`, borderRadius: 10,
        padding: '11px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ── 1. EDIT COURIER MODAL ────────────────────────────────────────────────────
export function EditCourierModal({ courier, onClose, onSuccess }) {
  // City / service zone state
  const [cities,          setCities]         = useState([])
  const [citiesLoading,   setCitiesLoading]  = useState(true)
  const [selectedCityIDs, setSelectedCityIDs] = useState(
    Array.isArray(courier.city_ids) ? courier.city_ids : []
  )
  const [newCityName,  setNewCityName]  = useState('')
  const [addingCity,   setAddingCity]   = useState(false)
  const [cityError,    setCityError]    = useState('')

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // Load available cities once on mount
  useEffect(() => {
    fetchCities()
      .then(setCities)
      .catch(() => {})
      .finally(() => setCitiesLoading(false))
  }, [])

  const toggleCity = (id) => {
    setSelectedCityIDs((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const handleAddCity = async () => {
    const name = newCityName.trim()
    if (!name) return
    setCityError('')
    setAddingCity(true)
    try {
      const created = await createCity(name)
      setCities((prev) => [...prev, created])
      setSelectedCityIDs((prev) => [...prev, created.id])
      setNewCityName('')
    } catch (e) {
      setCityError(e?.response?.data?.error?.message ?? 'Ошибка создания города')
    } finally {
      setAddingCity(false)
    }
  }

  const handleSave = async () => {
    setError('')
    setLoading(true)
    try {
      await updateCourier(courier.courier_id, {
        // full_name/surname/phone are edited via HR (People) now, but the
        // backend still requires them on every save, so send them through
        // unchanged rather than exposing them as fields here.
        full_name: courier.full_name ?? '',
        phone:     courier.phone ?? '',
        city_ids:  selectedCityIDs,
      })
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error?.message ?? 'Ошибка сохранения')
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalShell
      title="✏️ Изменить курьера"
      subtitle={`${courier.full_name ?? ''} · ID: ${courier.courier_id?.slice(0, 8)}…`}
      onClose={onClose}
    >
      <div style={{ padding: '20px 24px 24px' }}>
        {/* ── Service zone / delivery cities ── */}
        <FieldGroup>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <MapPin size={13} style={{ color: T.violet }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Зона обслуживания
            </span>
          </div>

          {citiesLoading ? (
            <div style={{ fontSize: 13, color: T.text3, padding: '8px 0' }}>Загрузка городов…</div>
          ) : (
            <div style={{
              background: T.card, borderRadius: 10, border: `1px solid ${T.border}`,
              padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 8,
            }}>
              {cities.length === 0 && (
                <span style={{ fontSize: 13, color: T.text3 }}>Нет доступных городов</span>
              )}
              {cities.map((city) => {
                const selected = selectedCityIDs.includes(city.id)
                return (
                  <button
                    key={city.id}
                    type="button"
                    onClick={() => toggleCity(city.id)}
                    style={{
                      padding: '5px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', transition: 'all 0.15s',
                      background: selected ? T.violet : '#F0EFEA',
                      color: selected ? '#fff' : T.text2,
                      border: selected ? `1px solid ${T.violet}` : `1px solid ${T.border}`,
                    }}
                  >
                    {city.name}
                  </button>
                )
              })}
            </div>
          )}

          {/* Add new city inline */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={{ ...field.base, flex: 1 }}
              value={newCityName}
              onChange={(e) => setNewCityName(e.target.value)}
              placeholder="Новый город (например: Бохтар)"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCity() } }}
            />
            <button
              type="button"
              onClick={handleAddCity}
              disabled={addingCity || !newCityName.trim()}
              style={{
                background: addingCity || !newCityName.trim() ? '#F0EFEA' : T.blue,
                color: addingCity || !newCityName.trim() ? T.text3 : '#fff',
                border: 'none', borderRadius: 10, padding: '9px 14px',
                fontWeight: 700, fontSize: 13, cursor: addingCity || !newCityName.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
              }}
            >
              <Plus size={14} />
              {addingCity ? '…' : 'Добавить'}
            </button>
          </div>
          {cityError && <div style={{ marginTop: 6, fontSize: 12, color: T.red }}>{cityError}</div>}
        </FieldGroup>

        <ErrorMsg msg={error} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <GhostBtn onClick={onClose}>Отмена</GhostBtn>
          <PrimaryBtn onClick={handleSave} loading={loading}>Сохранить</PrimaryBtn>
        </div>
      </div>
    </ModalShell>
  )
}

// ── 2. TARIFFS MODAL ─────────────────────────────────────────────────────────
const DELIVERY_TYPES = [
  { key: 'normal', label: 'Обычная доставка' },
  { key: 'fast',   label: 'Срочная доставка' },
]
const TARIFF_TYPES = [
  { key: 'fixed',   label: 'Фиксированная (c)' },
  { key: 'percent', label: 'Процент (%)' },
]
const fmtRule = (r) => {
  const from = `${r.amount_from} c`
  const to   = r.amount_to != null ? `${r.amount_to} c` : '∞'
  const val  = r.tariff_type === 'percent' ? `${r.tariff_value}%` : `${r.tariff_value} c`
  return `${from} – ${to} → ${val}`
}

export function TariffsModal({ courier, onClose }) {
  const [tab,     setTab]     = useState('normal')
  const [rules,   setRules]   = useState([])
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [form, setForm] = useState({
    amount_from:  '',
    amount_to:    '',
    tariff_type:  'fixed',
    tariff_value: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const data = await fetchCourierTariffs(courier.courier_id)
      setRules(data ?? [])
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [courier.courier_id])

  const setF = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleAdd = async () => {
    setError('')
    const amtFrom = parseFloat(form.amount_from)
    const amtTo   = form.amount_to.trim() !== '' ? parseFloat(form.amount_to) : null
    const val     = parseFloat(form.tariff_value)

    if (isNaN(amtFrom) || amtFrom < 0) return setError('Сумма от: некорректное значение')
    if (amtTo !== null && (isNaN(amtTo) || amtTo <= amtFrom)) return setError('Сумма до должна быть больше суммы от')
    if (isNaN(val) || val <= 0) return setError('Значение тарифа должно быть > 0')

    setSaving(true)
    try {
      await createCourierTariff(courier.courier_id, {
        delivery_type: tab,
        amount_from:   amtFrom,
        amount_to:     amtTo,
        tariff_type:   form.tariff_type,
        tariff_value:  val,
      })
      setForm({ amount_from: '', amount_to: '', tariff_type: 'fixed', tariff_value: '' })
      await load()
    } catch (e) {
      setError(e?.response?.data?.error?.message ?? 'Ошибка добавления')
    } finally { setSaving(false) }
  }

  const handleDelete = async (rule) => {
    if (!confirm(`Удалить тариф: ${fmtRule(rule)}?`)) return
    try {
      await deleteCourierTariff(courier.courier_id, rule.id)
      await load()
    } catch (e) {
      alert(e?.response?.data?.error?.message ?? 'Ошибка удаления')
    }
  }

  const visibleRules = rules.filter((r) => r.delivery_type === tab)

  return (
    <ModalShell
      title={`💰 Тарифы — ${courier.full_name}`}
      subtitle="Оплата курьеру зависит от типа доставки и суммы заказа"
      onClose={onClose}
      width={580}
    >
      <div style={{ padding: '0 24px 24px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${T.border}`, marginBottom: 20, paddingTop: 16 }}>
          {DELIVERY_TYPES.map((dt) => (
            <button
              key={dt.key}
              onClick={() => setTab(dt.key)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px 18px', fontSize: 14, fontWeight: 600,
                color: tab === dt.key ? T.violet : T.text2,
                borderBottom: tab === dt.key ? `2px solid ${T.violet}` : '2px solid transparent',
                marginBottom: -1, transition: 'color 0.15s',
              }}
            >
              {dt.label}
            </button>
          ))}
        </div>

        {/* Add form */}
        <div style={{
          background: T.card, borderRadius: 12, border: `1px solid ${T.border}`,
          padding: 16, marginBottom: 20,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text2, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>
            Добавить тариф
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <Label>Сумма от (c)</Label>
              <input style={field.base} type="number" min="0" value={form.amount_from} onChange={setF('amount_from')} placeholder="0" />
            </div>
            <div>
              <Label>Сумма до (c)</Label>
              <input style={field.base} type="number" min="0" value={form.amount_to} onChange={setF('amount_to')} placeholder="∞ (без ограничений)" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <Label>Тип тарифа</Label>
              <select style={field.base} value={form.tariff_type} onChange={setF('tariff_type')}>
                {TARIFF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <Label>Значение</Label>
              <input
                style={field.base} type="number" min="0" step="0.01"
                value={form.tariff_value} onChange={setF('tariff_value')}
                placeholder={form.tariff_type === 'percent' ? '5 (= 5%)' : '15 (c)'}
              />
            </div>
          </div>
          <ErrorMsg msg={error} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <PrimaryBtn onClick={handleAdd} loading={saving}>
              <Plus size={14} />
              Добавить
            </PrimaryBtn>
          </div>
        </div>

        {/* Rules list */}
        {loading ? (
          <div style={{ color: T.text3, fontSize: 13, padding: '12px 0' }}>Загрузка…</div>
        ) : visibleRules.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '28px 0', color: T.text3,
            fontSize: 14, border: `1px dashed ${T.border}`, borderRadius: 10,
          }}>
            Тарифов нет. Добавьте первый тариф выше.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleRules.map((r) => (
              <div
                key={r.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: T.card, borderRadius: 10, border: `1px solid ${T.border}`,
                  padding: '11px 14px',
                }}
              >
                <div>
                  <span style={{ fontSize: 13, color: T.text2 }}>
                    {r.amount_from} – {r.amount_to != null ? r.amount_to : '∞'} c
                  </span>
                  <span style={{ margin: '0 8px', color: T.text3 }}>→</span>
                  <span style={{ fontWeight: 700, color: T.text1, fontSize: 14 }}>
                    {r.tariff_type === 'percent'
                      ? `${r.tariff_value}%`
                      : `${r.tariff_value} c`}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: T.text3 }}>
                    ({r.tariff_type === 'percent' ? 'процент' : 'фиксировано'})
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(r)}
                  style={{
                    background: 'rgba(190,18,60,0.12)', border: 'none', borderRadius: 7,
                    color: T.red, cursor: 'pointer', padding: '6px 8px', display: 'flex', alignItems: 'center',
                  }}
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ── 3. TOGGLE ORDER INTAKE MODAL ─────────────────────────────────────────────
// Disabling only ever touches order-intake (courier keeps login access and
// stays a valid employee). But if the account itself was fully deactivated
// (is_active=false — e.g. from the People page, or a stuck state from before
// this button was split from account-active), a plain intake toggle can't
// recover it, since the courier stays locked out regardless. In that case the
// "enable" action also reactivates the account, so this button can always
// bring a courier back to working order in one click.
export function ToggleOrderIntakeModal({ courier, onClose, onSuccess }) {
  const accountActive = courier.is_active !== false
  const intakeEnabled = courier.order_intake_enabled !== false
  const operational = accountActive && intakeEnabled
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleConfirm = async () => {
    setError('')
    setLoading(true)
    try {
      if (operational) {
        await updateCourierOrderIntake(courier.courier_id, { enabled: false, reason })
      } else {
        if (!accountActive) await setCourierAccountActive(courier.courier_id, true)
        if (!intakeEnabled) await updateCourierOrderIntake(courier.courier_id, { enabled: true })
      }
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error?.message ?? 'Ошибка')
    } finally { setLoading(false) }
  }

  const title = operational
    ? 'Отключить приём заказов?'
    : !accountActive
      ? 'Активировать курьера?'
      : 'Включить приём заказов?'

  return (
    <ModalShell title={title} onClose={onClose} width={420}>
      <div style={{ padding: '20px 24px 24px' }}>
        <div style={{ color: T.text2, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          {operational ? (
            <>
              Курьер <strong style={{ color: T.text1 }}>{courier.full_name}</strong> больше не
              сможет брать новые заказы и не будет виден в списке доступных курьеров.<br />
              <span style={{ color: T.amber }}>Уже назначенные активные заказы останутся у него.</span>
            </>
          ) : !accountActive ? (
            <>
              Курьер <strong style={{ color: T.text1 }}>{courier.full_name}</strong> полностью
              деактивирован — нет доступа в приложение и заказы недоступны.<br />
              Активация восстановит доступ и включит приём заказов.
            </>
          ) : (
            <>
              Курьер <strong style={{ color: T.text1 }}>{courier.full_name}</strong> снова
              сможет брать новые заказы.
            </>
          )}
        </div>

        {operational && (
          <FieldGroup>
            <Label>Причина (необязательно)</Label>
            <input
              style={field.base}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: закончил смену"
            />
          </FieldGroup>
        )}

        <ErrorMsg msg={error} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <GhostBtn onClick={onClose}>Отмена</GhostBtn>
          <PrimaryBtn
            onClick={handleConfirm}
            loading={loading}
            color={operational ? T.red : T.green}
          >
            {operational ? 'Отключить' : !accountActive ? 'Активировать' : 'Включить'}
          </PrimaryBtn>
        </div>
      </div>
    </ModalShell>
  )
}
