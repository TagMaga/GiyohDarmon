import { Link } from 'react-router-dom'
import { STATUS_LABELS, STATUS_BADGE } from '../../../shared/orderStatusConfig'

/**
 * Seller mobile design language (Seller Panel Redesign).
 * Light beige surface, white cards with hairline borders, dark money cards,
 * indigo accent. Used only inside the seller mobile (lg:hidden) layouts.
 */

export const M = {
  bg:        '#F4F3EF',
  card:      '#FFFFFF',
  border:    '#EAE8E2',
  borderAlt: '#E4E2DC',
  ink:       '#1C1C1A',
  sub:       '#8A8A80',
  muted:     '#A3A39A',
  faint:     '#B0B0A6',
  dark:      '#1A1A20',
  darkSub:   '#A5A5B8',
  darkMuted: '#7E7E96',
  indigo:    '#6366F1',
  indigoDeep:'#4338CA',
  indigoBg:  '#ECEBFE',
  green:     '#047857',
  greenBg:   '#DDF3E7',
  amber:     '#B45309',
  amberBg:   '#FBEFD6',
  font:      "'Golos Text', 'Inter', system-ui, -apple-system, sans-serif",
}

/** Full-screen shell: beige background + Golos Text, bottom padding for nav */
export function MobileShell({ children, style }) {
  return (
    <div
      className="lg:hidden min-h-screen"
      style={{
        background: M.bg,
        fontFamily: M.font,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        paddingBottom: '7.5rem',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** White card with hairline border */
export function Card({ children, className = '', style, ...rest }) {
  return (
    <div
      className={className}
      style={{ background: M.card, border: `1px solid ${M.border}`, borderRadius: 16, ...style }}
      {...rest}
    >
      {children}
    </div>
  )
}

/** Dark money card with soft colored glow circle */
export function DarkCard({ glow = 'rgba(99,102,241,.16)', children, style }) {
  return (
    <div style={{ background: M.dark, borderRadius: 24, padding: 22, position: 'relative', overflow: 'hidden', ...style }}>
      <div style={{ position: 'absolute', right: -30, top: -30, width: 130, height: 130, borderRadius: '50%', background: glow }} />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  )
}

/** Small stat tile: big value + caption */
export function StatTile({ value, label, valueColor = M.ink, center = false, to, state }) {
  const tile = (
    <Card style={{ borderRadius: 15, padding: '13px 12px', textAlign: center ? 'center' : 'left' }}>
      <div style={{ fontSize: 21, fontWeight: 800, color: valueColor, letterSpacing: '-.01em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: M.sub, fontWeight: 600, marginTop: 2 }}>{label}</div>
    </Card>
  )
  if (!to) return tile
  return (
    <Link to={to} state={state} className="active:scale-95 transition-transform" style={{ display: 'block' }}>
      {tile}
    </Link>
  )
}

/** Uppercase section label */
export function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 700, color: M.muted, letterSpacing: '.04em', textTransform: 'uppercase', margin: '0 4px 10px', ...style }}>
      {children}
    </div>
  )
}

/** Filter / period chip */
export function Chip({ active, children, onClick, style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 transition-transform active:scale-95"
      style={active ? {
        fontSize: 12.5, fontWeight: 700, color: '#fff', background: M.dark,
        padding: '7px 14px', borderRadius: 10, border: '1px solid transparent', ...style,
      } : {
        fontSize: 12.5, fontWeight: 600, color: '#76766E', background: '#fff',
        border: `1px solid ${M.borderAlt}`, padding: '7px 14px', borderRadius: 10, ...style,
      }}
    >
      {children}
    </button>
  )
}

const PILL_COLORS = {
  indigo:  { color: M.indigoDeep, bg: M.indigoBg, dot: M.indigo },
  sky:     { color: '#0369A1', bg: '#DCEEFB', dot: '#0EA5E9' },
  violet:  { color: '#6D28D9', bg: '#EFE9FE', dot: '#8B5CF6' },
  amber:   { color: M.amber, bg: M.amberBg, dot: '#D97706' },
  emerald: { color: M.green, bg: M.greenBg, dot: '#10B981' },
  orange:  { color: '#C2410C', bg: '#FEEBDC', dot: '#EA580C' },
  slate:   { color: '#57534E', bg: '#F0EFEA', dot: '#A8A29E' },
  rose:    { color: '#BE123C', bg: '#FDE7EC', dot: '#F43F5E' },
}

/** Order status pill (dot for in-progress, check for delivered) */
export function StatusPill({ status }) {
  const c = PILL_COLORS[STATUS_BADGE[status]] ?? PILL_COLORS.slate
  const delivered = status === 'delivered'
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: 11.5, fontWeight: 700, color: c.color, background: c.bg, padding: '4px 9px', borderRadius: 8 }}
    >
      {delivered ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.dot }} />
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** Avatar circle with initials */
export function InitialsAvatar({ name = '', size = 42, radius, palette = 0 }) {
  const PALETTES = [
    { bg: '#E7E5FB', color: M.indigoDeep },
    { bg: M.amberBg, color: M.amber },
    { bg: '#DCEEFB', color: '#0369A1' },
    { bg: M.greenBg, color: M.green },
    { bg: '#F0EFEA', color: '#76766E' },
  ]
  const p = PALETTES[palette % PALETTES.length]
  const initials = name.split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '·'
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: size, height: size, borderRadius: radius ?? '50%',
        background: p.bg, color: p.color,
        fontWeight: 700, fontSize: Math.round(size / 3),
      }}
    >
      {initials}
    </div>
  )
}

/** Primary indigo button. Pass as="span" when nesting inside a <Link>. */
export function PrimaryButton({ children, gradient = false, style, as: As = 'button', ...rest }) {
  return (
    <As
      type={As === 'button' ? 'button' : undefined}
      className="active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-2"
      style={{
        background: gradient ? 'linear-gradient(135deg,#6366F1,#4F46E5)' : M.indigo,
        color: '#fff', border: 'none', fontFamily: 'inherit',
        fontSize: 14, fontWeight: 700, padding: '11px 18px', borderRadius: 13,
        cursor: 'pointer', boxShadow: gradient ? '0 8px 20px rgba(99,102,241,.38)' : 'none',
        ...style,
      }}
      {...rest}
    >
      {children}
    </As>
  )
}
