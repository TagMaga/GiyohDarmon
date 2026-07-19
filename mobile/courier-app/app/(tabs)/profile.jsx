import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import useAuthStore from '../../src/store/authStore'
import { logout as apiLogout } from '../../src/api/auth'
import { API_URL } from '../../src/api/client'
import { GlassBackdrop, useGlass } from '../../src/components/glass'

const C = {
  bg: '#0b101e', surface: '#1c2438', surface2: '#242e46',
  border: 'rgba(255,255,255,0.12)', border2: 'rgba(255,255,255,0.20)',
  text: '#f0f2f8', text2: '#9aa2b8', text3: '#68718a',
  accent: '#0a84ff', green: '#34c759', red: '#ff453a',
  accentDim: 'rgba(10,132,255,0.16)', redDim: 'rgba(255,69,58,0.12)',
}

export default function ProfileScreen() {
  const { user, refreshToken, logout } = useAuthStore()
  const { T, dark } = useGlass()

  const handleLogout = async () => {
    Alert.alert('Выйти из аккаунта?', 'Вам нужно будет войти снова', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: async () => {
        try { await apiLogout(refreshToken) } catch {}
        await logout()
        router.replace('/(auth)/login')
      }},
    ])
  }

  const initials = user?.full_name
    ? user.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${API_URL}${user.avatar_url}`)
    : null

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={s.content}>
        {/* Avatar block */}
        <View style={s.avatarBlock}>
          <View style={[s.avatarRing, { borderColor: T.blue, shadowColor: T.blue }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImage} />
            ) : (
              <View style={[s.avatar, { backgroundColor: T.blue }]}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
            )}
          </View>
          <Text style={[s.name, { color: T.ink }]}>{user?.full_name || '—'}</Text>
          <View style={[s.roleBadge, { backgroundColor: T.chip }]}>
            <Text style={[s.roleText, { color: T.blue }]}>🛵  КУРЬЕР</Text>
          </View>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: T.green }]} />
            <Text style={[s.statusText, { color: T.green }]}>Онлайн</Text>
          </View>
        </View>

        {/* Info card */}
        <View style={[s.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
          <Text style={[s.cardTitle, { color: T.muted }]}>ИНФОРМАЦИЯ</Text>
          <InfoRow label="Телефон" value={user?.phone} last />
        </View>

        {/* Tariff card */}
        <View style={[s.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
          <Text style={[s.cardTitle, { color: T.muted }]}>ТАРИФ</Text>
          <TariffRules rules={user?.tariff_rules} />
        </View>

        {/* Logout */}
        <TouchableOpacity style={[s.logoutBtn, { borderColor: T.red }]} onPress={handleLogout}>
          <Text style={[s.logoutText, { color: T.red }]}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ label, value, last }) {
  const { T } = useGlass()
  return (
    <View style={[s.infoRow, !last && [s.infoRowBorder, { borderBottomColor: T.hairline }]]}>
      <Text style={[s.infoLabel, { color: T.muted }]}>{label}</Text>
      <Text style={[s.infoValue, { color: T.ink }]}>{value || '—'}</Text>
    </View>
  )
}

const DELIVERY_TYPE_LABEL = { normal: 'Обычная', fast: 'Срочная' }

function TariffRules({ rules }) {
  const { T } = useGlass()

  if (!rules?.length) {
    return (
      <View style={s.tariffEmpty}>
        <Text style={[s.tariffEmptyText, { color: T.muted }]}>Тариф не настроен</Text>
      </View>
    )
  }

  const groups = rules.reduce((acc, r) => {
    (acc[r.delivery_type] ??= []).push(r)
    return acc
  }, {})

  return (
    <View style={{ paddingBottom: 6 }}>
      {Object.entries(groups).map(([deliveryType, groupRules]) => (
        <View key={deliveryType}>
          <View style={s.tariffGroupHeader}>
            <Text style={[s.tariffGroupLabel, { color: T.muted }]}>{DELIVERY_TYPE_LABEL[deliveryType] ?? deliveryType}</Text>
          </View>
          {groupRules.map((r, i) => (
            <View key={r.id} style={[s.tariffRow, i < groupRules.length - 1 && [s.infoRowBorder, { borderBottomColor: T.hairline }]]}>
              <Text style={[s.tariffRange, { color: T.muted }]}>
                {r.amount_from} – {r.amount_to != null ? r.amount_to : '∞'} сом
              </Text>
              <View style={[s.tariffBadge, { backgroundColor: T.chip }]}>
                <Text style={{ color: T.blue, fontSize: 13, fontWeight: '600' }}>
                  {r.tariff_type === 'percent' ? `${r.tariff_value}%` : `${r.tariff_value} TJS`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 130 },
  avatarBlock: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarRing: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: C.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
    marginBottom: 4, position: 'relative',
  },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 76, height: 76, borderRadius: 38 },
  avatarText: { fontSize: 28, fontWeight: '600', color: '#fff' },
  name: { fontSize: 20, fontWeight: '700', color: C.text },
  roleBadge: { backgroundColor: C.accentDim, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: '700', color: C.accent, letterSpacing: 0.6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(52,199,89,0.14)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  statusText: { fontSize: 11, color: C.green, fontWeight: '600' },
  card: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden', gap: 0,
  },
  cardTitle: { fontSize: 10, fontWeight: '700', color: C.text3, letterSpacing: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
  infoLabel: { fontSize: 13, color: C.text2 },
  infoValue: { fontSize: 13, fontWeight: '600', color: C.text },
  tariffRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  tariffBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tariffGroupHeader: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  tariffGroupLabel: { fontSize: 11, fontWeight: '700', color: C.text2, letterSpacing: 0.4 },
  tariffRange: { fontSize: 13, color: C.text2 },
  tariffEmpty: { paddingHorizontal: 14, paddingVertical: 16 },
  tariffEmptyText: { fontSize: 13, color: C.text3 },
  logoutBtn: {
    backgroundColor: C.redDim, borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  logoutText: { color: C.red, fontWeight: '700', fontSize: 15 },
})
