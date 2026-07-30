import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  ActivityIndicator, Alert, TextInput, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Check, ChevronLeft, Clock, Package, RotateCcw, TriangleAlert, Camera } from 'lucide-react-native'
import * as ImagePicker from 'expo-image-picker'
import { GlassBackdrop, useGlass } from '../src/components/glass'
import {
  acceptTransfer,
  createFullReturn,
  getMyWarehouse,
  rejectTransfer,
  reportLostProduct,
  uploadLostProductPhoto,
} from '../src/api/warehouse'

// The main warehouse a courier's full return goes to. There is exactly one
// seeded by migration 00091 (internal/warehouses.DefaultMainWarehouseID);
// this mirrors that well-known ID rather than requiring the courier to pick
// from a warehouse list they have no visibility into (spec §7: couriers
// only ever see their own warehouse).
const DEFAULT_MAIN_WAREHOUSE_ID = '00000000-0000-0000-0000-000000000001'

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export default function WarehouseScreen() {
  const { T, dark } = useGlass()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [showLostForm, setShowLostForm] = useState(false)

  const load = useCallback(async ({ silent } = {}) => {
    try {
      const res = await getMyWarehouse()
      setData(res.data?.data ?? res.data)
      setUpdatedAt(new Date())
    } catch (err) {
      if (!silent) Alert.alert('Ошибка', 'Не удалось загрузить склад')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

  function handleRefresh() {
    setRefreshing(true)
    load({ silent: true })
  }

  async function handleAccept(transferId) {
    setBusyId(transferId)
    try {
      await acceptTransfer(transferId)
      await load()
    } catch (err) {
      Alert.alert('Ошибка', err?.response?.data?.error?.message || 'Не удалось принять передачу')
    } finally {
      setBusyId(null)
    }
  }

  function handleReject(transferId) {
    Alert.alert('Отклонить передачу?', 'Товар останется на главном складе', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отклонить', style: 'destructive', onPress: async () => {
          setBusyId(transferId)
          try {
            await rejectTransfer(transferId)
            await load()
          } catch (err) {
            Alert.alert('Ошибка', err?.response?.data?.error?.message || 'Не удалось отклонить передачу')
          } finally {
            setBusyId(null)
          }
        },
      },
    ])
  }

  function handleReturnAll() {
    const items = data?.items ?? []
    if (!items.length) {
      Alert.alert('Нечего возвращать', 'На вашем складе нет свободных товаров')
      return
    }
    Alert.alert(
      'Вернуть все товары?',
      'Система автоматически рассчитает весь текущий свободный остаток. Частичный возврат недоступен.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Вернуть', onPress: async () => {
            setBusyId('return')
            try {
              await createFullReturn(DEFAULT_MAIN_WAREHOUSE_ID)
              Alert.alert('Готово', 'Возврат создан и ожидает подтверждения склада')
              await load()
            } catch (err) {
              Alert.alert('Ошибка', err?.response?.data?.error?.message || 'Не удалось создать возврат')
            } finally {
              setBusyId(null)
            }
          },
        },
      ]
    )
  }

  const pendingTransfers = data?.pending_transfers ?? []
  const items = data?.items ?? []

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <ChevronLeft size={22} color={T.ink} strokeWidth={2} />
        </TouchableOpacity>
        <View style={{ alignItems: 'center' }}>
          <Text style={[st.headerTitle, { color: T.ink }]}>Мой склад</Text>
          {updatedAt && (
            <Text style={[st.headerStamp, { color: T.muted }]}>Обновлено в {formatTime(updatedAt)}</Text>
          )}
        </View>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={T.blue} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={st.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.blue} />}
        >
          {pendingTransfers.length > 0 && (
            <View style={[st.card, st.pendingCard, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
              <View style={[st.pendingHeader, { backgroundColor: 'rgba(255,149,0,0.14)' }]}>
                <Clock size={15} color="#8a5a00" strokeWidth={2} />
                <Text style={st.pendingHeaderText}>ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ</Text>
                <View style={st.pendingCount}>
                  <Text style={st.pendingCountText}>{pendingTransfers.length}</Text>
                </View>
              </View>
              <View style={st.pendingBody}>
                {pendingTransfers.map((t, idx) => (
                  <View
                    key={t.id}
                    style={[st.transferRow, idx < pendingTransfers.length - 1 && [st.transferRowBorder, { borderBottomColor: T.hairline }]]}
                  >
                    <View style={st.transferTopRow}>
                      <Text style={[st.transferFrom, { color: T.ink }]}>{t.from_warehouse_name}</Text>
                    </View>
                    {t.items.map((it) => (
                      <Text key={it.product_id} style={[st.transferItem, { color: T.muted }]}>
                        {it.product_name} × {it.quantity}
                      </Text>
                    ))}
                    <View style={st.transferActions}>
                      <TouchableOpacity
                        disabled={busyId === t.id}
                        style={[st.actionBtn, st.rejectBtn]}
                        onPress={() => handleReject(t.id)}
                      >
                        <Text style={st.rejectText}>Отклонить</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={busyId === t.id}
                        style={[st.actionBtn, { backgroundColor: T.blue }]}
                        onPress={() => handleAccept(t.id)}
                      >
                        {busyId === t.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={st.acceptText}>Принять</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          <View style={[st.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
            <View style={st.itemsHeader}>
              <Text style={[st.cardTitle, { color: T.muted, marginBottom: 0 }]}>ТОВАРЫ НА СКЛАДЕ</Text>
              <View style={[st.itemsCountBadge, { backgroundColor: T.chip }]}>
                <Text style={[st.itemsCountText, { color: T.blue }]}>{items.length}</Text>
              </View>
            </View>
            {items.length === 0 ? (
              <View style={st.emptyRow}>
                <Package size={22} color={T.muted} />
                <Text style={[st.emptyText, { color: T.muted }]}>У вас нет товаров на складе</Text>
              </View>
            ) : (
              items.map((item, idx) => (
                <View key={item.product_id} style={[st.itemRow, idx < items.length - 1 && [st.itemRowBorder, { borderBottomColor: T.hairline }]]}>
                  {item.product_image_url ? (
                    <Image source={{ uri: item.product_image_url }} style={st.itemImage} />
                  ) : (
                    <View style={[st.itemImage, st.itemImagePlaceholder]}>
                      <Package size={18} color={T.muted} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={[st.itemName, { color: T.ink }]}>{item.product_name}</Text>
                    <Text style={[st.itemMeta, { color: T.muted }]}>Доступно: {item.available_quantity}</Text>
                  </View>
                  <Text style={[st.itemQty, { color: T.ink }]}>{item.quantity}</Text>
                </View>
              ))
            )}
          </View>

          <TouchableOpacity
            style={[st.wideBtn, { backgroundColor: T.card, borderColor: T.cardEdge }]}
            disabled={busyId === 'return'}
            onPress={handleReturnAll}
          >
            <RotateCcw size={17} color={T.ink} strokeWidth={2} />
            <Text style={[st.wideBtnText, { color: T.ink }]}>Вернуть все товары</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.wideBtn, { backgroundColor: 'rgba(255,59,48,0.06)', borderColor: 'rgba(255,59,48,0.35)' }]}
            onPress={() => setShowLostForm(true)}
          >
            <TriangleAlert size={17} color={T.red} strokeWidth={2} />
            <Text style={[st.wideBtnText, { color: T.red }]}>Сообщить об утере товара</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {showLostForm && (
        <LostProductForm
          items={items}
          onClose={() => setShowLostForm(false)}
          onDone={async () => { setShowLostForm(false); await load() }}
        />
      )}
    </SafeAreaView>
  )
}

function LostProductForm({ items, onClose, onDone }) {
  const { T } = useGlass()
  const [productId, setProductId] = useState(items[0]?.product_id ?? '')
  const [quantity, setQuantity] = useState('1')
  const [comment, setComment] = useState('')
  const [photo, setPhoto] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function pickPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') return
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
    if (!result.canceled && result.assets?.[0]) setPhoto(result.assets[0])
  }

  function adjustQuantity(delta) {
    const current = Number.parseInt(quantity, 10) || 0
    const next = Math.max(1, current + delta)
    setQuantity(String(next))
  }

  async function submit() {
    const qty = Number.parseInt(quantity, 10)
    if (!productId) return Alert.alert('Выберите товар')
    if (!Number.isInteger(qty) || qty < 1) return Alert.alert('Укажите корректное количество')
    if (!photo) return Alert.alert('Приложите фото товара')
    if (!comment.trim()) return Alert.alert('Опишите обстоятельства утери')

    setSubmitting(true)
    try {
      const photoUrl = await uploadLostProductPhoto({
        uri: photo.uri, type: photo.mimeType || 'image/jpeg', name: photo.fileName || `lost_${Date.now()}.jpg`,
      })
      await reportLostProduct({ product_id: productId, quantity: qty, photo_url: photoUrl, comment: comment.trim() })
      Alert.alert('Отправлено', 'Заявка передана на рассмотрение')
      onDone()
    } catch (err) {
      Alert.alert('Ошибка', err?.response?.data?.error?.message || 'Не удалось отправить заявку')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <View style={st.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      <View style={[st.sheet, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
        <View style={[st.sheetHandle, { backgroundColor: T.hairline }]} />
        <Text style={[st.sheetTitle, { color: T.ink }]}>Утеря товара</Text>

        <Text style={[st.sheetLabel, { color: T.muted }]}>ТОВАР</Text>
        <View style={{ gap: 6, marginBottom: 6 }}>
          {items.map((it) => {
            const active = productId === it.product_id
            return (
              <TouchableOpacity
                key={it.product_id}
                style={[
                  st.pickRow,
                  { backgroundColor: T.chip, borderColor: 'transparent' },
                  active && { borderColor: T.blue, borderWidth: 1.5 },
                ]}
                onPress={() => setProductId(it.product_id)}
              >
                <Text style={{ color: T.ink, fontSize: 14 }}>{it.product_name}</Text>
                {active && <Check size={16} color={T.blue} strokeWidth={2.5} />}
              </TouchableOpacity>
            )
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 0 }}>
            <Text style={[st.sheetLabel, { color: T.muted }]}>КОЛИЧЕСТВО</Text>
            <View style={[st.qtyRow, { borderColor: T.hairline }]}>
              <TouchableOpacity style={[st.qtyBtn, { backgroundColor: T.chip }]} onPress={() => adjustQuantity(-1)}>
                <Text style={[st.qtyBtnText, { color: T.ink }]}>−</Text>
              </TouchableOpacity>
              <Text style={[st.qtyValue, { color: T.ink }]}>{quantity}</Text>
              <TouchableOpacity style={[st.qtyBtn, { backgroundColor: T.chip }]} onPress={() => adjustQuantity(1)}>
                <Text style={[st.qtyBtnText, { color: T.ink }]}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.sheetLabel, { color: T.muted }]}>ФОТО</Text>
            <TouchableOpacity style={[st.photoBtn, { borderColor: T.hairline }]} onPress={pickPhoto}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={st.photoPreview} />
              ) : (
                <>
                  <Camera size={16} color={T.muted} strokeWidth={1.8} />
                  <Text style={{ color: T.muted, fontSize: 13 }}>Сделать фото</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <Text style={[st.sheetLabel, { color: T.muted }]}>КОММЕНТАРИЙ</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          multiline
          style={[st.input, st.textarea, { color: T.ink, borderColor: T.hairline }]}
          placeholder="Что произошло?"
          placeholderTextColor={T.muted}
        />

        <View style={st.sheetActions}>
          <TouchableOpacity style={[st.actionBtn, st.rejectBtn]} onPress={onClose}>
            <Text style={st.rejectText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={submitting} style={[st.actionBtn, { flex: 1.4, backgroundColor: T.red }]} onPress={submit}>
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.acceptText}>Отправить</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10 },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerStamp: { fontSize: 11, marginTop: 1 },
  content: { padding: 18, gap: 14, paddingBottom: 60 },

  card: {
    borderRadius: 16, borderWidth: 1, padding: 14,
    shadowColor: '#101c38', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  cardTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },

  pendingCard: { padding: 0, overflow: 'hidden', shadowColor: '#ff9500', shadowOpacity: 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } },
  pendingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  pendingHeaderText: { fontSize: 11, fontWeight: '700', color: '#8a5a00', letterSpacing: 0.8 },
  pendingCount: { minWidth: 19, height: 19, borderRadius: 10, backgroundColor: '#ff9500', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  pendingCountText: { fontSize: 11.5, fontWeight: '700', color: '#fff' },
  pendingBody: { paddingHorizontal: 14, paddingBottom: 4 },

  itemsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  itemsCountBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  itemsCountText: { fontSize: 11, fontWeight: '700' },

  emptyRow: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { fontSize: 13 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  itemRowBorder: { borderBottomWidth: 1 },
  itemImage: { width: 40, height: 40, borderRadius: 10 },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,140,0.15)' },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12, marginTop: 2 },
  itemQty: { fontSize: 16, fontWeight: '700' },

  transferRow: { paddingVertical: 10, gap: 3 },
  transferRowBorder: { borderBottomWidth: 1 },
  transferTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transferFrom: { fontSize: 14, fontWeight: '700' },
  transferItem: { fontSize: 12.5 },
  transferActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { backgroundColor: 'rgba(255,59,48,0.12)' },
  rejectText: { color: '#ff3b30', fontWeight: '700', fontSize: 13 },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  wideBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1 },
  wideBtnText: { fontSize: 14, fontWeight: '700' },

  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(10,21,40,0.45)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderBottomWidth: 0, padding: 18, paddingBottom: 26, gap: 4 },
  sheetHandle: { width: 38, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 14 },
  sheetLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 10, marginBottom: 7 },
  pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 12, padding: 11 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderRadius: 12, padding: 6, width: 116 },
  qtyBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: 17 },
  qtyValue: { fontSize: 16, fontWeight: '700' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42, borderWidth: 1, borderStyle: 'dashed', borderRadius: 12, overflow: 'hidden' },
  photoPreview: { width: '100%', height: '100%' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 11, fontSize: 14 },
  textarea: { minHeight: 64, textAlignVertical: 'top', marginBottom: 16 },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: 2 },
})
