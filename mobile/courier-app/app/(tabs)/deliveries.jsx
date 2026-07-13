import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { getMyOrders, updateOrderStatus } from '../../src/api/orders'
import { OrderDetailSheet, C } from '../../src/components/OrderDetailSheet'
import { OrderCard } from '../../src/components/OrderCard'
import { FadeSlideIn, PressScale, PulseDot, OrderCardSkeleton, animateLayout } from '../../src/components/motion'
import { GlassBackdrop, useGlass } from '../../src/components/glass'

const FILTERS = [
  { key: 'all',         label: 'Все' },
  { key: 'assigned',    label: 'Назначены' },
  { key: 'in_delivery', label: 'В Путь' },
  { key: 'delivered',   label: 'Доставлены' },
  { key: 'returned',    label: 'Возвраты' },
]

export default function DeliveriesScreen() {
  const { T }                             = useGlass()
  const [orders, setOrders]               = useState([])
  const [loading, setLoading]             = useState(true)
  const [refreshing, setRefreshing]       = useState(false)
  const [activeFilter, setActiveFilter]   = useState('all')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [openStep, setOpenStep]           = useState('detail')
  const [actionLoading, setActionLoading] = useState(false)

  const fetchOrders = async () => {
    try {
      const { data } = await getMyOrders()
      setOrders(data.data || [])
    } catch (e) {
      Alert.alert('Ошибка загрузки', e?.response?.data?.error?.message || 'Не удалось загрузить заказы')
    } finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetchOrders() }, [])

  const isUrgent = (o) => {
    const m = String(o?.delivery_method ?? o?.DeliveryMethod ?? o?.deliveryMethod ?? '').toLowerCase()
    return m === 'fast' || m === 'express'
  }
  const isActiveUrgent = (o) => {
    const status = String(o?.status ?? o?.Status ?? '').toLowerCase()
    return isUrgent(o) && !['delivered', 'returned', 'cancelled'].includes(status)
  }
  const filtered = (() => {
    const base = activeFilter === 'all' ? orders : orders.filter(o => o.status === activeFilter)
    return [...base].sort((a, b) => (isActiveUrgent(b) ? 1 : 0) - (isActiveUrgent(a) ? 1 : 0))
  })()
  const openDetail  = (order) => { setSelectedOrder(order); setOpenStep('detail'); setActionLoading(false) }
  const closeDetail = () => setSelectedOrder(null)

  const handleStart = async (order) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'in_delivery')
      closeDetail(); fetchOrders()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось начать доставку')
    } finally { setActionLoading(false) }
  }

  const handleDelivered = async (order, data = {}) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'delivered', data)
      closeDetail(); fetchOrders()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось обновить статус')
    } finally { setActionLoading(false) }
  }

  return (
    <View style={{ flex: 1, backgroundColor: T.base }}>
      <GlassBackdrop />
      <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={[s.headTitle, { color: T.ink }]}>Мои заказы</Text>
          <Text style={[s.headSub, { color: T.muted }]}>Сегодня · {orders.length} заказов</Text>
        </View>
        <View style={s.onlinePill}>
          <PulseDot color={C.green} size={8} />
          <Text style={s.onlineText}>онлайн</Text>
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterScroll}
        contentContainerStyle={s.filterRow}
      >
        {FILTERS.map(f => (
          <PressScale
            key={f.key}
            scaleTo={0.94}
            style={[s.chip, { backgroundColor: T.chip, borderColor: T.chipEdge }, activeFilter === f.key && s.chipActive]}
            onPress={() => { animateLayout(); setActiveFilter(f.key) }}
          >
            <Text
              numberOfLines={1}
              style={[s.chipText, { color: T.ink }, activeFilter === f.key && s.chipTextActive]}
            >
              {f.label}
            </Text>
          </PressScale>
        ))}
      </ScrollView>

      {/* Order list */}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOrders() }} tintColor={C.blue} />}
        contentContainerStyle={s.listContent}
      >
        {loading
          ? (<>
              <OrderCardSkeleton />
              <OrderCardSkeleton />
              <OrderCardSkeleton />
            </>)
          : filtered.length === 0
            ? (
              <FadeSlideIn>
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>📦</Text>
                  <Text style={[s.emptyTitle, { color: T.muted }]}>Нет заказов</Text>
                  <Text style={[s.emptySub, { color: T.muted }]}>Заказы появятся здесь после назначения</Text>
                </View>
              </FadeSlideIn>
            )
            : filtered.map((order, i) => (
              <FadeSlideIn key={order.id} delay={Math.min(i, 6) * 55}>
                <OrderCard
                  order={order}
                  onOpen={() => openDetail(order)}
                  onStart={handleStart}
                  actionLoading={actionLoading}
                />
              </FadeSlideIn>
            ))
        }
      </ScrollView>

      <OrderDetailSheet
        order={selectedOrder}
        onClose={closeDetail}
        onStart={handleStart}
        onDelivered={handleDelivered}
        actionLoading={actionLoading}
        onRefresh={fetchOrders}
        initialStep={openStep}
      />
      </SafeAreaView>
    </View>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  headTitle:   { fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  headSub:     { fontSize: 13, color: C.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  onlinePill:  { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(52,199,89,0.16)', borderWidth: 1, borderColor: 'rgba(52,199,89,0.28)' },
  dot:         { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  onlineText:  { fontSize: 14, fontWeight: '700', color: '#1d9a45' },
  filterScroll: { flexGrow: 0, flexShrink: 0, width: '100%' },
  filterRow:   { paddingHorizontal: 18, paddingVertical: 10, columnGap: 8, flexDirection: 'row', alignItems: 'center' },
  chip:        { minHeight: 40, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)', backgroundColor: 'rgba(255,255,255,0.45)', flexGrow: 0, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  chipActive:  { backgroundColor: C.blue, borderColor: C.blue },
  chipText:    { fontSize: 14, lineHeight: 18, fontWeight: '700', color: C.ink, flexGrow: 0, flexShrink: 0 },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 18, paddingBottom: 130, gap: 12 },
  empty:       { alignItems: 'center', paddingTop: 80 },
  emptyIcon:   { fontSize: 40, marginBottom: 12, opacity: 0.4 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.muted, marginBottom: 4 },
  emptySub:    { fontSize: 13, color: C.muted },
})
