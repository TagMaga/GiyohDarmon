/**
 * Apple Liquid Glass design system.
 *
 * Layers (back to front):
 *   1. GlassBackdrop — colorful radial washes so glass has something to refract
 *   2. Surfaces — translucent fills with bright hairline edges (GlassCard / tokens)
 *   3. Sheen — specular top highlight, the "reflection" signature of liquid glass
 *   4. Real blur (expo-blur) — reserved for chrome: tab bar, sheets, menus
 *
 * Appearance adapts to the system light/dark setting via GlassThemeProvider;
 * the in-app toggle (account menu) overrides it. Content cards use pseudo-glass
 * (translucent fill over smooth washes ≈ blur, at zero GPU cost); real BlurView
 * stays on chrome, which is also how Apple applies materials.
 */
import { createContext, useContext, useMemo, useState } from 'react'
import { Platform, View, StyleSheet, useColorScheme } from 'react-native'
import { BlurView } from 'expo-blur'
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg'

// ── Tokens ──────────────────────────────────────────────────────────────────

export const RADIUS = { card: 24, panel: 28, sheet: 32, chip: 999, input: 16 }
export const SPACE  = { gutter: 18, card: 16, section: 24 }

export const LIGHT = {
  dark: false,
  base:     '#eef2fa',
  ink:      '#0a1528',
  muted:    '#5f6e88',
  card:     'rgba(255,255,255,0.58)',
  cardEdge: 'rgba(255,255,255,0.68)',
  chip:     'rgba(255,255,255,0.45)',
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
  card:     'rgba(38,48,76,0.52)',
  cardEdge: 'rgba(255,255,255,0.14)',
  chip:     'rgba(255,255,255,0.08)',
  chipEdge: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.10)',
  sheen:    0.14,
  blue: '#0a84ff', green: '#30d158', orange: '#ff9f0a', red: '#ff453a', indigo: '#5e5ce6',
}

// Legacy alias kept for older imports.
export const G = LIGHT

/**
 * Android-safe elevation. `elevation` on a View that also has a translucent
 * (rgba) backgroundColor + borderRadius makes Android paint its shadow-casting
 * backdrop as an opaque, incorrectly-sized rectangle with square corners —
 * visible as a white/light box sitting inset behind the card's content. Glass
 * cards are translucent by design, so elevation must stay off on Android;
 * `shadowColor`/`shadowOffset`/`shadowOpacity`/`shadowRadius` keep driving the
 * shadow on iOS exactly as before (Android never reads those props).
 */
export const glassElevation = (n) => (Platform.OS === 'android' ? 0 : n)

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

// ── Frosted fill (real blur) for sheets / modals / chrome ───────────────────

/**
 * Absolute-fill frosted glass layer for sheets, modals and panels.
 * iOS: real UIVisualEffectView blur + a soft tint overlay so text stays readable.
 * Android: translucent solid fallback — expo-blur inside a <Modal> is unreliable
 * there, and a high-opacity tint still reads as glass over the dim.
 * The parent must set borderRadius + overflow:'hidden' to clip the blur.
 */
export function GlassFill({ tint = 'light', intensity = 55, overlay, androidFallback }) {
  const isDark = tint === 'dark'
  const wash = overlay ?? (isDark ? 'rgba(15,26,46,0.55)' : 'rgba(242,246,252,0.45)')
  const solid = androidFallback ?? (isDark ? 'rgba(16,28,48,0.94)' : 'rgba(240,244,252,0.93)')
  if (Platform.OS === 'ios') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <BlurView tint={isDark ? 'dark' : 'light'} intensity={intensity} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} />
      </View>
    )
  }
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: solid }]} />
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
 * Full-screen colorful backdrop. Mount it in an unpadded `flex: 1` wrapper
 * that sits BEHIND a SafeAreaView, not as a child of the SafeAreaView itself —
 * SafeAreaView applies insets as padding, so a backdrop mounted inside it
 * only ever measures the inset content box and leaves the status-bar/gesture-
 * bar strip uncovered. Sizes itself from onLayout, so there's no dimension
 * guessing and no gap regardless of inset size on a given device.
 * Follows the active theme; pass `dark` to force an appearance (login/profile).
 */
export function GlassBackdrop({ dark: forced }) {
  const [layout, setLayout] = useState(null)
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
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: base }]}
      pointerEvents="none"
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
    >
      {layout && (
        <Svg width={layout.width} height={layout.height}>
          <Defs>
            {washes.map(w => <Wash key={w.id} {...w} />)}
          </Defs>
          {washes.map(w => (
            <Rect key={w.id} x="0" y="0" width={layout.width} height={layout.height} fill={`url(#${w.id})`} />
          ))}
        </Svg>
      )}
    </View>
  )
}
