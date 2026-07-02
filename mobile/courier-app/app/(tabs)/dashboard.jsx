import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, Alert } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getMyOrders, getCashSummary, getClaimableOrders, updateOrderStatus } from '../../src/api/orders'
import { logout as apiLogout } from '../../src/api/auth'
import useAuthStore from '../../src/store/authStore'
import { OrderDetailSheet, C } from '../../src/components/OrderDetailSheet'
import { OrderCard } from '../../src/components/OrderCard'
import { AccountMenu } from '../../src/components/AccountMenu'
import Avatar from '../../src/components/Avatar'
import { FadeSlideIn, PressScale, CountUp, PulseDot, Skeleton, OrderCardSkeleton, animateLayout } from '../../src/components/motion'
import { GlassBackdrop } from '../../src/components/glass'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
dayjs.locale('ru')

export default function DashboardScreen() {
  const { user, refreshToken, logout } = useAuthStore()
  const [orders, setOrders]           = useState([])
  const [summary, setSummary]         = useState(null)
  const [availCount, setAvailCount]   = useState(0)
  const [loading, setLoading]         = useState(true)
  const [refreshing, setRefreshing]   = useState(false)
  const [detailOrder, setDetailOrder] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [isOnline, setIsOnline]       = useState(true)
  const [menuOpen, setMenuOpen]       = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [darkTheme, setDarkTheme]     = useState(false)

  const fetchAll = async () => {
    try {
      const [o, s, a] = await Promise.allSettled([getMyOrders(), getCashSummary(), getClaimableOrders()])
      if (o.status === 'fulfilled') setOrders(o.value.data.data || [])
      if (s.status === 'fulfilled') setSummary(s.value.data.data)
      if (a.status === 'fulfilled') setAvailCount((a.value.data.data || []).length)
    } finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetchAll() }, [])

  const handleStart = async (order) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'in_delivery')
      setDetailOrder(null); fetchAll()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось начать доставку')
    } finally { setActionLoading(false) }
  }

  const handleDelivered = async (order, data = {}) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'delivered', data)
      setDetailOrder(null); fetchAll()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось обновить статус')
    } finally { setActionLoading(false) }
  }

  const handleLogout = () => {
    Alert.alert('Выйти из аккаунта?', 'Вам нужно будет войти снова', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: async () => {
        try { await apiLogout(refreshToken) } catch {}
        await logout()
        setMenuOpen(false)
        router.replace('/(auth)/login')
      }},
    ])
  }

  const getStatus = (o) => String(o?.status ?? o?.Status ?? '').toLowerCase()
  const getPayout = (o) => Number(o?.courier_payout ?? o?.CourierPayout ?? o?.delivery_fee ?? o?.DeliveryFee ?? 0)
  const deliveredOrders = orders.filter(o => getStatus(o) === 'delivered')
  const done     = deliveredOrders.length
  const active   = orders.filter(o => ['assigned', 'in_delivery'].includes(getStatus(o))).length
  const inRoute  = orders.filter(o => ['assigned', 'in_delivery'].includes(getStatus(o)))
  const firstName = user?.full_name?.split(' ')[0] || 'Курьер'
  const initial   = firstName[0] || 'К'
  const fmt = (n) => Number(n || 0).toLocaleString()
  const salary    = deliveredOrders.reduce((sum, o) => sum + getPayout(o), 0)
  const collected = summary?.cash_to_handover || 0

  return (
    <SafeAreaView style={[s.safe, darkTheme && s.safeDark]}>
      <GlassBackdrop dark={darkTheme} />
      <ScrollView
        style={[{ flex: 1 }, darkTheme && s.scrollDark]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll() }} tintColor={C.blue} />}
        contentContainerStyle={s.content}
      >
        {/* Top bar */}
        <View style={s.top}>
          <TouchableOpacity style={s.profile} activeOpacity={0.82} onPress={() => setMenuOpen(true)}>
            <Avatar uri={user?.avatar_url} name={user?.full_name} fallback={initial} size={52} radius={19} color="#101827" />
            <View style={{ minWidth: 0 }}>
              <Text style={s.name}>{firstName}</Text>
              <Text style={s.sub}>Курьер · MegaMall</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.onlineBtn, !isOnline && s.offlineBtn]}
            onPress={() => { animateLayout(); setIsOnline(v => !v) }}
          >
            <PulseDot color={isOnline ? C.green : '#8a93a3'} size={8} active={isOnline} />
            <Text style={[s.onlineText, !isOnline && s.offlineText]}>{isOnline ? 'На линии' : 'Не на линии'}</Text>
          </TouchableOpacity>
        </View>

        {/* Hero */}
        <FadeSlideIn delay={0}>
          <View style={s.hero}>
            <Text style={s.heroSmall}>заработок сегодня</Text>
            <CountUp value={salary} style={s.heroMoney} suffix=" TJS" duration={900} />
            <Text style={s.heroParagraph}>{done} доставок · {fmt(collected)} TJS наличные на руках</Text>
          </View>
        </FadeSlideIn>

        {/* KPI bubbles */}
        <FadeSlideIn delay={70}>
          <View style={s.kpis}>
            <PressScale style={s.kpi} scaleTo={0.94} onPress={() => router.push('/(tabs)/deliveries')}>
              <CountUp value={done} style={[s.kpiNum, { color: C.green }]} />
              <Text style={s.kpiLabel}>доставлено</Text>
            </PressScale>
            <PressScale style={s.kpi} scaleTo={0.94} onPress={() => router.push('/(tabs)/deliveries')}>
              <CountUp value={active} style={[s.kpiNum, { color: C.blue }]} />
              <Text style={s.kpiLabel}>активный</Text>
            </PressScale>
            <PressScale style={s.kpi} scaleTo={0.94} onPress={() => router.push('/(tabs)/claimable')}>
              <CountUp value={availCount} style={[s.kpiNum, { color: C.orange }]} />
              <Text style={s.kpiLabel}>доступно</Text>
            </PressScale>
          </View>
        </FadeSlideIn>

        {loading
          ? (
            <View style={{ gap: 12 }}>
              <View style={s.sectionHead}><Skeleton width={140} height={22} /></View>
              <OrderCardSkeleton />
              <OrderCardSkeleton />
            </View>
          )
          : (
            <>
              {inRoute.length > 0 && (
                <>
                  <FadeSlideIn delay={140}>
                    <View style={s.sectionHead}>
                      <Text style={s.sectionTitle}>Сейчас</Text>
                      <TouchableOpacity onPress={() => router.push('/(tabs)/deliveries')}>
                        <Text style={s.link}>Все</Text>
                      </TouchableOpacity>
                    </View>
                  </FadeSlideIn>
                  {inRoute.map((order, i) => (
                    <FadeSlideIn key={order.id} delay={180 + Math.min(i, 5) * 60} style={{ marginBottom: 12 }}>
                      <OrderCard
                        order={order}
                        onOpen={() => { setDetailOrder(order); setActionLoading(false) }}
                        onStart={handleStart}
                        actionLoading={actionLoading}
                      />
                    </FadeSlideIn>
                  ))}
                </>
              )}

              <FadeSlideIn delay={inRoute.length > 0 ? 240 : 140}>
                <View style={s.sectionHead}>
                  <Text style={s.sectionTitle}>Статус дня</Text>
                </View>
                <View style={[s.card, s.statusCard]}>
                  <View style={s.iconBox}><Text style={{ fontSize: 26 }}>🔥</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.statusTitle}>{done} доставок сегодня</Text>
                    <Text style={s.statusSub}>Рейтинг 4.9 · {fmt(salary)} TJS заработано</Text>
                  </View>
                </View>
              </FadeSlideIn>
            </>
          )
        }
      </ScrollView>

      {/* Modern light bottom sheet — same component as Deliveries screen */}
      <OrderDetailSheet
        order={detailOrder}
        onClose={() => setDetailOrder(null)}
        onStart={handleStart}
        onDelivered={handleDelivered}
        actionLoading={actionLoading}
        onRefresh={fetchAll}
      />

      <AccountMenu
        visible={menuOpen}
        user={user}
        isOnline={isOnline}
        notificationsEnabled={notificationsEnabled}
        darkTheme={darkTheme}
        onClose={() => setMenuOpen(false)}
        onRefresh={fetchAll}
        onToggleOnline={() => setIsOnline(v => !v)}
        onToggleNotifications={() => setNotificationsEnabled(v => !v)}
        onToggleDarkTheme={() => setDarkTheme(v => !v)}
        onLogout={handleLogout}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: C.bg },
  safeDark: { backgroundColor: '#0b1220' },
  scrollDark: { backgroundColor: 'transparent' },
  content: { padding: 18, paddingBottom: 130 },
  top:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, marginTop: 6, gap: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 13, flex: 1, minWidth: 0 },
  name:    { fontSize: 22, fontWeight: '700', color: C.ink, lineHeight: 26 },
  sub:     { fontSize: 13, color: C.muted, fontWeight: '700', marginTop: 3 },
  onlineBtn:  { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(52,199,89,0.16)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.28)' },
  offlineBtn: { backgroundColor: 'rgba(255,255,255,0.42)', borderColor: 'rgba(255,255,255,0.60)' },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  dotOff:     { backgroundColor: '#8a93a3' },
  onlineText: { fontSize: 14, fontWeight: '700', color: '#07884e' },
  offlineText: { color: '#657084' },
  hero:       { borderRadius: 28, padding: 26, marginBottom: 16, backgroundColor: 'rgba(12,22,42,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  heroSmall:  { fontSize: 14, color: 'rgba(255,255,255,0.68)', fontWeight: '600', marginBottom: 10 },
  heroMoney:  { fontSize: 52, fontWeight: '700', letterSpacing: -2, lineHeight: 56, color: '#fff' },
  heroParagraph: { marginTop: 12, fontSize: 15, color: 'rgba(255,255,255,0.82)', fontWeight: '700' },
  kpis:    { flexDirection: 'row', gap: 10, marginBottom: 24 },
  kpi:     { flex: 1, backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 22, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)', shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 14, elevation: 2 },
  kpiNum:  { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  kpiLabel: { fontSize: 12, color: C.muted, fontWeight: '600', marginTop: 4 },
  sectionHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: C.ink },
  link:    { fontSize: 15, fontWeight: '700', color: C.blue },
  card:    { backgroundColor: C.card, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)', shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 18, elevation: 2 },
  statusCard:  { flexDirection: 'row', alignItems: 'center', gap: 15, padding: 18 },
  iconBox:     { width: 60, height: 60, borderRadius: 22, backgroundColor: 'rgba(10,132,255,0.12)', justifyContent: 'center', alignItems: 'center' },
  statusTitle: { fontSize: 19, fontWeight: '700', color: C.ink, marginBottom: 6 },
  statusSub:   { fontSize: 14, color: C.muted, fontWeight: '600' },
})
