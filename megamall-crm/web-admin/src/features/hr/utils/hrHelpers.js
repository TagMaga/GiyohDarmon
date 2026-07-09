// ── Commission type labels ─────────────────────────────────────────────────────
export const COMMISSION_TYPE_LABEL = {
  seller_rate:            'Комиссия продавца',
  manager_team_rate:      'Комиссия менеджера (команда)',
  manager_personal_rate:  'Комиссия менеджера (личная)',
  team_lead_pool_rate:    'Пул тимлида',
  company_rate:           'Доля компании',
}

export const COMMISSION_TYPE_BADGE = {
  seller_rate:            'indigo',
  manager_team_rate:      'violet',
  manager_personal_rate:  'sky',
  team_lead_pool_rate:    'amber',
  company_rate:           'emerald',
}

// ── Scope labels ──────────────────────────────────────────────────────────────
export const SCOPE_LABEL  = { global: 'Глобальный', team: 'Команда', employee: 'Сотрудник' }
export const SCOPE_BADGE  = { global: 'emerald',   team: 'indigo',  employee: 'violet' }

// ── Tariff type labels ────────────────────────────────────────────────────────
export const TARIFF_TYPE_LABEL = { fixed: 'Фиксированный', tiered: 'Ступенчатый' }
export const TARIFF_TYPE_BADGE = { fixed: 'sky', tiered: 'indigo' }

// ── Order type labels ─────────────────────────────────────────────────────────
export const ORDER_TYPE_LABEL = {
  seller_order:            'Заказ продавца',
  manager_personal_order:  'Личный (менеджер)',
  team_lead_personal_order:'Личный (тимлид)',
}
export const ALL_ORDER_TYPES = Object.keys(ORDER_TYPE_LABEL)

// ── Event type Russian labels (abbreviated) ───────────────────────────────────
export const EVENT_TYPE_LABEL = {
  seller_commission_earned:              'Начислено (продавец)',
  seller_commission_confirmed:           'Подтверждено (продавец)',
  seller_commission_cancelled:           'Отменено (продавец)',
  manager_team_commission_earned:        'Начислено (менеджер/команда)',
  manager_team_commission_confirmed:     'Подтверждено (менеджер/команда)',
  manager_personal_commission_earned:    'Начислено (менеджер/личное)',
  manager_personal_commission_confirmed: 'Подтверждено (менеджер/личное)',
  team_lead_pool_earned:                 'Пул тимлида (начислено)',
  team_lead_pool_confirmed:              'Пул тимлида (подтверждено)',
  company_revenue_earned:                'Доход компании (начислено)',
  company_revenue_confirmed:             'Доход компании (подтверждено)',
  delivery_fee_earned:                   'Доставка (начислено)',
  courier_fee_earned:                    'Доставка курьеру (начислено)',
  courier_fee_confirmed:                 'Доставка курьеру (подтверждено)',
  courier_fee_paid:                      'Выплата курьеру',
  cash_collected:                         'Наличные собраны',
  cash_handed_over:                       'Наличные сданы',
  business_expense:                       'Расход',
  manual_expense:                         'Расход', // legacy label, pre-Finance/Budget split
  team_lead_payout:                       'Выплата · Тимлид → Менеджер',
  manager_payout:                         'Выплата · Менеджер → Продавец',
  owner_payout:                           'Выплата · Владелец',
}
export const EVENT_TYPE_BADGE = {
  seller_commission_earned:              'indigo',
  seller_commission_confirmed:           'emerald',
  seller_commission_cancelled:           'rose',
  manager_team_commission_earned:        'violet',
  manager_team_commission_confirmed:     'emerald',
  manager_personal_commission_earned:    'sky',
  manager_personal_commission_confirmed: 'emerald',
  team_lead_pool_earned:                 'amber',
  team_lead_pool_confirmed:              'emerald',
  company_revenue_earned:                'slate',
  company_revenue_confirmed:             'emerald',
  delivery_fee_earned:                   'orange',
  courier_fee_earned:                    'orange',
  courier_fee_confirmed:                 'emerald',
  courier_fee_paid:                      'slate',
  cash_collected:                         'amber',
  cash_handed_over:                       'emerald',
  business_expense:                       'rose',
  manual_expense:                         'rose', // legacy badge, pre-Finance/Budget split
  team_lead_payout:                       'indigo',
  manager_payout:                         'violet',
  owner_payout:                           'slate',
}

// Direction grouping used by the Finance ledger's Пополнение/Списание split:
// every accrual (*_earned/*_confirmed — money being credited to someone)
// counts as income; payouts, cancellations, and manual expenses are the
// money leaving that balance again.
export const INCOME_EVENT_TYPES = new Set([
  'company_revenue_earned', 'company_revenue_confirmed',
  'seller_commission_earned', 'seller_commission_confirmed',
  'manager_personal_commission_earned', 'manager_personal_commission_confirmed',
  'manager_team_commission_earned', 'manager_team_commission_confirmed',
  'team_lead_pool_earned', 'team_lead_pool_confirmed',
  'courier_fee_earned', 'courier_fee_confirmed',
  'cash_collected',
])
export const EXPENSE_EVENT_TYPES = new Set([
  'seller_commission_cancelled',
  'business_expense',
  'team_lead_payout', 'manager_payout', 'owner_payout',
  'cash_handed_over',
])

// business_expense sub-categories (finance_expense_category enum on the backend).
export const EXPENSE_CATEGORY_LABEL = {
  salary:    'Зарплата',
  rent:      'Аренда',
  marketing: 'Маркетинг',
  taxes:     'Налоги',
  other:     'Другое',
}

// ── Rate source labels ────────────────────────────────────────────────────────
export const RATE_SOURCE_LABEL = { global: 'Глобальный', team: 'Команда', employee: 'Сотрудник' }
export const RATE_SOURCE_BADGE = { global: 'slate', team: 'indigo', employee: 'violet' }

// ── Formatters ────────────────────────────────────────────────────────────────
const currFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
export const fmtMoney  = (n) => { const v = Number(n); return Number.isNaN(v) ? '—' : `${currFmt.format(v)} с` }
export const fmtPct    = (n) => { const v = Number(n); return Number.isNaN(v) ? '—' : `${(v * 100).toFixed(2)}%` }

const dtFmt = new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
const dFmt  = new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' })
export const fmtDate     = (iso) => { if (!iso) return '—'; try { return dFmt.format(new Date(iso))  } catch { return iso } }
export const fmtDateTime = (iso) => { if (!iso) return '—'; try { return dtFmt.format(new Date(iso)) } catch { return iso } }

// ── Config helpers ────────────────────────────────────────────────────────────
export function isConfigActive(cfg) {
  return cfg?.is_active ?? cfg?.IsActive ?? (cfg?.effective_to == null)
}

// ── Team/user lookup builders ─────────────────────────────────────────────────
export function buildTeamMap(teams)  { const m = {}; (teams ?? []).forEach(t => { if (t.id) m[t.id] = t }); return m }
export function buildUserMap(users)  { const m = {}; (users ?? []).forEach(u => { if (u.id) u && (m[u.id] = u) }); return m }

export function teamName(map, id) { return map[id]?.name ?? id?.slice(0,8) ?? '—' }
export function userName(map, id) { return map[id]?.full_name ?? map[id]?.FullName ?? id?.slice(0,8) ?? '—' }
