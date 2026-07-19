import { View, Text, Image, StyleSheet } from 'react-native'
import { API_URL } from '../api/client'

export function resolveMediaUrl(url) {
  if (!url) return null
  return url.startsWith('http') ? url : `${API_URL}${url}`
}

export function getInitialsFromName(name) {
  const trimmed = name?.trim()
  if (!trimmed) return '?'
  return trimmed.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
}

/**
 * Avatar — shows the real photo when `uri` is set, otherwise falls back to
 * initials derived from `name` (or `fallback` text) on a colored circle.
 */
export default function Avatar({ uri, name, fallback, size = 44, radius, color = '#6366f1', textColor = '#fff' }) {
  const resolved = resolveMediaUrl(uri)
  const initials = fallback ?? getInitialsFromName(name)
  const circle = { width: size, height: size, borderRadius: radius ?? size / 2 }

  if (resolved) {
    return <Image source={{ uri: resolved }} style={[circle, s.image]} />
  }
  return (
    <View style={[circle, s.fallback, { backgroundColor: color }]}>
      <Text style={[s.text, { color: textColor, fontSize: size * 0.4 }]}>{initials}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  image: { backgroundColor: '#e2e8f0' },
  fallback: { justifyContent: 'center', alignItems: 'center' },
  text: { fontWeight: '600' },
})
