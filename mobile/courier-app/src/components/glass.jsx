/**
 * Apple Liquid Glass surface kit.
 *
 * GlassBackdrop — soft colorful radial washes rendered behind every screen so
 * translucent surfaces have something to refract. Because the washes are smooth
 * gradients, a translucent white fill on top reads as blurred glass without
 * paying for a real blur on every card.
 *
 * Real BlurView is reserved for chrome (the floating tab bar) where the content
 * scrolling underneath makes actual blur worth it.
 */
import { View, StyleSheet, useWindowDimensions } from 'react-native'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'

/** Glass surface tokens — iOS system accents + translucent fills. */
export const G = {
  fill:       'rgba(255,255,255,0.58)',   // standard card glass
  fillStrong: 'rgba(255,255,255,0.72)',   // panels that need more opacity for text
  fillSoft:   'rgba(255,255,255,0.42)',   // secondary buttons, chips
  edge:       'rgba(255,255,255,0.65)',   // light border on glass edges
  hairline:   'rgba(120,144,180,0.28)',   // separators inside glass
  darkFill:   'rgba(14,24,44,0.80)',      // smoked glass (hero, dark menus)
  darkEdge:   'rgba(255,255,255,0.16)',
  blue:   '#0a84ff',
  indigo: '#5e5ce6',
  green:  '#34c759',
  orange: '#ff9500',
  red:    '#ff3b30',
}

function Wash({ id, cx, cy, r, color, opacity }) {
  return (
    <RadialGradient id={id} cx={cx} cy={cy} r={r}>
      <Stop offset="0" stopColor={color} stopOpacity={opacity} />
      <Stop offset="1" stopColor={color} stopOpacity="0" />
    </RadialGradient>
  )
}

/**
 * Full-screen colorful backdrop. Render as the first child of the screen root
 * (a plain flex:1 View), before the SafeAreaView.
 */
export function GlassBackdrop({ dark = false }) {
  const { width, height } = useWindowDimensions()
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
