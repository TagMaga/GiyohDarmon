// Shared helpers for the "order creator" (seller/manager/lead) shown to couriers.
// The API returns creator_id / creator_name / creator_phone / creator_role; the
// raw role is localized and color-coded here so every screen stays consistent.

export const CREATOR_ROLE_LABEL = {
  seller: 'Продавец',
  manager: 'Менеджер',
  sales_team_lead: 'Руководитель',
  director: 'Руководитель',
  owner: 'Руководитель',
}

// Badge accent per role family: Продавец → purple, Менеджер → blue, Руководитель → orange.
export const CREATOR_ROLE_COLOR = {
  seller: '#665cff',
  manager: '#1683ff',
  sales_team_lead: '#ff9f0a',
  director: '#ff9f0a',
  owner: '#ff9f0a',
}

const FALLBACK_COLOR = '#7d8797'

// resolveCreator normalizes an order's creator fields into ready-to-render values,
// applying the fallbacks (Неизвестный пользователь / Не указан / no badge) and the
// "Мой заказ" rule when the creator is the signed-in courier.
export function resolveCreator(order, currentUserName = '') {
  const role = order?.creator_role || ''
  const hasCreator = !!(order?.creator_name || order?.creator_phone)
  const isOwn = hasCreator && !!order?.creator_name &&
    order.creator_name.trim().toLowerCase() === (currentUserName || '').trim().toLowerCase()
  return {
    id: order?.creator_id || null,
    name: order?.creator_name || 'Неизвестный пользователь',
    phone: order?.creator_phone || '',
    role,
    roleLabel: CREATOR_ROLE_LABEL[role] || (role || null),
    roleColor: CREATOR_ROLE_COLOR[role] || FALLBACK_COLOR,
    hasCreator,
    isOwn,
  }
}
