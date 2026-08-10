import { useCallback, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl, Alert, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { getMyOrders, updateOrderStatus } from '../../src/api/orders'
import { OrderDetailSheet, BottomSheet, C } from '../../src/components/OrderDetailSheet'
import { OrderCard } from '../../src/components/OrderCard'
import { FadeSlideIn, PressScale, PulseDot, OrderCardSkeleton, animateLayout } from '../../src/components/motion'
import { GlassBackdrop, useGlass } from '../../src/components/glass'
import { dayjsTZ } from '../../src/utils/date'

const FILTERS = [
  { key: 'all',         label: 'Все' },
  { key: 'assigned',    label: 'Назначены' },
  { key: 'in_delivery', label: 'В Путь' },
  { key: 'delivered',   label: 'Доставлены' },
  { key: 'returned',    label: 'Возвраты' },
]

const PERIOD_PRESETS = [
  { key: 'today', label: 'Сегодня',    get: () => { const t = dayjsTZ().format('YYYY-MM-DD'); return { from: t, to: t } } },
  { key: '7d',    label: '7 дней',     get: () => ({ from: dayjsTZ().subtract(6, 'day').format('YYYY-MM-DD'), to: dayjsTZ().format('YYYY-MM-DD') }) },
  { key: 'month', label: 'Этот месяц', get: () => ({ from: dayjsTZ().startOf('month').format('YYYY-MM-DD'), to: dayjsTZ().format('YYYY-MM-DD') }) },
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
  const [error, setError]                 = useState(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [periodFrom, setPeriodFrom]       = useState('')
  const [periodTo, setPeriodTo]           = useState('')
  const [amountMin, setAmountMin]         = useState('')
  const [amountMax, setAmountMax]         = useState('')

  const fetchOrders = async () => {
    try {
      const { data } = await getMyOrders()
      setOrders(data.data || [])
      setHasLoadedOnce(true)
      setError(null)
    } catch (e) {
      setError(e?.response?.data?.error?.message || 'Не удалось загрузить заказы')
    } finally { setLoading(false); setRefreshing(false) }
  }

  // useFocusEffect (not useEffect) so returning to this tab after claiming an
  // order, changing a status, etc. always shows current data — expo-router's
  // Tabs keep every tab screen mounted, so a mount-only effect only ever ran
  // once and left the list stale until a manual pull-to-refresh.
  useFocusEffect(useCallback(() => {
    fetchOrders()
    const refreshTimer = setInterval(fetchOrders, 30_000)
    return () => clearInterval(refreshTimer)
  }, []))

  const isUrgent = (o) => {
    const m = String(o?.delivery_method ?? o?.DeliveryMethod ?? o?.deliveryMethod ?? '').toLowerCase()
    return m === 'fast' || m === 'express'
  }
  const isActiveUrgent = (o) => {
    const status = String(o?.status ?? o?.Status ?? '').toLowerCase()
    return isUrgent(o) && !['delivered', 'returned', 'cancelled'].includes(status)
  }
  // Period/amount filter layer on top of the existing status filter — same
  // `filtered` list, `activeFilter` unchanged, courier still gets there in
  // one tap from the status row.
  const periodActive = Boolean(periodFrom && periodTo)
  const amountActive = Boolean(amountMin || amountMax)
  const extraFilterCount = (periodActive ? 1 : 0) + (amountActive ? 1 : 0)
  const filtered = (() => {
    let base = activeFilter === 'all' ? orders : orders.filter(o => o.status === activeFilter)
    if (periodActive) {
      base = base.filter(o => {
        if (!o.created_at) return false
        const d = dayjsTZ(o.created_at).format('YYYY-MM-DD')
        return d >= periodFrom && d <= periodTo
      })
    }
    if (amountActive) {
      base = base.filter(o => {
        const amt = Number(o.amount_to_collect ?? o.courier_collect_amount ?? 0)
        if (amountMin && amt < Number(amountMin)) return false
        if (amountMax && amt > Number(amountMax)) return false
        return true
      })
    }
    return [...base].sort((a, b) => (isActiveUrgent(b) ? 1 : 0) - (isActiveUrgent(a) ? 1 : 0))
  })()
  function resetExtraFilters() {
    setPeriodFrom(''); setPeriodTo(''); setAmountMin(''); setAmountMax('')
  }
  const openDetail  = (order) => { setSelectedOrder(order); setOpenStep('detail'); setActionLoading(false) }
  const closeDetail = () => setSelectedOrder(null)

  const handleStart = async (order) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'in_delivery')
      // Keep the detail sheet open — just refresh its status in place — so the
      // courier can go straight on to "Доставлен" without reopening it.
      setSelectedOrder((prev) => (prev && prev.id === order.id ? { ...prev, status: 'in_delivery' } : prev))
      fetchOrders()
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
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={[s.headTitle, { color: T.ink }]}>Мои заказы</Text>
          <Text style={[s.headSub, { color: T.muted }]}>
            {extraFilterCount > 0 || activeFilter !== 'all' ? `Найдено · ${filtered.length} заказов` : `Сегодня · ${orders.length} заказов`}
          </Text>
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
        <PressScale
          scaleTo={0.94}
          style={[s.chip, { backgroundColor: T.chip, borderColor: T.chipEdge }, extraFilterCount > 0 && s.chipActive]}
          onPress={() => setFilterPanelOpen(true)}
        >
          <Text style={[s.chipText, { color: T.ink }, extraFilterCount > 0 && s.chipTextActive]}>
            {extraFilterCount > 0 ? `Фильтры · ${extraFilterCount}` : 'Фильтры'}
          </Text>
        </PressScale>

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

      {hasLoadedOnce && error && (
        <View style={[s.inlineError, { backgroundColor: T.chip, borderColor: T.chipEdge }]}>
          <Text style={[s.inlineErrorText, { color: T.muted }]} numberOfLines={1}>⚠️ Не удалось загрузить заказы</Text>
          <TouchableOpacity onPress={() => fetchOrders()}>
            <Text style={s.inlineErrorRetry}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

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
          : (!hasLoadedOnce && error)
            ? (
              <FadeSlideIn>
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>📦</Text>
                  <Text style={[s.emptyTitle, { color: T.muted }]}>Не удалось загрузить</Text>
                  <Text style={[s.emptySub, { color: T.muted }]}>Проверьте соединение и попробуйте снова</Text>
                  <TouchableOpacity style={s.retryBtn} onPress={() => { setLoading(true); fetchOrders() }}>
                    <Text style={s.retryText}>Повторить</Text>
                  </TouchableOpacity>
                </View>
              </FadeSlideIn>
            )
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

      <BottomSheet visible={filterPanelOpen} onClose={() => setFilterPanelOpen(false)} height={520}>
        <View style={s.panelHeader}>
          <Text style={[s.panelTitle, { color: T.ink }]}>Фильтры</Text>
          <Text style={[s.panelSub, { color: T.muted }]}>
            {extraFilterCount > 0 ? `${extraFilterCount} активных` : 'Нет активных фильтров'}
          </Text>
        </View>

        <Text style={[s.panelLabel, { color: T.muted }]}>Период</Text>
        <View style={s.presetRow}>
          {PERIOD_PRESETS.map(p => {
            const range = p.get()
            const active = periodFrom === range.from && periodTo === range.to
            return (
              <PressScale
                key={p.key}
                scaleTo={0.94}
                style={[s.presetChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, active && s.chipActive]}
                onPress={() => { setPeriodFrom(range.from); setPeriodTo(range.to) }}
              >
                <Text style={[s.chipText, { color: T.ink }, active && s.chipTextActive]}>{p.label}</Text>
              </PressScale>
            )
          })}
          {periodActive && (
            <PressScale scaleTo={0.94} style={s.presetClear} onPress={() => { setPeriodFrom(''); setPeriodTo('') }}>
              <Text style={[s.chipText, { color: C.blue }]}>Сброс</Text>
            </PressScale>
          )}
        </View>

        <Text style={[s.panelLabel, { color: T.muted }]}>Статус</Text>
        <View style={s.presetRow}>
          {FILTERS.map(f => (
            <PressScale
              key={f.key}
              scaleTo={0.94}
              style={[s.presetChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, activeFilter === f.key && s.chipActive]}
              onPress={() => setActiveFilter(f.key)}
            >
              <Text style={[s.chipText, { color: T.ink }, activeFilter === f.key && s.chipTextActive]}>{f.label}</Text>
            </PressScale>
          ))}
        </View>

        <Text style={[s.panelLabel, { color: T.muted }]}>Сумма к получению</Text>
        <View style={s.amountRow}>
          <TextInput
            style={[s.amountInput, { borderColor: T.chipEdge, color: T.ink }]}
            keyboardType="numeric"
            placeholder="От, c"
            placeholderTextColor={T.muted}
            value={amountMin}
            onChangeText={setAmountMin}
          />
          <Text style={{ color: T.muted }}>—</Text>
          <TextInput
            style={[s.amountInput, { borderColor: T.chipEdge, color: T.ink }]}
            keyboardType="numeric"
            placeholder="До, c"
            placeholderTextColor={T.muted}
            value={amountMax}
            onChangeText={setAmountMax}
          />
        </View>

        <View style={s.panelFooter}>
          {extraFilterCount > 0 && (
            <TouchableOpacity onPress={resetExtraFilters}>
              <Text style={{ color: C.red, fontSize: 14, fontWeight: '700' }}>Сбросить всё</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.showBtn} onPress={() => setFilterPanelOpen(false)}>
            <Text style={s.showBtnText}>Показать {filtered.length} заказов</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
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
  chip:        { minHeight: 40, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)', backgroundColor: '#eef1f6', flexGrow: 0, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  chipActive:  { backgroundColor: C.blue, borderColor: C.blue },
  chipText:    { fontSize: 14, lineHeight: 18, fontWeight: '700', color: C.ink, flexGrow: 0, flexShrink: 0 },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 18, paddingBottom: 130, gap: 12 },
  empty:       { alignItems: 'center', paddingTop: 80 },
  emptyIcon:   { fontSize: 40, marginBottom: 12, opacity: 0.4 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.muted, marginBottom: 4 },
  emptySub:    { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 16 },
  retryBtn:    { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 24, minHeight: 44, justifyContent: 'center' },
  retryText:   { color: '#fff', fontSize: 15, fontWeight: '700' },
  inlineError: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 18, marginBottom: 4, gap: 10 },
  inlineErrorText:   { fontSize: 13, fontWeight: '600', flex: 1 },
  inlineErrorRetry:  { fontSize: 13, fontWeight: '700', color: C.blue },
  panelHeader: { paddingHorizontal: 18, paddingBottom: 8 },
  panelTitle:  { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  panelSub:    { fontSize: 13, fontWeight: '600', marginTop: 2 },
  panelLabel:  { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 18, marginTop: 18, marginBottom: 8 },
  presetRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18 },
  presetChip:  { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  presetClear: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  amountRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 },
  amountInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, fontSize: 15, fontWeight: '600' },
  panelFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: 24 },
  showBtn:     { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 24, minHeight: 44, justifyContent: 'center', marginLeft: 'auto' },
  showBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
