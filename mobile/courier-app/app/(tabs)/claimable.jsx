import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, RefreshControl, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import { getClaimableOrders, claimOrder, unclaimOrder } from '../../src/api/orders'
import useAuthStore from '../../src/store/authStore'
import { resolveCreator } from '../../src/lib/creator'
import { C } from '../../src/components/OrderDetailSheet'
import Avatar from '../../src/components/Avatar'
import { FadeSlideIn, PressScale, OrderCardSkeleton, animateLayout } from '../../src/components/motion'
import { GlassBackdrop, Sheen, useGlass } from '../../src/components/glass'

// Canonical DB value is "fast"; "express" kept as legacy fallback.
// Defensive check across all possible field-name shapes from the API.
const isUrgent = (o) => {
  const m = String(o?.delivery_method ?? o?.DeliveryMethod ?? o?.deliveryMethod ?? '').toLowerCase()
  return m === 'fast' || m === 'express'
}

export default function ClaimableScreen() {
  const { T }                   = useGlass()
  const [orders, setOrders]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [claiming, setClaiming] = useState(null)
  const [claimedToast, setClaimedToast] = useState(null)
  const [unclaiming, setUnclaiming] = useState(false)
  const toastTimer = useRef(null)
  const currentUserName = useAuthStore((st) => st.user?.full_name) || ''

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  const fetchOrders = async () => {
    try {
      const { data } = await getClaimableOrders()
      const list = data.data || []
      // Urgent orders first; backend also sorts this way, but guard on client too
      setOrders([...list].sort((a, b) => (isUrgent(b) ? 1 : 0) - (isUrgent(a) ? 1 : 0)))
    } catch (e) {
      Alert.alert('Ошибка загрузки', e?.response?.data?.error?.message || 'Не удалось загрузить заказы')
    } finally { setLoading(false); setRefreshing(false) }
  }

  // useFocusEffect so a claim made from another session/device, or an order
  // that expired while this tab was backgrounded, is reflected on return —
  // see deliveries.jsx for the same fix and the reason it's needed.
  useFocusEffect(useCallback(() => { fetchOrders() }, []))

  // Direct claim — no confirmation popup, no success popup
  const handleClaim = async (order) => {
    setClaiming(order.id)
    try {
      await claimOrder(order.id)
      // Claimed card slides out of the list smoothly
      animateLayout()
      setOrders(prev => prev.filter(o => o.id !== order.id))
      fetchOrders()
      // Toast stays up exactly as long as the backend's undo window
      // (UnclaimOrder rejects past 5s of the claim) — never longer, so
      // "Отменить" never looks tappable after the server would refuse it.
      setClaimedToast({ id: order.id, orderNumber: order.order_number })
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setClaimedToast(null), 5000)
    } catch (e) {
      Alert.alert('Ошибка', e.response?.data?.error?.message || 'Не удалось взять заказ')
    } finally { setClaiming(null) }
  }

  const handleUndoClaim = async () => {
    if (!claimedToast || unclaiming) return
    const { id } = claimedToast
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setUnclaiming(true)
    try {
      await unclaimOrder(id)
      setClaimedToast(null)
      animateLayout()
      fetchOrders()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось отменить заказ')
      setClaimedToast(null)
    } finally { setUnclaiming(false) }
  }

  const fmt = (n) => Number(n || 0).toLocaleString()

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <View style={s.header}>
        <Text style={[s.headTitle, { color: T.ink }]}>Общий заказ</Text>
        <Text style={[s.headSub, { color: T.muted }]}>{orders.length} заказов рядом</Text>
      </View>

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
          : orders.length === 0
            ? (
              <FadeSlideIn>
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>🎯</Text>
                  <Text style={[s.emptyTitle, { color: T.muted }]}>Нет доступных заказов</Text>
                  <Text style={[s.emptySub, { color: T.muted }]}>Потяните вниз чтобы обновить</Text>
                </View>
              </FadeSlideIn>
            )
            : orders.map((order, index) => {
              const cr         = resolveCreator(order, currentUserName)
              const collectAmt = Number(order.courier_collect_amount ?? order.amount_to_collect ?? 0)
              const urgent     = isUrgent(order)
              return (
                <FadeSlideIn key={order.id} delay={Math.min(index, 6) * 55}>
                <View style={[s.card, { backgroundColor: T.card, borderColor: T.cardEdge }, urgent && s.cardUrgent]}>
                  <Sheen radius={24} />
                  {/* Top: order number + badges */}
                  <View style={s.cardTop}>
                    <Text style={[s.orderNum, { color: T.ink }]}>{order.order_number}</Text>
                    <View style={s.topBadges}>
                      {urgent && (
                        <View style={s.expressBadge}><Text style={s.expressText}>⚡ Экспресс</Text></View>
                      )}
                      <View style={s.newBadge}><Text style={s.newBadgeText}>свободный</Text></View>
                    </View>
                  </View>

                  {/* Address / customer */}
                  <View style={s.infoBlock}>
                    {order.customer?.full_name
                      ? <Text style={[s.clientName, { color: T.ink }]} numberOfLines={1}>{order.customer.full_name}</Text>
                      : <Text style={[s.clientNameFallback, { color: T.muted }]}>Клиент не указан</Text>
                    }
                    {order.customer?.address
                      ? <Text style={[s.address, { color: T.muted }]} numberOfLines={2}>📍 {order.customer.address}{order.customer?.city ? `, ${order.customer.city}` : ''}</Text>
                      : null
                    }
                  </View>

                  {/* Amount */}
                  <View style={s.amountRow}>
                    {collectAmt > 0
                      ? (<>
                          <Text style={s.amountLabel}>Получить</Text>
                          <Text style={s.amountVal}>{fmt(collectAmt)} c</Text>
                        </>)
                      : <Text style={[s.amountVal, { color: C.green, fontSize: 14 }]}>✓ Оплачено</Text>
                    }
                  </View>

                  {/* Creator strip */}
                  <View style={[s.creatorStrip, { borderTopColor: T.hairline }]}>
                    <Avatar uri={cr.avatarUrl} name={cr.name} size={18} color={C.muted} />
                    <Text style={[s.creatorName, { color: T.ink }]} numberOfLines={1}>{cr.name}</Text>
                    {cr.isOwn
                      ? <View style={[s.rolePill, { backgroundColor: `${C.green}1A` }]}>
                          <Text style={[s.rolePillText, { color: C.green }]}>Мой заказ</Text>
                        </View>
                      : cr.roleLabel
                        ? <View style={[s.rolePill, { backgroundColor: `${cr.roleColor}1A` }]}>
                            <Text style={[s.rolePillText, { color: cr.roleColor }]}>{cr.roleLabel}</Text>
                          </View>
                        : null
                    }
                  </View>

                  {/* Claim button */}
                  <PressScale
                    style={[s.claimBtn, claiming === order.id && s.claimBtnDisabled]}
                    scaleTo={0.96}
                    onPress={() => handleClaim(order)}
                    disabled={!!claiming}
                  >
                    {claiming === order.id
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={s.claimBtnText}>🎯 Взять заказ</Text>
                    }
                  </PressScale>
                </View>
                </FadeSlideIn>
              )
            })
        }
      </ScrollView>

      {claimedToast && (
        <FadeSlideIn style={s.toast} from={16}>
          <Text style={s.toastText} numberOfLines={1}>Заказ {claimedToast.orderNumber} взят</Text>
          <PressScale onPress={handleUndoClaim} disabled={unclaiming} scaleTo={0.92}>
            {unclaiming
              ? <ActivityIndicator color="#6db2ff" size="small" />
              : <Text style={s.toastUndo}>Отменить</Text>
            }
          </PressScale>
        </FadeSlideIn>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: C.bg },
  header:      { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 },
  headTitle:   { fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  headSub:     { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  listContent: { paddingHorizontal: 18, paddingBottom: 130, gap: 13 },
  empty:       { alignItems: 'center', paddingTop: 80 },
  emptyIcon:   { fontSize: 40, marginBottom: 12, opacity: 0.4 },
  emptyTitle:  { fontSize: 16, fontWeight: '700', color: C.muted, marginBottom: 4 },
  emptySub:    { fontSize: 13, color: C.muted },

  card: {
    backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
    padding: 16, gap: 12,
    shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 14, elevation: 2,
  },
  cardUrgent: {
    borderColor: C.orange, borderWidth: 2,
    shadowColor: C.orange, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
  },
  cardTop:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBadges:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  expressBadge: { backgroundColor: 'rgba(255,149,0,0.15)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,149,0,0.35)' },
  expressText:  { fontSize: 11, fontWeight: '700', color: C.orange },
  orderNum:     { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  newBadge:     { backgroundColor: 'rgba(52,199,89,0.16)', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  newBadgeText: { color: '#1d9a45', fontWeight: '700', fontSize: 11 },
  infoBlock:    { gap: 4 },
  clientName:   { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  clientNameFallback: { fontSize: 15, fontStyle: 'italic', fontWeight: '500' },
  address:      { fontSize: 13, color: C.muted, fontWeight: '600', lineHeight: 18 },
  amountRow:    { gap: 2 },
  amountLabel:  { fontSize: 10, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  amountVal:    { fontSize: 18, fontWeight: '700', color: C.violet, letterSpacing: -0.5 },
  creatorStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  creatorName:  { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600', color: C.ink },
  rolePill:     { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  rolePillText: { fontSize: 11, fontWeight: '700' },
  claimBtn:     {
    borderRadius: 999, paddingVertical: 16, alignItems: 'center',
    backgroundColor: C.blue,
    shadowColor: C.blue, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 3,
  },
  claimBtnDisabled: { opacity: 0.45 },
  claimBtnText:     { color: '#fff', fontWeight: '700', fontSize: 16 },

  toast: {
    // The floating tab bar sits at bottom:24, height:68 (see (tabs)/_layout.jsx)
    // and is rendered by the navigator above this screen's own content, so a
    // small `bottom` here would render fully hidden behind it, not just
    // visually behind — unreachable, not just unattractive.
    position: 'absolute', left: 18, right: 18, bottom: 106,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: '#0c162a', borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 28, elevation: 8,
  },
  toastText: { flex: 1, color: 'rgba(255,255,255,0.92)', fontWeight: '600', fontSize: 13 },
  toastUndo: { color: '#6db2ff', fontWeight: '700', fontSize: 13 },
})
