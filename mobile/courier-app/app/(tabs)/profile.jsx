import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Image } from 'react-native'
import { ChevronRight, KeyRound, LogOut, Package } from 'lucide-react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import useAuthStore from '../../src/store/authStore'
import { logout as apiLogout } from '../../src/api/auth'
import { API_URL } from '../../src/api/client'
import { getMyWarehouse } from '../../src/api/warehouse'
import { GlassBackdrop, useGlass } from '../../src/components/glass'

export default function ProfileScreen() {
  const { user, refreshToken, logout } = useAuthStore()
  const { T, dark } = useGlass()
  const [warehouse, setWarehouse] = useState(null)

  useFocusEffect(useCallback(() => {
    let cancelled = false
    getMyWarehouse().then((res) => {
      if (!cancelled) setWarehouse(res.data?.data ?? res.data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, []))

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

  const pendingCount = warehouse?.pending_transfers?.length ?? 0
  const itemsCount = warehouse?.items?.length ?? 0
  const itemsLabel = itemsCount > 0 ? `${itemsCount} товаров на складе` : 'Склад пуст'

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={s.content}>
        {/* Avatar block */}
        <View style={s.avatarRow}>
          <View style={[s.avatarRing, { borderColor: T.blue, shadowColor: T.blue }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={s.avatarImage} />
            ) : (
              <View style={[s.avatar, { backgroundColor: T.blue }]}>
                <Text style={s.avatarText}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={s.avatarInfo}>
            <Text style={[s.name, { color: T.ink }]} numberOfLines={1}>{user?.full_name || '—'}</Text>
            <View style={s.avatarMetaRow}>
              <View style={[s.roleBadge, { backgroundColor: T.chip }]}>
                <Text style={[s.roleText, { color: T.blue }]}>🛵  КУРЬЕР</Text>
              </View>
              <Text style={[s.phone, { color: T.muted }]} numberOfLines={1}>{user?.phone || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Quick actions */}
        <View style={s.section}>
          <Text style={[s.sectionLabel, { color: T.muted }]}>БЫСТРЫЕ ДЕЙСТВИЯ</Text>

          <TouchableOpacity
            style={[s.warehouseCard, { backgroundColor: T.blue, shadowColor: T.blue }]}
            onPress={() => router.push('/warehouse')}
            activeOpacity={0.85}
          >
            <View style={s.warehouseIcon}>
              <Package size={20} color="#ffffff" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.warehouseTitle}>Мой склад</Text>
              <Text style={s.warehouseSubtitle}>{itemsLabel}</Text>
            </View>
            <View style={s.warehouseRight}>
              {pendingCount > 0 && (
                <View style={s.warehouseBadge}>
                  <Text style={[s.warehouseBadgeText, { color: T.blue }]}>{pendingCount}</Text>
                </View>
              )}
              <ChevronRight size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionTile, { backgroundColor: T.card, borderColor: T.cardEdge }]}
            onPress={() => router.push('/change-password')}
            activeOpacity={0.7}
          >
            <View style={[s.actionIconWrap, { backgroundColor: T.chip }]}>
              <KeyRound size={18} color={T.muted} strokeWidth={1.8} />
            </View>
            <Text style={[s.actionLabel, { color: T.ink }]}>Изменить пароль</Text>
            <ChevronRight size={16} color={T.muted} />
          </TouchableOpacity>
        </View>

        {/* Tariff card */}
        <View style={[s.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
          <TariffCard rules={user?.tariff_rules} />
        </View>

        {/* Logout */}
        <TouchableOpacity style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <LogOut size={16} color={T.red} strokeWidth={2} />
          <Text style={[s.logoutText, { color: T.red }]}>Выйти из аккаунта</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const DELIVERY_TYPE_LABEL = { normal: 'Обычная', fast: 'Срочная' }
const DELIVERY_TYPE_ORDER = ['normal', 'fast']

function TariffCard({ rules }) {
  const { T } = useGlass()
  const groups = (rules ?? []).reduce((acc, r) => {
    (acc[r.delivery_type] ??= []).push(r)
    return acc
  }, {})
  const availableTypes = DELIVERY_TYPE_ORDER.filter((t) => groups[t]?.length)
  const [selected, setSelected] = useState(availableTypes[0] ?? 'normal')
  const activeType = availableTypes.includes(selected) ? selected : availableTypes[0]
  const activeRules = activeType ? (groups[activeType] ?? []) : []

  return (
    <View>
      <View style={s.tariffHeader}>
        <Text style={[s.sectionLabel, { color: T.muted, paddingLeft: 0 }]}>ТАРИФ</Text>
        {availableTypes.length > 1 && (
          <View style={[s.segment, { backgroundColor: T.chip }]}>
            {DELIVERY_TYPE_ORDER.map((type) => (
              <TouchableOpacity
                key={type}
                onPress={() => setSelected(type)}
                style={[
                  s.segmentItem,
                  activeType === type && [s.segmentItemActive, { backgroundColor: T.card }],
                ]}
              >
                <Text style={[s.segmentText, { color: activeType === type ? T.ink : T.muted }]}>
                  {DELIVERY_TYPE_LABEL[type]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {activeRules.length === 0 ? (
        <View style={s.tariffEmpty}>
          <Text style={[s.tariffEmptyText, { color: T.muted }]}>Тариф не настроен</Text>
        </View>
      ) : (
        <View style={{ paddingBottom: 6 }}>
          {activeRules.map((r, i) => (
            <View key={r.id} style={[s.tariffRow, i < activeRules.length - 1 && [s.infoRowBorder, { borderBottomColor: T.hairline }]]}>
              <Text style={[s.tariffRange, { color: T.muted }]}>
                {r.amount_from} – {r.amount_to != null ? r.amount_to : '∞'} c
              </Text>
              <View style={[s.tariffBadge, { backgroundColor: T.chip }]}>
                <Text style={{ color: T.blue, fontSize: 13, fontWeight: '600' }}>
                  {r.tariff_type === 'percent' ? `${r.tariff_value}%` : `${r.tariff_value} c`}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 130 },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 8 },
  avatarRing: {
    width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 20, elevation: 6,
  },
  avatar: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 60, height: 60, borderRadius: 30 },
  avatarText: { fontSize: 21, fontWeight: '600', color: '#fff' },
  avatarInfo: { flex: 1, minWidth: 0, gap: 5 },
  name: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  avatarMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  roleBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  roleText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
  phone: { fontSize: 12.5, flexShrink: 1 },

  section: { gap: 8 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, paddingLeft: 2 },

  warehouseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, padding: 15,
    shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 24, elevation: 6,
  },
  warehouseIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.20)', alignItems: 'center', justifyContent: 'center' },
  warehouseTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  warehouseSubtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.78)', marginTop: 2 },
  warehouseRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  warehouseBadge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  warehouseBadgeText: { fontSize: 12, fontWeight: '700' },

  actionTile: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 13,
    shadowColor: '#101c38', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  actionIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 13.5, fontWeight: '600', flex: 1 },

  card: {
    borderRadius: 14, borderWidth: 1, overflow: 'hidden', padding: 14,
    shadowColor: '#101c38', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  tariffHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  segment: { flexDirection: 'row', gap: 4, borderRadius: 9, padding: 3 },
  segmentItem: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  segmentItemActive: { shadowColor: '#101c38', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 2, elevation: 1 },
  segmentText: { fontSize: 11.5, fontWeight: '700' },
  infoRowBorder: { borderBottomWidth: 1 },
  tariffRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  tariffBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  tariffRange: { fontSize: 13 },
  tariffEmpty: { paddingVertical: 16 },
  tariffEmptyText: { fontSize: 13 },

  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 2,
  },
  logoutText: { fontSize: 14.5, fontWeight: '700' },
})
