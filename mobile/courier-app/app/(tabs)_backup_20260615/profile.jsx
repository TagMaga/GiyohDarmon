import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import useAuthStore from '../../src/store/authStore'
import { logout as apiLogout } from '../../src/api/auth'

const C = {
  bg: '#0d0f14', surface: '#1e2130', surface2: '#252838',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.13)',
  text: '#f0f2f8', text2: '#9095a8', text3: '#5e6478',
  accent: '#6366f1', green: '#10b981', red: '#ef4444',
  accentDim: 'rgba(99,102,241,0.15)', redDim: 'rgba(239,68,68,0.1)',
}

export default function ProfileScreen() {
  const { user, refreshToken, logout } = useAuthStore()

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

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        {/* Avatar block */}
        <View style={s.avatarBlock}>
          <View style={s.avatarRing}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>
          <Text style={s.name}>{user?.full_name || '—'}</Text>
          <View style={s.roleBadge}>
            <Text style={s.roleText}>🛵  КУРЬЕР</Text>
          </View>
          <View style={s.statusPill}>
            <View style={s.statusDot} />
            <Text style={s.statusText}>Онлайн</Text>
          </View>
        </View>

        {/* Info card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>ИНФОРМАЦИЯ</Text>
          <InfoRow label="Телефон" value={user?.phone} />
          <InfoRow label="Email" value={user?.email} last />
        </View>

        {/* Tariff card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>ТАРИФ</Text>
          <View style={s.tariffRow}>
            <View>
              <Text style={s.tariffVal}>{user?.courier_profile?.delivery_fee || '—'} TJS</Text>
              <Text style={s.tariffLbl}>за доставку</Text>
            </View>
            <View style={[s.tariffBadge, { backgroundColor: C.accentDim }]}>
              <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>Стандарт</Text>
            </View>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
          <Text style={s.logoutText}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[s.infoRow, !last && s.infoRowBorder]}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value || '—'}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  avatarBlock: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarRing: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: C.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 8,
    marginBottom: 4,
  },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  name: { fontSize: 20, fontWeight: '700', color: C.text },
  roleBadge: { backgroundColor: C.accentDim, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontWeight: '700', color: C.accent, letterSpacing: 0.6 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(16,185,129,0.12)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99 },
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
  tariffRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 14 },
  tariffVal: { fontSize: 22, fontWeight: '800', color: C.text },
  tariffLbl: { fontSize: 11, color: C.text3, marginTop: 1 },
  tariffBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  logoutBtn: {
    backgroundColor: C.redDim, borderRadius: 12, paddingVertical: 15, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  logoutText: { color: C.red, fontWeight: '700', fontSize: 15 },
})
