/**
 * Unified order card used on Home, Deliveries and Claimable screens.
 * Card-level actions: Позвонить · В путь (assigned) · Открыть
 * All advanced actions live inside OrderDetailSheet, not here.
 */
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native'
import { C, STATUS_LABEL, STATUS_COLOR } from './OrderDetailSheet'
import { PressScale } from './motion'
import { Sheen, useGlass } from './glass'

const isUrgent = (o) => {
  const m = String(o?.delivery_method ?? o?.DeliveryMethod ?? o?.deliveryMethod ?? '').toLowerCase()
  return m === 'fast' || m === 'express'
}

export function OrderCard({ order, onOpen, onStart, actionLoading }) {
  const { T }      = useGlass()
  const color      = STATUS_COLOR[order.status] || C.muted
  const collectAmt = Number(order.amount_to_collect ?? order.courier_collect_amount ?? 0)
  const fmt        = (n) => Number(n || 0).toLocaleString()

  const callPhone = () => {
    const phone = order.customer?.phone
    if (!phone) return Alert.alert('Нет телефона', 'Номер клиента не указан')
    Linking.openURL(`tel:${phone}`)
  }

  const isAssigned   = order.status === 'assigned'
  const isInDelivery = order.status === 'in_delivery'
  const isDone       = ['delivered', 'returned', 'issue', 'confirmed', 'cancelled'].includes(order.status)

  return (
    <PressScale
      style={[oc.cardShadow, isUrgent(order) && oc.cardShadowUrgent]}
      onPress={onOpen}
      scaleTo={0.98}
    >
      <View style={[oc.card, { backgroundColor: T.card, borderColor: T.cardEdge }, isUrgent(order) && oc.cardBorderUrgent]}>
      <Sheen radius={24} />
      {/* Top: order number + status badge */}
      <View style={oc.topRow}>
        <Text style={[oc.orderNum, { color: T.ink }]}>{order.order_number}</Text>
        <View style={[oc.badge, { backgroundColor: `${color}18` }]}>
          <Text style={[oc.badgeText, { color }]}>{STATUS_LABEL[order.status] || order.status}</Text>
        </View>
      </View>

      {/* Customer name + address */}
      <View style={oc.infoRow}>
        {order.customer?.full_name
          ? <Text style={[oc.clientName, { color: T.ink }]} numberOfLines={1}>{order.customer.full_name}</Text>
          : <Text style={[oc.clientNameFallback, { color: T.muted }]}>Клиент не указан</Text>
        }
        {order.customer?.address
          ? <Text style={[oc.address, { color: T.muted }]} numberOfLines={1}>📍 {order.customer.address}{order.customer?.city ? `, ${order.customer.city}` : ''}</Text>
          : null
        }
      </View>

      {/* Amount */}
      <View style={oc.amountRow}>
        <View style={oc.amountBox}>
          {collectAmt > 0
            ? <><Text style={oc.amountLabel}>К оплате клиентом</Text><Text style={oc.amountVal}>{fmt(collectAmt)} сом</Text></>
            : <Text style={[oc.amountVal, { color: C.green, fontSize: 13 }]}>✓ Оплачено</Text>
          }
        </View>
        {(order.delivery_method === 'fast' || order.delivery_method === 'express') && (
          <View style={oc.expressBadge}><Text style={oc.expressText}>⚡ Экспресс</Text></View>
        )}
      </View>

      {/* Card-level quick actions */}
      <View style={oc.actions}>
        {/* Позвонить — always shown for active orders */}
        {!isDone && (
          <TouchableOpacity style={[oc.btn, oc.btnCall]} onPress={callPhone}>
            <Text style={oc.btnCallText}>📞 Позвонить</Text>
          </TouchableOpacity>
        )}

        {/* В путь — only when assigned */}
        {isAssigned && (
          <TouchableOpacity
            style={[oc.btn, oc.btnPrimary, actionLoading && oc.btnDisabled]}
            onPress={() => onStart?.(order)}
            disabled={!!actionLoading}
          >
            <Text style={oc.btnPrimaryText}>▶ В путь</Text>
          </TouchableOpacity>
        )}

        {/* Открыть — in_delivery (to mark delivered inside sheet) + done states */}
        {(isInDelivery || isDone) && (
          <TouchableOpacity style={[oc.btn, oc.btnOpen, { backgroundColor: T.chip, borderColor: T.chipEdge }]} onPress={onOpen}>
            <Text style={[oc.btnOpenText, { color: T.ink }]}>{isInDelivery ? 'Открыть ›' : 'Детали ›'}</Text>
          </TouchableOpacity>
        )}
      </View>
      </View>
    </PressScale>
  )
}

const oc = StyleSheet.create({
  // Shadow lives on its own node, separate from the rounded/translucent
  // content view below. On Android, elevation's drop shadow is cast as a
  // rectangle behind the view's rounded silhouette; combined with a
  // semi-transparent fill on the SAME node, the corners don't clip cleanly
  // and the backdrop shows through in a ring around the card. Giving the
  // shadow its own (backgroundless) node with matching borderRadius keeps
  // the cast shadow shaped correctly, while the inner node's
  // overflow:'hidden' guarantees the translucent fill is clipped exactly
  // to the rounded rect with no bleed-through.
  cardShadow: {
    borderRadius: 24,
    shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05, shadowRadius: 14, elevation: 2,
  },
  cardShadowUrgent: {
    shadowColor: C.orange, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28, shadowRadius: 16, elevation: 6,
  },
  card: {
    backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)',
    padding: 16, gap: 12, overflow: 'hidden',
  },
  cardBorderUrgent: {
    borderColor: C.orange, borderWidth: 2,
  },
  topRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderNum:  { fontSize: 15, fontWeight: '700', color: C.ink, letterSpacing: -0.2 },
  badge:     { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  infoRow:   { gap: 4 },
  clientName: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  clientNameFallback: { fontSize: 15, fontStyle: 'italic', fontWeight: '500' },
  address:   { fontSize: 13, color: C.muted, fontWeight: '600', lineHeight: 18 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountBox: { gap: 1 },
  amountLabel: { fontSize: 10, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  amountVal: { fontSize: 18, fontWeight: '700', color: C.violet, letterSpacing: -0.5 },
  expressBadge: { backgroundColor: 'rgba(255,149,0,0.15)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,149,0,0.35)' },
  expressText: { fontSize: 11, fontWeight: '700', color: C.orange },
  actions:   { flexDirection: 'row', gap: 8 },
  btn:       { flex: 1, borderRadius: 999, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnCall:   { backgroundColor: 'rgba(10,132,255,0.12)', borderWidth: 1, borderColor: 'rgba(10,132,255,0.22)' },
  // Darkened from C.blue (#0a84ff) — the plain accent measured 3.1:1 against
  // its own 12%-tint pill background, below WCAG AA's 4.5:1 minimum for
  // this text size. #065aaa against the same background is ~5.9:1.
  btnCallText: { fontSize: 13, fontWeight: '700', color: '#065aaa' },
  btnPrimary:  { backgroundColor: C.blue },
  btnPrimaryText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  btnOpen:   { backgroundColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)' },
  btnOpenText: { fontSize: 13, fontWeight: '700', color: C.ink },
  btnDisabled: { opacity: 0.45 },
})
