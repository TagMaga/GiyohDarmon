import { createPortal } from 'react-dom'
import { C } from './theme'

/**
 * Sheet — bottom-sheet shell shared by every mobile dispatcher overlay
 * (order detail, assign/cancel/issue/schedule, create order, courier detail,
 * fleet, profile). Matches the design's backdrop + drag-handle + slide-in.
 */
export default function Sheet({ open, onClose, maxHeight = '86%', zIndex = 40, children }) {
  if (!open) return null
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex }}>
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(28,28,26,.4)', animation: 'dmFade .2s ease' }}
      />
      <div
        className="dm-scroll"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight,
          background: C.bg, borderRadius: '24px 24px 0 0', overflowY: 'auto',
          padding: '8px 16px 30px', animation: 'dmSheetIn .26s cubic-bezier(.4,0,.2,1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 12px' }}>
          <div style={{ width: 38, height: 5, borderRadius: 99, background: '#D6D3CB' }} />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function SheetTitle({ children, sub }) {
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 900, padding: '0 4px 3px', color: C.text1 }}>{children}</div>
      {sub && <div style={{ fontSize: 12, color: C.text4, padding: '0 4px 14px' }}>{sub}</div>}
    </>
  )
}

export function SheetPrimaryButton({ onClick, disabled, children, background }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: 14, border: 'none', borderRadius: 14, fontFamily: 'inherit',
        fontSize: 14, fontWeight: 700, color: '#fff', cursor: disabled ? 'default' : 'pointer',
        background: background ?? C.gradient, opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  )
}

export function ChipRow({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {items}
    </div>
  )
}
