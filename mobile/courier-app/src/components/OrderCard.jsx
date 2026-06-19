/**
 * Unified order card used on Home, Deliveries and Claimable screens.
 * Card-level actions: Позвонить · В путь (assigned) · Открыть
 * All advanced actions live inside OrderDetailSheet, not here.
 */
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native'
import { C, STATUS_LABEL, STATUS_COLOR } from './OrderDetailSheet'

export function OrderCard({ order, onOpen, onStart, actionLoading }) {
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
    <TouchableOpacity style={oc.card} onPress={onOpen} activeOpacity={0.78}>
      {/* Top: order number + status badge */}
      <View style={oc.topRow}>
        <Text style={oc.orderNum}>{order.order_number}</Text>
        <View style={[oc.badge, { backgroundColor: `${color}18` }]}>
          <Text style={[oc.badgeText, { color }]}>{STATUS_LABEL[order.status] || order.status}</Text>
        </View>
      </View>

      {/* Customer name + address */}
      <View style={oc.infoRow}>
        <Text style={oc.clientName} numberOfLines={1}>{order.customer?.full_name || '—'}</Text>
        {order.customer?.address
          ? <Text style={oc.address} numberOfLines={1}>📍 {order.customer.address}{order.customer?.city ? `, ${order.customer.city}` : ''}</Text>
          : null
        }
      </View>

      {/* Amount */}
      <View style={oc.amountRow}>
        <View style={oc.amountBox}>
          {collectAmt > 0
            ? <><Text style={oc.amountLabel}>Получить</Text><Text style={oc.amountVal}>{fmt(collectAmt)} сом</Text></>
            : <Text style={[oc.amountVal, { color: C.green, fontSize: 13 }]}>✓ Оплачено</Text>
          }
        </View>
        {order.delivery_method === 'express' && (
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
          <TouchableOpacity style={[oc.btn, oc.btnOpen]} onPress={onOpen}>
            <Text style={oc.btnOpenText}>{isInDelivery ? 'Открыть ›' : 'Детали ›'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  )
}

const oc = StyleSheet.create({
  card: {
    backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.line,
    padding: 16, gap: 12,
    shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
  },
  topRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderNum:  { fontSize: 15, fontWeight: '900', color: C.ink, letterSpacing: -0.2 },
  badge:     { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '900' },
  infoRow:   { gap: 4 },
  clientName: { fontSize: 17, fontWeight: '900', color: C.ink, letterSpacing: -0.3 },
  address:   { fontSize: 13, color: C.muted, fontWeight: '600', lineHeight: 18 },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountBox: { gap: 1 },
  amountLabel: { fontSize: 10, fontWeight: '800', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  amountVal: { fontSize: 18, fontWeight: '900', color: C.violet, letterSpacing: -0.5 },
  expressBadge: { backgroundColor: '#fff7e6', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#ffe0a0' },
  expressText: { fontSize: 11, fontWeight: '900', color: C.orange },
  actions:   { flexDirection: 'row', gap: 8 },
  btn:       { flex: 1, borderRadius: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  btnCall:   { backgroundColor: '#eef5ff', borderWidth: 1, borderColor: '#d8e8fb' },
  btnCallText: { fontSize: 13, fontWeight: '900', color: C.blue },
  btnPrimary:  { backgroundColor: C.violet },
  btnPrimaryText: { fontSize: 13, fontWeight: '900', color: '#fff' },
  btnOpen:   { backgroundColor: C.bg, borderWidth: 1, borderColor: C.line },
  btnOpenText: { fontSize: 13, fontWeight: '900', color: C.ink },
  btnDisabled: { opacity: 0.45 },
})
