import { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, Modal, Image, Pressable
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { getMyOrders, updateOrderStatus } from '../../src/api/orders'
import client from '../../src/api/client'

const C = {
  bg: '#0d0f14', bg2: '#13161e', surface: '#1e2130', surface2: '#252838',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.15)',
  text: '#f0f2f8', text2: '#9095a8', text3: '#5e6478',
  accent: '#6366f1', green: '#10b981', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6',
  greenDim: 'rgba(16,185,129,0.15)', amberDim: 'rgba(245,158,11,0.15)',
  redDim: 'rgba(239,68,68,0.15)', accentDim: 'rgba(99,102,241,0.12)',
}

const STATUS_LABEL = { confirmed: 'Подтверждён', assigned: 'Назначен', in_delivery: 'В пути', delivered: 'Доставлен', returned: 'Возврат', issue: 'Проблема' }
const STATUS_COLOR = { confirmed: C.blue, assigned: C.accent, in_delivery: C.amber, delivered: C.green, returned: C.red, issue: C.red }

const FILTERS = [
  { key: 'in_delivery', label: '🚚 В пути' },
  { key: 'assigned',    label: '📋 Назначены' },
  { key: 'delivered',   label: '✅ Доставлено' },
  { key: 'all',         label: 'Все' },
]

export default function DeliveriesScreen() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [proofPhoto, setProofPhoto] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  const fetch = async () => {
    try {
      const { data } = await getMyOrders()
      setOrders(data.data || [])
    } catch {}
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetch() }, [])

  const filtered = activeFilter === 'all' ? orders : orders.filter(o => o.status === activeFilter)

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Нет доступа к камере'); return }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (!result.canceled) setProofPhoto(result.assets[0])
  }

  const handleStart = async (order) => {
    setActionLoading(true)
    try {
      await updateOrderStatus(order.id, 'in_delivery')
      setSelectedOrder(null); setProofPhoto(null); fetch()
    } catch (e) {
      const msg = e?.response?.data?.error?.message || 'Не удалось начать доставку'
      Alert.alert('Ошибка', msg)
    }
    finally { setActionLoading(false) }
  }

  const handleDelivered = async (order) => {
    if (!proofPhoto) { Alert.alert('Добавьте фото подтверждения', 'Сфотографируйте подтверждение доставки'); return }
    setActionLoading(true)
    try {
      const form = new FormData()
      form.append('file', { uri: proofPhoto.uri, type: 'image/jpeg', name: 'proof.jpg' })
      const uploadRes = await client.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      const proofUrl = uploadRes.data.data?.url || uploadRes.data.url || undefined
      await updateOrderStatus(order.id, 'delivered', { proof_url: proofUrl })
      Alert.alert('Готово!', 'Заказ помечен как доставленный')
      setSelectedOrder(null); setProofPhoto(null); fetch()
    } catch (e) {
      const msg = e?.response?.data?.error?.message || 'Не удалось обновить статус'
      Alert.alert('Ошибка', msg)
    }
    finally { setActionLoading(false) }
  }

  const handleReturn = (order) => {
    Alert.alert('Возврат', 'Отметить как возврат?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Возврат', style: 'destructive', onPress: async () => {
        try {
          await updateOrderStatus(order.id, 'returned'); fetch()
        } catch (e) {
          const msg = e?.response?.data?.error?.message || 'Не удалось оформить возврат'
          Alert.alert('Ошибка', msg)
        }
      }},
    ])
  }

  const fmt = (n) => Number(n || 0).toLocaleString()

  return (
    <SafeAreaView style={s.safe}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>📦 Мои доставки</Text>
        </View>
        <View style={s.headerCnt}><Text style={s.headerCntText}>{orders.length}</Text></View>
      </View>

      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterBtn, activeFilter === f.key && s.filterBtnActive]}
            onPress={() => setActiveFilter(f.key)}
          >
            <Text style={[s.filterText, activeFilter === f.key && s.filterTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetch() }} tintColor={C.accent} />}
        contentContainerStyle={s.listContent}
      >
        {loading
          ? <ActivityIndicator color={C.accent} style={{ marginTop: 64 }} />
          : filtered.length === 0
            ? <View style={s.empty}><Text style={s.emptyIcon}>📦</Text><Text style={s.emptyTitle}>Нет заказов</Text><Text style={s.emptySub}>Заказы появятся здесь после назначения</Text></View>
            : filtered.map(order => {
              const color = STATUS_COLOR[order.status] || C.text3
              return (
                <TouchableOpacity key={order.id} style={[s.card, { borderLeftColor: color }]} onPress={() => { setSelectedOrder(order); setProofPhoto(null); setActionLoading(false) }}>
                  <View style={s.cardTop}>
                    <Text style={s.cardNum}>{order.order_number}</Text>
                    <View style={[s.badge, { backgroundColor: color + '25' }]}>
                      <View style={[s.dot, { backgroundColor: color }]} />
                      <Text style={[s.badgeText, { color }]}>{STATUS_LABEL[order.status]}</Text>
                    </View>
                  </View>
                  <Text style={s.cardCustomer}>👤 {order.customer?.full_name}</Text>
                  <Text style={s.cardAddr} numberOfLines={1}>📍 {order.customer?.address || '—'}</Text>
                  <Text style={[s.cardAmount, { color }]}>💵 {fmt(order.courier_collect_amount)} TJS</Text>
                </TouchableOpacity>
              )
            })
        }
      </ScrollView>

      {/* Bottom sheet modal */}
      <Modal visible={!!selectedOrder} animationType="slide" transparent statusBarTranslucent>
        <Pressable style={s.overlay} onPress={() => { setSelectedOrder(null); setProofPhoto(null) }}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />

            {selectedOrder && (
              <>
                <View style={s.sheetHeader}>
                  <View>
                    <Text style={s.sheetNum}>{selectedOrder.order_number}</Text>
                    <View style={[s.badge, { backgroundColor: (STATUS_COLOR[selectedOrder.status] || C.text3) + '25', marginTop: 4 }]}>
                      <View style={[s.dot, { backgroundColor: STATUS_COLOR[selectedOrder.status] || C.text3 }]} />
                      <Text style={[s.badgeText, { color: STATUS_COLOR[selectedOrder.status] || C.text3 }]}>{STATUS_LABEL[selectedOrder.status]}</Text>
                    </View>
                  </View>
                  <TouchableOpacity style={s.sheetClose} onPress={() => { setSelectedOrder(null); setProofPhoto(null) }}>
                    <Text style={{ color: C.text2, fontSize: 18 }}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={s.sheetBody}>
                  {/* Client info grid */}
                  <Text style={s.sectionLabel}>КЛИЕНТ</Text>
                  <View style={s.infoGrid}>
                    <View style={s.infoCell}>
                      <Text style={s.infoCellLbl}>Имя</Text>
                      <Text style={s.infoCellVal}>{selectedOrder.customer?.full_name}</Text>
                    </View>
                    <View style={s.infoCell}>
                      <Text style={s.infoCellLbl}>Телефон</Text>
                      <Text style={s.infoCellVal}>{selectedOrder.customer?.phone || '—'}</Text>
                    </View>
                    <View style={[s.infoCell, { flex: 2 }]}>
                      <Text style={s.infoCellLbl}>Адрес</Text>
                      <Text style={s.infoCellVal}>{selectedOrder.customer?.address || '—'}</Text>
                    </View>
                  </View>

                  {/* Payment */}
                  <View style={s.payRow}>
                    <Text style={[s.payAmount, { color: STATUS_COLOR[selectedOrder.status] || C.accent }]}>
                      💵 {fmt(selectedOrder.courier_collect_amount)} TJS
                    </Text>
                    <View style={[s.payBadge, { backgroundColor: C.greenDim }]}>
                      <Text style={{ color: C.green, fontSize: 13, fontWeight: '700' }}>Нал</Text>
                    </View>
                  </View>

                  {/* Photo for delivery */}
                  {selectedOrder.status === 'in_delivery' && (
                    <>
                      <Text style={[s.sectionLabel, { marginTop: 16 }]}>ФОТО ПОДТВЕРЖДЕНИЯ</Text>
                      <TouchableOpacity style={[s.photoBtn, proofPhoto && s.photoBtnFilled]} onPress={pickPhoto}>
                        {proofPhoto
                          ? <Image source={{ uri: proofPhoto.uri }} style={s.photo} />
                          : <Text style={s.photoBtnText}>📷 Сфотографировать</Text>
                        }
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>

                {/* Actions — vary by status */}
                {selectedOrder.status === 'assigned' && (
                  <View style={s.sheetActions}>
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: C.accent }, actionLoading && s.disabledBtn]}
                      onPress={() => handleStart(selectedOrder)} disabled={actionLoading}
                    >
                      {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.actionBtnText}>▶ Начать доставку</Text>}
                    </TouchableOpacity>
                  </View>
                )}

                {selectedOrder.status === 'in_delivery' && (
                  <View style={s.sheetActions}>
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: C.redDim, borderWidth: 1, borderColor: C.red + '44', flex: 0.8 }]}
                      onPress={() => handleReturn(selectedOrder)}
                    >
                      <Text style={[s.actionBtnText, { color: C.red }]}>↩ Возврат</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.actionBtn, { backgroundColor: C.green }, actionLoading && s.disabledBtn]}
                      onPress={() => handleDelivered(selectedOrder)} disabled={actionLoading}
                    >
                      {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.actionBtnText}>✓ Доставлен</Text>}
                    </TouchableOpacity>
                  </View>
                )}

                {(selectedOrder.status === 'delivered' || selectedOrder.status === 'returned' || selectedOrder.status === 'issue') && (
                  <View style={[s.sheetActions, { justifyContent: 'center' }]}>
                    <Text style={{ color: C.text3, fontSize: 13, fontWeight: '600' }}>
                      {selectedOrder.status === 'delivered' ? '✓ Доставлен' : selectedOrder.status === 'returned' ? '↩ Возвращён' : '⚠ Проблема'}
                    </Text>
                  </View>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  headerCnt: { backgroundColor: C.surface2, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  headerCntText: { fontSize: 12, color: C.text2, fontWeight: '600' },
  filterScroll: { flexGrow: 0 },
  filterRow: { paddingHorizontal: 12, paddingBottom: 10, gap: 6, flexDirection: 'row' },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filterBtnActive: { backgroundColor: C.accentDim, borderColor: C.accent },
  filterText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  filterTextActive: { color: C.accent },
  listContent: { paddingHorizontal: 12, paddingBottom: 16, gap: 8 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12, opacity: 0.4 },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: C.text2, marginBottom: 4 },
  emptySub: { fontSize: 12, color: C.text3 },
  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 3,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardNum: { fontSize: 14, fontWeight: '700', color: C.text },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  cardCustomer: { fontSize: 13, color: C.text2, marginBottom: 2 },
  cardAddr: { fontSize: 12, color: C.text3, marginBottom: 6 },
  cardAmount: { fontSize: 16, fontWeight: '800' },
  // Sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderColor: C.border2, maxHeight: '92%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 99, backgroundColor: C.border2, alignSelf: 'center', marginTop: 12 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sheetNum: { fontSize: 20, fontWeight: '800', color: C.text },
  sheetClose: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.bg2, justifyContent: 'center', alignItems: 'center' },
  sheetBody: { padding: 16, maxHeight: 400 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: C.text2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  infoCell: { flex: 1, minWidth: 120, backgroundColor: C.surface2, borderRadius: 8, padding: 10 },
  infoCellLbl: { fontSize: 10, color: C.text2, marginBottom: 3 },
  infoCellVal: { fontSize: 13, fontWeight: '600', color: C.text },
  payRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.surface2, borderRadius: 10, padding: 14 },
  payAmount: { fontSize: 26, fontWeight: '800' },
  payBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99 },
  photoBtn: {
    borderWidth: 1.5, borderColor: C.border2, borderStyle: 'dashed',
    borderRadius: 12, height: 120, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg2,
  },
  photoBtnFilled: { borderStyle: 'solid', borderColor: C.accent, padding: 0, overflow: 'hidden' },
  photo: { width: '100%', height: '100%', borderRadius: 10 },
  photoBtnText: { fontSize: 15, color: C.text2, fontWeight: '600' },
  sheetActions: {
    flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 24,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  actionBtn: { flex: 1, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  disabledBtn: { opacity: 0.6 },
})
