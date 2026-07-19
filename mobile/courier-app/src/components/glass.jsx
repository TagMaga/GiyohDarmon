/**
 * Solid surface design system (formerly "Liquid Glass").
 *
 * Layers (back to front):
 *   1. GlassBackdrop — colorful radial washes behind everything
 *   2. Surfaces — solid opaque fills with bright hairline edges (GlassCard / tokens)
 *   3. Sheen — specular top highlight accent, kept as a subtle finishing touch
 *   4. Chrome (tab bar, sheets, menus) — solid opaque fills, no blur
 *
 * Appearance adapts to the system light/dark setting via GlassThemeProvider;
 * the in-app toggle (account menu) overrides it. Cards, chips and chrome are
 * all fully opaque now — the backdrop's colorful washes show only in the gaps
 * between surfaces, never through them.
 */
import { createContext, useContext, useMemo, useState } from 'react'
import { View, StyleSheet, useColorScheme, useWindowDimensions } from 'react-native'
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

// ── Tokens ──────────────────────────────────────────────────────────────────

export const RADIUS = { card: 24, panel: 28, sheet: 32, chip: 999, input: 16 }
export const SPACE  = { gutter: 18, card: 16, section: 24 }

export const LIGHT = {
  dark: false,
  base:     '#eef2fa',
  ink:      '#0a1528',
  muted:    '#5f6e88',
  card:     '#ffffff',
  cardEdge: 'rgba(255,255,255,0.68)',
  chip:     '#eef1f6',
  chipEdge: 'rgba(255,255,255,0.62)',
  hairline: 'rgba(120,144,180,0.30)',
  sheen:    0.5,
  blue: '#0a84ff', green: '#34c759', orange: '#ff9500', red: '#ff3b30', indigo: '#5e5ce6',
}

export const DARK = {
  dark: true,
  base:     '#0b101e',
  ink:      '#f2f5fc',
  muted:    '#9aa6bd',
  card:     '#1c2438',
  cardEdge: 'rgba(255,255,255,0.14)',
  chip:     '#242e46',
  chipEdge: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.10)',
  sheen:    0.14,
  blue: '#0a84ff', green: '#30d158', orange: '#ff9f0a', red: '#ff453a', indigo: '#5e5ce6',
}

// Legacy alias kept for older imports.
export const G = LIGHT

// ── Theme context ────────────────────────────────────────────────────────────

const ThemeCtx = createContext({ dark: false, T: LIGHT, setDark: () => {} })

/** Wrap the app root. Follows the system appearance until setDark() overrides it. */
export function GlassThemeProvider({ children }) {
  const system = useColorScheme()
  const [override, setOverride] = useState(null) // null → follow system
  const dark = override ?? (system === 'dark')
  const value = useMemo(() => ({ dark, T: dark ? DARK : LIGHT, setDark: setOverride }), [dark])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

/** { dark, T, setDark } — T is the active token set. */
export function useGlass() {
  return useContext(ThemeCtx)
}

// ── Opaque fill for sheets / modals / chrome ────────────────────────────────

/**
 * Absolute-fill solid backing for sheets, modals and panels — same flat
 * `fill` color on both platforms, no blur. Pass a translucent color for a
 * modal dimming scrim, or an opaque one for an actual surface (e.g. a
 * bottom sheet's own background). The parent must set borderRadius +
 * overflow:'hidden' to clip it to the sheet's rounded corners.
 */
export function GlassFill({ tint = 'light', fill }) {
  const isDark = tint === 'dark'
  const color = fill ?? (isDark ? '#101c30' : '#f0f4fc')
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color }]} />
}

// ── Specular highlight ───────────────────────────────────────────────────────

/**
 * Soft reflection across the top of a glass surface. Render as the first child
 * of any rounded card/sheet; it clips itself to `radius`.
 */
export function Sheen({ radius = RADIUS.card, opacity }) {
  const { T } = useGlass()
  const o = opacity ?? T.sheen
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="sheenV" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"    stopColor="#ffffff" stopOpacity={o * 0.55} />
            <Stop offset="0.35" stopColor="#ffffff" stopOpacity={o * 0.10} />
            <Stop offset="1"    stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="sheenD" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0"   stopColor="#ffffff" stopOpacity={o * 0.30} />
            <Stop offset="0.4" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheenV)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheenD)" />
      </Svg>
    </View>
  )
}

/**
 * Themed glass panel: translucent fill, bright hairline edge, specular sheen.
 * Layout comes from `style`; the material comes from the theme.
 */
export function GlassCard({ style, radius = RADIUS.card, sheen = true, children }) {
  const { T } = useGlass()
  return (
    <View
      style={[
        { borderRadius: radius, backgroundColor: T.card, borderWidth: 1, borderColor: T.cardEdge },
        style,
      ]}
    >
      {sheen && <Sheen radius={radius} />}
      {children}
    </View>
  )
}

// ── Backdrop washes ──────────────────────────────────────────────────────────

function Wash({ id, cx, cy, r, color, opacity }) {
  return (
    <RadialGradient id={id} cx={cx} cy={cy} r={r}>
      <Stop offset="0" stopColor={color} stopOpacity={opacity} />
      <Stop offset="1" stopColor={color} stopOpacity="0" />
    </RadialGradient>
  )
}

/**
 * Full-screen colorful backdrop. Render as the first child of the screen root.
 * Follows the active theme; pass `dark` to force an appearance (login/profile).
 */
export function GlassBackdrop({ dark: forced }) {
  const { width, height } = useWindowDimensions()
  const { dark: themeDark } = useGlass()
  const dark = forced ?? themeDark
  const base = dark ? '#0b101e' : '#eef2fa'
  const washes = dark
    ? [
        { id: 'w1', cx: '15%', cy: '10%', r: '60%', color: '#5e5ce6', opacity: 0.42 },
        { id: 'w2', cx: '90%', cy: '30%', r: '55%', color: '#0a84ff', opacity: 0.30 },
        { id: 'w3', cx: '40%', cy: '95%', r: '65%', color: '#bf5af2', opacity: 0.22 },
      ]
    : [
        { id: 'w1', cx: '12%', cy: '8%',  r: '55%', color: '#0a84ff', opacity: 0.20 },
        { id: 'w2', cx: '95%', cy: '22%', r: '55%', color: '#bf5af2', opacity: 0.16 },
        { id: 'w3', cx: '20%', cy: '80%', r: '60%', color: '#34c759', opacity: 0.13 },
        { id: 'w4', cx: '85%', cy: '95%', r: '55%', color: '#ff9500', opacity: 0.12 },
      ]
  // Bleed 120px beyond the parent on top/bottom: screens mount this inside a
  // SafeAreaView, whose insets are padding — a plain absoluteFill would leave
  // an unwashed strip under the status bar and home indicator.
  const BLEED = 120
  const h = height + BLEED * 2
  return (
    <View
      style={{ position: 'absolute', top: -BLEED, left: 0, right: 0, height: h }}
      pointerEvents="none"
    >
      <Svg width={width} height={h}>
        <Defs>
          {washes.map(w => <Wash key={w.id} {...w} />)}
        </Defs>
        <Rect x="0" y="0" width={width} height={h} fill={base} />
        {washes.map(w => (
          <Rect key={w.id} x="0" y="0" width={width} height={h} fill={`url(#${w.id})`} />
        ))}
      </Svg>
    </View>
  )
}
