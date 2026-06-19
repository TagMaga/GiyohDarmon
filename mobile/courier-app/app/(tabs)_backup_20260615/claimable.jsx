import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getClaimableOrders, claimOrder } from '../../src/api/orders'

const C = {
  bg: '#0d0f14', surface: '#1e2130', surface2: '#252838',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.13)',
  text: '#f0f2f8', text2: '#9095a8', text3: '#5e6478',
  accent: '#6366f1', amber: '#f59e0b', green: '#10b981',
  greenDim: 'rgba(16,185,129,0.15)', amberDim: 'rgba(245,158,11,0.15)',
}

export default function ClaimableScreen() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [claiming, setClaiming] = useState(null)

  const fetch = async () => {
    try {
      const { data } = await getClaimableOrders()
      setOrders(data.data || [])
    } catch {}
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetch() }, [])

  const handleClaim = (order) => {
    Alert.alert('Взять заказ?', `${order.order_number} — ${order.customer?.full_name}`, [
      { text: 'Отмена', style: 'cancel' },
      { text: '🎯 Взять', onPress: async () => {
        setClaiming(order.id)
        try {
          await claimOrder(order.id)
          fetch()
          Alert.alert('Заказ взят!', 'Перейдите во вкладку «Доставки»')
        } catch (e) {
          Alert.alert('Ошибка', e.response?.data?.error?.message || 'Не удалось взять заказ')
        } finally { setClaiming(null) }
      }},
    ])
  }

  const fmt = (n) => Number(n || 0).toLocaleString()

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>🎯 Захватить заказ</Text>
          <Text style={s.headerSub}>Доступные для взятия</Text>
        </View>
        <View style={s.headerCnt}><Text style={s.headerCntText}>{orders.length}</Text></View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch() }} tintColor={C.accent} />}
        contentContainerStyle={s.listContent}
      >
        {loading
          ? <ActivityIndicator color={C.accent} style={{ marginTop: 64 }} />
          : orders.length === 0
            ? (
              <View style={s.empty}>
                <Text style={s.emptyIcon}>🎯</Text>
                <Text style={s.emptyTitle}>Нет доступных заказов</Text>
                <Text style={s.emptySub}>Потяните вниз чтобы обновить</Text>
              </View>
            )
            : orders.map((order, i) => (
              <View key={order.id} style={[s.card, i === 0 && s.cardRecommended]}>
                {i === 0 && (
                  <View style={s.recLabel}>
                    <Text style={s.recLabelText}>⭐ Рекомендован для вас</Text>
                    <Text style={s.recLabelSub}> — хорошее совпадение</Text>
                  </View>
                )}
                <View style={s.cardHead}>
                  <Text style={s.cardNum}>{order.order_number}</Text>
                  <Text style={s.cardName}>{order.customer?.full_name}</Text>
                  <View style={[s.payBadge, { backgroundColor: C.greenDim }]}>
                    <Text style={{ color: C.green, fontSize: 10, fontWeight: '700' }}>Нал</Text>
                  </View>
                </View>
                <Text style={s.cardAddr} numberOfLines={1}>📍 {order.customer?.address || '—'}</Text>
                <View style={s.cardFoot}>
                  <Text style={s.cardAmount}>{fmt(order.courier_collect_amount)} TJS</Text>
                  <TouchableOpacity
                    style={[s.claimBtn, claiming === order.id && s.claimBtnDisabled]}
                    onPress={() => handleClaim(order)}
                    disabled={!!claiming}
                  >
                    {claiming === order.id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.claimBtnText}>🎯 Принять</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            ))
        }
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  headerSub: { fontSize: 12, color: C.text2, marginTop: 2 },
  headerCnt: { backgroundColor: C.surface2, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  headerCntText: { fontSize: 12, color: C.text2, fontWeight: '600' },
  listContent: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { fontSize: 40, marginBottom: 12, opacity: 0.4 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 4 },
  emptySub: { fontSize: 12, color: C.text3 },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: C.border,
  },
  cardRecommended: { borderColor: C.amber, backgroundColor: 'rgba(245,158,11,0.06)' },
  recLabel: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  recLabelText: { fontSize: 10, fontWeight: '700', color: C.amber, textTransform: 'uppercase', letterSpacing: 0.6 },
  recLabelSub: { fontSize: 10, color: C.text2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  cardNum: { fontSize: 11, fontWeight: '700', color: C.text2 },
  cardName: { fontSize: 14, fontWeight: '600', color: C.text, flex: 1 },
  payBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  cardAddr: { fontSize: 12, color: C.text2, marginBottom: 12 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardAmount: { fontSize: 18, fontWeight: '800', color: C.text },
  claimBtn: {
    backgroundColor: C.accent, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  claimBtnDisabled: { opacity: 0.5 },
  claimBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
})
