/**
 * Shared motion primitives for the courier app.
 * Built on the core Animated API only — no extra native dependencies,
 * so Expo Go and EAS builds keep working unchanged.
 *
 * Motion language:
 *  - entrances: soft spring, 14px rise + fade, staggered 60ms per item
 *  - presses:   scale to 0.97 with a quick spring back
 *  - loading:   pulsing skeleton blocks instead of spinners
 *  - counters:  money/KPI numbers count up to their value
 */
import { useEffect, useRef, useState } from 'react'
import {
  Animated, Easing, LayoutAnimation, Platform, Pressable, StyleSheet, UIManager,
} from 'react-native'
import { useGlass } from './glass'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

/** Smooth list/layout transition for the next state update (filter switches, item removal). */
export function animateLayout() {
  LayoutAnimation.configureNext({
    duration: 260,
    create:  { type: 'easeInEaseOut', property: 'opacity' },
    update:  { type: 'spring', springDamping: 0.9 },
    delete:  { type: 'easeInEaseOut', property: 'opacity' },
  })
}

/**
 * Rise-in entrance. Use `delay={index * 60}` for staggered lists.
 *
 * Slide only, no opacity fade: every surface this wraps (cards, KPI
 * bubbles) is now fully opaque by design, and animating opacity from 0
 * meant it passed through a partially-transparent state on every mount —
 * which, sitting over the colorful backdrop, looked exactly like the old
 * translucent "liquid glass" style flashing in before settling solid.
 */
export function FadeSlideIn({ children, delay = 0, from = 14, style }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.spring(progress, {
      toValue: 1, delay, useNativeDriver: true, damping: 18, stiffness: 160, mass: 0.8,
    }).start()
  }, [])
  return (
    <Animated.View
      style={[style, {
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  )
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** Pressable with tactile spring scale. Drop-in replacement for TouchableOpacity. */
export function PressScale({ children, style, onPress, onLongPress, disabled, scaleTo = 0.97, hitSlop }) {
  const scale = useRef(new Animated.Value(1)).current
  const to = (v) => Animated.spring(scale, {
    toValue: v, useNativeDriver: true, damping: 16, stiffness: 300, mass: 0.6,
  }).start()
  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      onPressIn={() => to(scaleTo)}
      onPressOut={() => to(1)}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressable>
  )
}

/** Number that counts up to `value`. Re-animates when value changes. */
export function CountUp({ value, style, suffix = '', duration = 700, format }) {
  const anim = useRef(new Animated.Value(0)).current
  const fromRef = useRef(0)
  const [display, setDisplay] = useState(0)
  const target = Number(value || 0)

  useEffect(() => {
    const from = fromRef.current
    if (from === target) { setDisplay(target); return }
    anim.setValue(0)
    const id = anim.addListener(({ value: t }) => {
      setDisplay(Math.round(from + (target - from) * t))
    })
    Animated.timing(anim, {
      toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start(() => { fromRef.current = target; anim.removeListener(id) })
    return () => anim.removeListener(id)
  }, [target])

  const text = format ? format(display) : display.toLocaleString()
  return <Animated.Text style={style}>{text}{suffix}</Animated.Text>
}

/** Status dot with a soft expanding pulse ring (online indicator). */
export function PulseDot({ color = '#12b76a', size = 8, active = true }) {
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!active) { pulse.setValue(0); return }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [active])
  return (
    <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {active && (
        <Animated.View
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      )}
      <Animated.View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </Animated.View>
  )
}

/** Pulsing skeleton block for loading states. */
export function Skeleton({ width = '100%', height = 16, radius = 10, style }) {
  const { dark } = useGlass()
  const pulse = useRef(new Animated.Value(0.45)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1,    duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  return (
    <Animated.View
      style={[sk.base, dark && sk.baseDark, { width, height, borderRadius: radius, opacity: pulse }, style]}
    />
  )
}

/** Ready-made skeleton that mirrors an OrderCard while lists load. */
export function OrderCardSkeleton() {
  const { T } = useGlass()
  return (
    <Animated.View style={[sk.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
      <Animated.View style={sk.row}>
        <Skeleton width={110} height={14} />
        <Skeleton width={78} height={22} radius={999} />
      </Animated.View>
      <Skeleton width="62%" height={16} style={{ marginTop: 14 }} />
      <Skeleton width="85%" height={12} style={{ marginTop: 8 }} />
      <Skeleton width={120} height={18} style={{ marginTop: 14 }} />
      <Animated.View style={[sk.row, { marginTop: 14, gap: 8 }]}>
        <Skeleton height={44} radius={16} style={{ flex: 1 }} />
        <Skeleton height={44} radius={16} style={{ flex: 1 }} />
      </Animated.View>
    </Animated.View>
  )
}

const sk = StyleSheet.create({
  base: { backgroundColor: 'rgba(130,152,186,0.28)' },
  baseDark: { backgroundColor: 'rgba(255,255,255,0.12)' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.50)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)',
    padding: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
