/**
 * CourierManageModals — three dispatcher-only courier management modals:
 *   1. EditCourierModal  — edit name, surname, phone, password, telegram_chat_id
 *   2. TariffsModal      — per-courier range-based tariff rules (normal / fast)
 *   3. ToggleActiveModal — enable / disable courier with confirmation
 */
import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, X } from 'lucide-react'
import {
  updateCourier,
  toggleCourierActive,
  fetchCourierTariffs,
  createCourierTariff,
  deleteCourierTariff,
} from '../api'

// ── Design tokens (match DispatcherBoardV2) ──────────────────────────────────
const T = {
  bg:     '#0a111e',
  panel:  '#0d1525',
  card:   '#111d30',
  border: 'rgba(255,255,255,0.07)',
  text1:  '#f0f4ff',
  text2:  '#8fa3c8',
  text3:  '#4a6080',
  violet: '#8b5cf6',
  green:  '#10b981',
  red:    '#ef4444',
  amber:  '#f59e0b',
  blue:   '#3b82f6',
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
              background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
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
        background: disabled || loading ? 'rgba(139,92,246,0.4)' : color,
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
  const [form, setForm] = useState({
    full_name:        courier.full_name ?? '',
    surname:          courier.surname   ?? '',
    phone:            courier.phone     ?? '',
    password:         '',
    telegram_chat_id: courier.telegram_chat_id ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const handleSave = async () => {
    setError('')
    if (!form.full_name.trim())        return setError('Имя обязательно')
    if (!form.surname.trim())          return setError('Фамилия обязательна')
    if (!form.phone.trim())            return setError('Телефон обязателен')
    if (!form.telegram_chat_id.trim()) return setError('Telegram Chat ID обязателен')

    setLoading(true)
    try {
      await updateCourier(courier.courier_id, {
        full_name:        form.full_name.trim(),
        surname:          form.surname.trim() || undefined,
        phone:            form.phone.trim(),
        password:         form.password.trim() || undefined,
        telegram_chat_id: form.telegram_chat_id.trim(),
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
      subtitle={`ID: ${courier.courier_id?.slice(0, 8)}…`}
      onClose={onClose}
    >
      <div style={{ padding: '20px 24px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 0 }}>
          <FieldGroup>
            <Label required>Имя</Label>
            <input style={field.base} value={form.full_name} onChange={set('full_name')} placeholder="Имя" />
          </FieldGroup>
          <FieldGroup>
            <Label required>Фамилия</Label>
            <input style={field.base} value={form.surname} onChange={set('surname')} placeholder="Фамилия" />
          </FieldGroup>
        </div>

        <FieldGroup>
          <Label required>Телефон (логин)</Label>
          <input style={field.base} value={form.phone} onChange={set('phone')} placeholder="+992..." />
        </FieldGroup>

        <FieldGroup>
          <Label>Пароль</Label>
          <input
            style={field.base} type="password"
            value={form.password} onChange={set('password')}
            placeholder="Оставьте пустым, чтобы не менять"
          />
        </FieldGroup>

        <FieldGroup>
          <Label required>Telegram Chat ID</Label>
          <input
            style={field.base} value={form.telegram_chat_id}
            onChange={set('telegram_chat_id')} placeholder="-1001234567890"
          />
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
  { key: 'fixed',   label: 'Фиксированная (сом)' },
  { key: 'percent', label: 'Процент (%)' },
]
const fmtRule = (r) => {
  const from = `${r.amount_from} сом`
  const to   = r.amount_to != null ? `${r.amount_to} сом` : '∞'
  const val  = r.tariff_type === 'percent' ? `${r.tariff_value}%` : `${r.tariff_value} сом`
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
              <Label>Сумма от (сом)</Label>
              <input style={field.base} type="number" min="0" value={form.amount_from} onChange={setF('amount_from')} placeholder="0" />
            </div>
            <div>
              <Label>Сумма до (сом)</Label>
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
                placeholder={form.tariff_type === 'percent' ? '5 (= 5%)' : '15 (сом)'}
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
                    {r.amount_from} – {r.amount_to != null ? r.amount_to : '∞'} сом
                  </span>
                  <span style={{ margin: '0 8px', color: T.text3 }}>→</span>
                  <span style={{ fontWeight: 700, color: T.text1, fontSize: 14 }}>
                    {r.tariff_type === 'percent'
                      ? `${r.tariff_value}%`
                      : `${r.tariff_value} сом`}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: T.text3 }}>
                    ({r.tariff_type === 'percent' ? 'процент' : 'фиксировано'})
                  </span>
                </div>
                <button
                  onClick={() => handleDelete(r)}
                  style={{
                    background: 'rgba(239,68,68,0.12)', border: 'none', borderRadius: 7,
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

// ── 3. TOGGLE ACTIVE MODAL ───────────────────────────────────────────────────
export function ToggleActiveModal({ courier, onClose, onSuccess }) {
  const isActive = courier.is_active
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleConfirm = async () => {
    setError('')
    setLoading(true)
    try {
      await toggleCourierActive(courier.courier_id, !isActive)
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e?.response?.data?.error?.message ?? 'Ошибка')
    } finally { setLoading(false) }
  }

  return (
    <ModalShell
      title={isActive ? 'Выключить курьера?' : 'Включить курьера?'}
      onClose={onClose}
      width={420}
    >
      <div style={{ padding: '20px 24px 24px' }}>
        <div style={{ color: T.text2, fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
          {isActive ? (
            <>
              Курьер <strong style={{ color: T.text1 }}>{courier.full_name}</strong> больше не
              сможет брать новые заказы.<br />
              <span style={{ color: T.amber }}>Уже назначенные активные заказы останутся у него.</span>
            </>
          ) : (
            <>
              Курьер <strong style={{ color: T.text1 }}>{courier.full_name}</strong> снова
              сможет брать новые заказы.
            </>
          )}
        </div>

        <ErrorMsg msg={error} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <GhostBtn onClick={onClose}>Отмена</GhostBtn>
          <PrimaryBtn
            onClick={handleConfirm}
            loading={loading}
            color={isActive ? T.red : T.green}
          >
            {isActive ? 'Выключить' : 'Включить'}
          </PrimaryBtn>
        </div>
      </div>
    </ModalShell>
  )
}
