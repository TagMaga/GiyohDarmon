// ── Role labels / badges ──────────────────────────────────────────────────────

export const ROLE_LABEL = {
  owner:             'Владелец',
  it_specialist:     'IT-специалист',
  sales_team_lead:   'Руководитель группы',
  manager:           'Менеджер',
  seller:            'Продавец',
  dispatcher:        'Диспетчер',
  warehouse_manager: 'Кладовщик',
  courier:           'Курьер',
}

export const ROLE_BADGE = {
  owner:             'violet',
  it_specialist:     'fuchsia',
  sales_team_lead:   'indigo',
  manager:           'sky',
  seller:            'emerald',
  dispatcher:        'amber',
  warehouse_manager: 'slate',
  courier:           'orange',
}

// Roles that can have commission configs (% earnings)
export const COMMISSION_ROLES = ['seller', 'manager', 'sales_team_lead']

// Roles that use delivery tariff earnings
export const TARIFF_ROLES = ['courier']

export const ALL_ROLES = Object.keys(ROLE_LABEL)

// ── Commission type labels ────────────────────────────────────────────────────

export const COMMISSION_TYPE_LABEL = {
  seller_rate:              'Ставка продавца',
  manager_team_rate:        'Командная ставка менеджера',
  manager_personal_rate:    'Личная ставка менеджера',
  team_lead_pool_rate:      'Пул руководителя',
  company_rate:             'Доход компании',
}

export const COMMISSION_TYPE_BADGE = {
  seller_rate:              'emerald',
  manager_team_rate:        'sky',
  manager_personal_rate:    'indigo',
  team_lead_pool_rate:      'violet',
  company_rate:             'slate',
}

export const SCOPE_LABEL = { global: 'Глобальный', team: 'Команда', employee: 'Сотрудник' }
export const SCOPE_BADGE = { global: 'slate', team: 'sky', employee: 'indigo' }

// ── Formatting ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat('ru-KG', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 2 })
const dateFmt  = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

export const fmtMoney = (v) => {
  if (v == null || isNaN(Number(v))) return '—'
  return moneyFmt.format(Number(v)) + ' с'
}

export const fmtPct = (v) => {
  if (v == null || isNaN(Number(v))) return '—'
  return (Number(v) * 100).toFixed(2).replace(/\.?0+$/, '') + '%'
}

export const fmtDate = (iso) => {
  if (!iso) return '—'
  try { return dateFmt.format(new Date(iso)) } catch { return iso }
}

// ── User / team maps ──────────────────────────────────────────────────────────

export function buildUserMap(users = []) {
  const m = {}
  users.forEach(u => { if (u?.id) m[u.id] = u })
  return m
}

export function buildTeamMap(teams = []) {
  const m = {}
  teams.forEach(t => { if (t?.id) m[t.id] = t })
  return m
}

export function userName(userMap, userId) {
  if (!userId) return '—'
  return userMap[userId]?.full_name ?? userMap[userId]?.FullName ?? '—'
}

export function teamName(teamMap, teamId) {
  if (!teamId) return '—'
  return teamMap[teamId]?.name ?? '—'
}

// ── Config helpers ────────────────────────────────────────────────────────────

export function isConfigActive(cfg) {
  if (!cfg) return false
  if (cfg.is_active === false) return false
  if (cfg.effective_to) return new Date(cfg.effective_to) > new Date()
  return true
}

// ── Performance helpers ───────────────────────────────────────────────────────

export function calcPerformance(orders = []) {
  const total     = orders.length
  const delivered = orders.filter(o => o.status === 'delivered').length
  const revenue   = orders
    .filter(o => o.status === 'delivered')
    .reduce((s, o) => s + (Number(o.total_amount) || 0), 0)
  const avgOrder  = delivered > 0 ? revenue / delivered : 0
  return { total, delivered, revenue, avgOrder }
}

// ── Role helpers ──────────────────────────────────────────────────────────────

export function isCourier(user) { return user?.role === 'courier' || user?.Role === 'courier' }
export function isCommissionRole(user) { return COMMISSION_ROLES.includes(user?.role ?? user?.Role) }

// Returns which order filter key to use for this role
export function orderFilterKey(role) {
  if (role === 'sales_team_lead') return 'team_lead_id'
  if (role === 'manager')         return 'manager_id'
  return 'seller_id'
}
