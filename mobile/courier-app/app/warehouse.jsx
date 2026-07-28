import { useCallback, useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView,
  ActivityIndicator, Alert, TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ChevronLeft, Package, RotateCcw, TriangleAlert } from 'lucide-react-native'
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

export default function WarehouseScreen() {
  const { T, dark } = useGlass()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [showLostForm, setShowLostForm] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await getMyWarehouse()
      setData(res.data?.data ?? res.data)
    } catch (err) {
      Alert.alert('Ошибка', 'Не удалось загрузить склад')
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(useCallback(() => { load() }, [load]))

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

  return (
    <SafeAreaView style={[st.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.backBtn}>
          <ChevronLeft size={22} color={T.ink} />
        </TouchableOpacity>
        <Text style={[st.headerTitle, { color: T.ink }]}>Мой склад</Text>
        <View style={{ width: 34 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={T.blue} /></View>
      ) : (
        <ScrollView contentContainerStyle={st.content}>
          {(data?.pending_transfers ?? []).length > 0 && (
            <View style={[st.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
              <Text style={[st.cardTitle, { color: T.muted }]}>ОЖИДАЕТ ПОДТВЕРЖДЕНИЯ</Text>
              {data.pending_transfers.map((t) => (
                <View key={t.id} style={[st.transferRow, { borderBottomColor: T.hairline }]}>
                  <Text style={[st.transferFrom, { color: T.ink }]}>{t.from_warehouse_name}</Text>
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
          )}

          <View style={[st.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
            <Text style={[st.cardTitle, { color: T.muted }]}>ТОВАРЫ НА СКЛАДЕ</Text>
            {(data?.items ?? []).length === 0 ? (
              <View style={st.emptyRow}>
                <Package size={22} color={T.muted} />
                <Text style={[st.emptyText, { color: T.muted }]}>У вас нет товаров на складе</Text>
              </View>
            ) : (
              data.items.map((item) => (
                <View key={item.product_id} style={[st.itemRow, { borderBottomColor: T.hairline }]}>
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
            style={[st.wideBtn, { borderColor: T.cardEdge }]}
            disabled={busyId === 'return'}
            onPress={handleReturnAll}
          >
            <RotateCcw size={17} color={T.ink} />
            <Text style={[st.wideBtnText, { color: T.ink }]}>Вернуть все товары</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[st.wideBtn, { borderColor: T.red }]}
            onPress={() => setShowLostForm(true)}
          >
            <TriangleAlert size={17} color={T.red} />
            <Text style={[st.wideBtnText, { color: T.red }]}>Сообщить об утере товара</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {showLostForm && (
        <LostProductForm
          items={data?.items ?? []}
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
    <View style={[st.overlay]}>
      <View style={[st.sheet, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
        <Text style={[st.sheetTitle, { color: T.ink }]}>Утеря товара</Text>
        <Text style={[st.sheetLabel, { color: T.muted }]}>Товар</Text>
        {items.map((it) => (
          <TouchableOpacity
            key={it.product_id}
            style={[st.pickRow, productId === it.product_id && { backgroundColor: T.chip }]}
            onPress={() => setProductId(it.product_id)}
          >
            <Text style={{ color: T.ink }}>{it.product_name}</Text>
          </TouchableOpacity>
        ))}
        <Text style={[st.sheetLabel, { color: T.muted }]}>Количество</Text>
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="number-pad"
          style={[st.input, { color: T.ink, borderColor: T.cardEdge }]}
        />
        <Text style={[st.sheetLabel, { color: T.muted }]}>Комментарий</Text>
        <TextInput
          value={comment}
          onChangeText={setComment}
          multiline
          style={[st.input, st.textarea, { color: T.ink, borderColor: T.cardEdge }]}
          placeholder="Что произошло?"
          placeholderTextColor={T.muted}
        />
        <TouchableOpacity style={[st.photoBtn, { borderColor: T.cardEdge }]} onPress={pickPhoto}>
          {photo ? <Image source={{ uri: photo.uri }} style={st.photoPreview} /> : <Text style={{ color: T.muted }}>Сделать фото</Text>}
        </TouchableOpacity>
        <View style={st.sheetActions}>
          <TouchableOpacity style={[st.actionBtn, st.rejectBtn]} onPress={onClose}>
            <Text style={st.rejectText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={submitting} style={[st.actionBtn, { backgroundColor: T.red }]} onPress={submit}>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12 },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  cardTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  emptyRow: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { fontSize: 13 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  itemImage: { width: 40, height: 40, borderRadius: 10 },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,140,0.15)' },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12, marginTop: 2 },
  itemQty: { fontSize: 16, fontWeight: '700' },
  transferRow: { paddingVertical: 10, borderBottomWidth: 1, gap: 3 },
  transferFrom: { fontSize: 14, fontWeight: '700' },
  transferItem: { fontSize: 12.5 },
  transferActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rejectBtn: { backgroundColor: 'rgba(255,69,58,0.12)' },
  rejectText: { color: '#ff453a', fontWeight: '700', fontSize: 13 },
  acceptText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  wideBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1 },
  wideBtnText: { fontSize: 14, fontWeight: '700' },
  overlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  sheet: { width: '100%', borderRadius: 18, borderWidth: 1, padding: 18, gap: 4 },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  sheetLabel: { fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  pickRow: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  photoBtn: { marginTop: 10, minHeight: 90, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoPreview: { width: '100%', height: 90 },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
})
