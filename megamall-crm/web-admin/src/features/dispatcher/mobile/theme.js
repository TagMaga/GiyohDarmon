/**
 * Design tokens for the dispatcher mobile UI — lifted 1:1 from the
 * "Dispatcher Mobile" Claude Design mock. Kept separate from the desktop
 * `dv2-*` CSS since the two surfaces intentionally use different visual
 * languages (this one: warm off-white, Golos Text, big rounded cards).
 */
export const C = {
  bg:       '#F4F3EF',
  bgOuter:  '#E8E6DF',
  card:     '#FFFFFF',
  cardAlt:  '#FBFAF7',
  border:   '#EAE8E2',
  border2:  '#F0EFEA',
  text1:    '#1C1C1A',
  text2:    '#76766E',
  text3:    '#A3A39A',
  text4:    '#8A8A80',
  violet:   '#6366F1',
  violetDk: '#4338CA',
  violetBg: '#ECEBFE',
  blue:     '#0369A1',
  blueBg:   '#DCEEFB',
  green:    '#047857',
  greenBg:  '#DDF3E7',
  amber:    '#B45309',
  amberBg:  '#FBEFD6',
  red:      '#BE123C',
  redBg:    '#FDE7EC',
  redSoft:  '#F4C9D4',
  gradient: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
}

export const AVATAR_PALETTE = [
  { background: '#E7E5FB', color: '#4338CA' },
  { background: '#FBEFD6', color: '#B45309' },
  { background: '#DCEEFB', color: '#0369A1' },
  { background: '#DDF3E7', color: '#047857' },
  { background: '#F0EFEA', color: '#76766E' },
  { background: '#FDE7EC', color: '#BE123C' },
]

export function avatarStyle(name = '') {
  const idx = name.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_PALETTE.length
  return AVATAR_PALETTE[idx]
}

export function initialsOf(name = '') {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?'
}

export const STATUS_PILL = {
  new:         { label: 'Новый',       color: '#57534E', bg: '#F0EFEA', dot: '#6366f1' },
  confirmed:   { label: 'Подтверждён', color: '#0369A1', bg: '#DCEEFB', dot: '#0ea5e9' },
  assigned:    { label: 'Назначен',    color: '#6D28D9', bg: '#EDE9FE', dot: '#8b5cf6' },
  in_delivery: { label: 'В доставке',  color: '#B45309', bg: '#FBEFD6', dot: '#f59e0b' },
  delivered:   { label: 'Доставлен',   color: '#047857', bg: '#DDF3E7', dot: '#10b981' },
  issue:       { label: 'Проблема',    color: '#BE123C', bg: '#FDE7EC', dot: '#ef4444' },
  cancelled:   { label: 'Отменён',     color: '#475569', bg: '#F0EFEA', dot: '#64748b' },
  returned:    { label: 'Возврат',     color: '#C2410C', bg: '#FFEDD5', dot: '#f97316' },
}

export function statusPill(status) {
  return STATUS_PILL[status] ?? STATUS_PILL.new
}

/** Column definition shared by the dispatch-tab status chips + grouping. */
export const MOBILE_COLUMNS = [
  { key: 'new',       label: 'Новые',      hint: 'Ждут подтверждения',  color: '#6366f1', statuses: ['new'] },
  { key: 'confirmed', label: 'Подтв.',     hint: 'Готовы к назначению', color: '#0ea5e9', statuses: ['confirmed'] },
  { key: 'delivery',  label: 'В доставке', hint: 'В пути',              color: '#f59e0b', statuses: ['assigned', 'in_delivery'] },
  { key: 'issues',    label: 'Проблемы',   hint: 'Требуют решения',     color: '#ef4444', statuses: ['issue'] },
  { key: 'done',      label: 'Готово',     hint: 'Сегодня',             color: '#10b981', statuses: ['delivered'] },
]

export const MOBILE_STATUS_TO_COL = {
  new: 'new', confirmed: 'confirmed', assigned: 'delivery', in_delivery: 'delivery',
  delivered: 'done', issue: 'issues',
}

export function chipStyle(active, color) {
  if (active) {
    return { background: color ?? C.text1, color: '#fff', border: `1px solid ${color ?? C.text1}` }
  }
  return { background: C.card, color: C.text2, border: `1px solid ${C.border}` }
}
