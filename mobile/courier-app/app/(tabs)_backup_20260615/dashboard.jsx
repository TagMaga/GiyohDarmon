import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getMyOrders, getCashSummary, getClaimableOrders } from '../../src/api/orders'
import useAuthStore from '../../src/store/authStore'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
dayjs.locale('ru')

const C = {
  bg: '#0d0f14', bg2: '#13161e', surface: '#1e2130', surface2: '#252838',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.13)',
  text: '#f0f2f8', text2: '#9095a8', text3: '#5e6478',
  accent: '#6366f1', green: '#10b981', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6',
  greenDim: 'rgba(16,185,129,0.15)', amberDim: 'rgba(245,158,11,0.15)',
  accentDim: 'rgba(99,102,241,0.12)', blueDim: 'rgba(59,130,246,0.15)',
}

const STATUS_COLOR = { confirmed: C.blue, assigned: C.accent, in_delivery: C.amber, delivered: C.green, returned: C.red }
const STATUS_LABEL = { confirmed: 'Подтверждён', assigned: 'Назначен', in_delivery: 'В пути', delivered: 'Доставлен', returned: 'Возврат' }

export default function DashboardScreen() {
  const user = useAuthStore(s => s.user)
  const [orders, setOrders] = useState([])
  const [summary, setSummary] = useState(null)
  const [availCount, setAvailCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchAll = async () => {
    try {
      const [o, s, a] = await Promise.allSettled([getMyOrders(), getCashSummary(), getClaimableOrders()])
      if (o.status === 'fulfilled') setOrders(o.value.data.data || [])
      if (s.status === 'fulfilled') setSummary(s.value.data.data)
      if (a.status === 'fulfilled') setAvailCount((a.value.data.data || []).length)
    } finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetchAll() }, [])

  const done    = orders.filter(o => o.status === 'delivered').length
  const active  = orders.filter(o => ['assigned', 'in_delivery'].includes(o.status)).length
  const inRoute = orders.filter(o => ['assigned', 'in_delivery'].includes(o.status))

  const fmt = (n) => Number(n || 0).toLocaleString()

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topbar}>
        <View style={s.tpLogo}><Text style={{ fontSize: 16 }}>🛵</Text></View>
        <Text style={s.tpName}>{user?.full_name?.split(' ')[0] || 'Курьер'}</Text>
        <View style={s.tpStatus}><View style={s.tpDot} /><Text style={s.tpStatusText}>Онлайн</Text></View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll() }} tintColor={C.accent} />}
      >
        <View style={s.inner}>
          {/* Date */}
          <Text style={s.dateText}>{dayjs().format('dddd, D MMMM')}</Text>

          {/* Stats strip */}
          <View style={s.statsGrid}>
            <View style={[s.statCard]}>
              <Text style={[s.statVal, { color: C.green }]}>{done}</Text>
              <Text style={s.statLbl}>Доставлено</Text>
            </View>
            <View style={[s.statCard]}>
              <Text style={[s.statVal, { color: C.blue }]}>{active}</Text>
              <Text style={s.statLbl}>Активных</Text>
            </View>
            <View style={[s.statCard]}>
              <Text style={[s.statVal, { color: C.amber }]}>{availCount}</Text>
              <Text style={s.statLbl}>Доступно</Text>
            </View>
            <View style={[s.statCard]}>
              <Text style={[s.statVal, { color: C.text2, fontSize: 14 }]}>{fmt(summary?.total_delivery_fees)} с.</Text>
              <Text style={s.statLbl}>Заработок</Text>
            </View>
          </View>

          {/* Quick actions */}
          <View style={s.quickRow}>
            <TouchableOpacity style={[s.qBtn, { backgroundColor: C.accent }]} onPress={() => router.push('/(tabs)/deliveries')}>
              <Text style={s.qBtnText}>📦 Доставки</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.qBtn, { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border }]} onPress={() => router.push('/(tabs)/claimable')}>
              <Text style={[s.qBtnText, { color: C.amber }]}>🎯 Захват</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.qBtn, s.qBtnSmall, { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border }]} onPress={() => { setRefreshing(true); fetchAll() }}>
              <Text style={{ color: C.text2, fontSize: 18 }}>↻</Text>
            </TouchableOpacity>
          </View>

          {/* Active deliveries */}
          {loading
            ? <ActivityIndicator color={C.accent} style={{ marginTop: 32 }} />
            : inRoute.length > 0 && (
              <View>
                <View style={s.sectionHead}>
                  <Text style={s.sectionTitle}>🚚 Активные доставки</Text>
                  <View style={s.sectionCnt}><Text style={s.sectionCntText}>{inRoute.length}</Text></View>
                </View>
                {inRoute.map(order => {
                  const color = STATUS_COLOR[order.status] || C.text3
                  return (
                    <TouchableOpacity
                      key={order.id}
                      style={[s.orderCard, { borderLeftColor: color }]}
                      onPress={() => router.push('/(tabs)/deliveries')}
                    >
                      <View style={s.ocTop}>
                        <Text style={s.ocNum}>{order.order_number}</Text>
                        <View style={[s.badge, { backgroundColor: color + '25' }]}>
                          <View style={[s.dot, { backgroundColor: color }]} />
                          <Text style={[s.badgeText, { color }]}>{STATUS_LABEL[order.status]}</Text>
                        </View>
                      </View>
                      <Text style={s.ocCustomer}>👤 {order.customer?.full_name}</Text>
                      <Text style={s.ocAddr} numberOfLines={1}>📍 {order.customer?.address || '—'}</Text>
                      <Text style={[s.ocAmount, { color }]}>💵 {fmt(order.courier_collect_amount)} TJS</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )
          }

          {/* Finance widget */}
          <View style={s.finWidget}>
            <View style={s.finHeader}>
              <Text style={s.finTitle}>💰 Финансы сегодня</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/cash')}>
                <Text style={s.finLink}>Детали →</Text>
              </TouchableOpacity>
            </View>
            <View style={s.finRow}>
              <Text style={s.finLbl}>Собрано нал.</Text>
              <Text style={s.finVal}>{fmt(summary?.cash_to_handover)} TJS</Text>
            </View>
            <View style={s.finRow}>
              <Text style={s.finLbl}>Доставок</Text>
              <Text style={[s.finVal, { color: C.green }]}>{summary?.orders_collected || 0}</Text>
            </View>
            <View style={[s.finRow, { backgroundColor: 'rgba(245,158,11,0.06)' }]}>
              <Text style={[s.finLbl, { color: C.amber }]}>Вернуть в кассу</Text>
              <Text style={[s.finVal, { color: C.amber }]}>{fmt(summary?.cash_to_handover)} TJS</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: {
    height: 48, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 9,
  },
  tpLogo: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  tpName: { fontSize: 14, fontWeight: '700', color: C.text, flex: 1 },
  tpStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(16,185,129,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  tpDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  tpStatusText: { fontSize: 10, fontWeight: '600', color: C.green },
  inner: { padding: 12, gap: 10 },
  dateText: { fontSize: 12, color: C.text2, marginBottom: 2 },
  statsGrid: { flexDirection: 'row', gap: 6 },
  statCard: { flex: 1, backgroundColor: C.surface2, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '800', lineHeight: 24 },
  statLbl: { fontSize: 10, color: C.text2, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  quickRow: { flexDirection: 'row', gap: 6 },
  qBtn: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  qBtnSmall: { flex: 0, paddingHorizontal: 14 },
  qBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.text },
  sectionCnt: { backgroundColor: C.surface2, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  sectionCntText: { fontSize: 11, color: C.text2, fontWeight: '600' },
  orderCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 3,
  },
  ocTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  ocNum: { fontSize: 13, fontWeight: '700', color: C.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  ocCustomer: { fontSize: 13, color: C.text2, marginBottom: 2 },
  ocAddr: { fontSize: 12, color: C.text3, marginBottom: 4 },
  ocAmount: { fontSize: 15, fontWeight: '800' },
  finWidget: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden', marginTop: 4 },
  finHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  finTitle: { fontSize: 12, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 0.8 },
  finLink: { fontSize: 12, color: C.accent, fontWeight: '600' },
  finRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.border },
  finLbl: { fontSize: 13, color: C.text2 },
  finVal: { fontSize: 14, fontWeight: '700', color: C.text },
})
