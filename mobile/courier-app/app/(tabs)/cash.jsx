import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, TextInput, RefreshControl, Image, Modal,
  Pressable, FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { getCashSummary, submitHandover, getHandoverHistory, getMyOrders } from '../../src/api/orders'
import client, { API_URL } from '../../src/api/client'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
dayjs.locale('ru')

const C = {
  bg: '#f6f8fb', card: '#ffffff', ink: '#071122', muted: '#7d8797', line: '#e6ecf3',
  blue: '#1683ff', violet: '#665cff', green: '#12b76a', orange: '#ff9f0a', red: '#ff453a',
}

const MAX_ATTACHMENTS = 5
const fmt = (n) => Number(n || 0).toLocaleString()

function AttachmentItem({ item, onRemove, onPreview }) {
  const isImage = item.type?.startsWith('image')
  return (
    <View style={at.wrap}>
      <TouchableOpacity activeOpacity={0.85} onPress={() => isImage && onPreview?.(item.uri)}>
        {isImage
          ? <Image source={{ uri: item.uri }} style={at.thumb} />
          : <View style={at.filePlaceholder}><Text style={at.fileIcon}>📄</Text></View>
        }
      </TouchableOpacity>
      <Text style={at.name} numberOfLines={1}>{item.name || 'файл'}</Text>
      <TouchableOpacity style={at.removeBtn} onPress={() => onRemove(item.uri)}>
        <Text style={at.removeText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

const at = StyleSheet.create({
  wrap: { width: 80, marginRight: 10, alignItems: 'center', position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  filePlaceholder: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#f1f4f8', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  fileIcon: { fontSize: 28 },
  name: { fontSize: 9, color: C.muted, marginTop: 4, textAlign: 'center', width: 72 },
  removeBtn: { position: 'absolute', top: -4, right: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: C.red, justifyContent: 'center', alignItems: 'center' },
  removeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 18 },
})

export default function CashScreen() {
  const [summary, setSummary]       = useState(null)
  const [history, setHistory]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showHandover, setShowHandover] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cashTab, setCashTab]       = useState('handover')
  const [attachments, setAttachments] = useState([])
  const [actualAmount, setActualAmount] = useState('')
  const [notes, setNotes]           = useState('')
  const [previewUri, setPreviewUri] = useState(null)
  const [delivered, setDelivered]   = useState([])

  const fetchData = async () => {
    try {
      const [s, h, d] = await Promise.all([
        getCashSummary().catch((e) => { Alert.alert('Ошибка', 'Не удалось загрузить сводку наличных'); throw e }),
        getHandoverHistory().catch((e) => { Alert.alert('Ошибка', 'Не удалось загрузить историю сдач'); throw e }),
        getMyOrders({ status: 'delivered' }).catch(() => ({ data: { data: [] } })),
      ])
      setSummary(s.data.data)
      setHistory(h.data.data || [])
      setDelivered((d.data.data || []).filter(o => (o.status ?? o.Status) === 'delivered'))
    } catch {}
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetchData() }, [])

  // Tapping the upload zone opens the gallery directly (no camera/gallery action
  // sheet). The native gallery picker presents reliably over the open handover
  // <Modal> inside Expo Go.
  const pickGallery = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Максимум', `Можно добавить не более ${MAX_ATTACHMENTS} файлов`); return }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Нет доступа', 'Разрешите доступ к галерее в настройках'); return }
    const remaining = MAX_ATTACHMENTS - attachments.length
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.8 })
    if (!result.canceled && result.assets?.length) addAssets(result.assets)
  }

  const addAssets = useCallback((assets) => {
    setAttachments(prev => {
      const toAdd = assets.slice(0, MAX_ATTACHMENTS - prev.length).map(a => ({
        uri: a.uri, type: a.type === 'video' ? 'video/mp4' : (a.mimeType || 'image/jpeg'),
        name: a.fileName || `attachment_${Date.now()}.jpg`,
      }))
      return [...prev, ...toAdd]
    })
  }, [])

  const removeAttachment = (uri) => setAttachments(prev => prev.filter(a => a.uri !== uri))

  const handleHandover = async () => {
    const expected = toReturn
    const amt = parseFloat(actualAmount)
    if (!amt || amt <= 0) { Alert.alert('Укажите сумму', 'Введите сумму перевода'); return }
    if (attachments.length === 0) { Alert.alert('Нет подтверждения', 'Прикрепите скриншот перевода'); return }

    Alert.alert('Отправить на проверку?', `Сумма: ${fmt(amt)} TJS`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отправить', onPress: async () => {
        setSubmitting(true)
        try {
          const urls = await Promise.all(attachments.map(async (a) => {
            const form = new FormData()
            form.append('file', { uri: a.uri, type: a.type, name: a.name })
            const res = await client.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } })
            return res.data.data?.url || res.data.url || ''
          }))
          const validUrls = urls.filter(Boolean)
          await submitHandover({
            proof_url: validUrls[0] || undefined,
            attachments_json: validUrls.length > 1 ? JSON.stringify(validUrls) : undefined,
            actual_amount: amt,
            notes: notes || undefined,
          })
          Alert.alert('Отправлено!', 'Запрос на передачу наличных отправлен на проверку')
          setAttachments([]); setActualAmount(''); setNotes(''); setShowHandover(false); fetchData()
        } catch (e) {
          Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Попробуйте ещё раз')
        } finally { setSubmitting(false) }
      }},
    ])
  }

  const collected = summary?.cash_to_handover || 0
  const salary    = summary?.total_delivery_fees || 0
  const toReturn  = Math.max(0, Number(collected) - Number(salary))
  const cashOrders = summary?.orders_collected || 0
  const pendingHandover = history.filter(h => h.status === 'pending').reduce((s, h) => s + (h.actual_returned ?? h.total_to_return ?? 0), 0)
  const amtNum = parseFloat(actualAmount) || 0
  const diff = amtNum - toReturn
  const hasDiff = amtNum > 0

  // Earnings = courier's fixed delivery fee per delivered order (independent of
  // handover status). Built from the courier's delivered orders.
  const fullUrl = (u) => (!u ? null : u.startsWith('http') ? u : `${API_URL}${u}`)
  const earnings = delivered.map(o => ({
    id: o.order_id ?? o.id,
    number: o.order_number ?? o.OrderNumber ?? '—',
    fee: Number(o.courier_payout ?? o.delivery_fee ?? o.DeliveryFee ?? 0),
    date: o.delivered_at ?? o.assigned_at ?? o.created_at,
    address: o.customer_address ?? o.customer?.address,
  }))
  const earningsTotal = earnings.reduce((sum, e) => sum + e.fee, 0)

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={C.blue} />}
        contentContainerStyle={s.content}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.headTitle}>Касса</Text>
            <Text style={s.headSub}>{dayjs().format('dddd, D MMMM')}</Text>
          </View>
        </View>

        {loading
          ? <ActivityIndicator color={C.blue} style={{ marginTop: 64 }} />
          : <>
            {/* Cash hero (white/orange card) */}
            <View style={s.cashHero}>
              <Text style={s.cashLabel}>нужно вернуть сегодня</Text>
              <Text style={s.cashSum}>{fmt(toReturn)} TJS</Text>
              <View style={s.formula}>
                <Text style={s.formulaVal}>{fmt(collected)}</Text>
                <Text style={s.formulaMuted}>−</Text>
                <Text style={s.formulaGreen}>{fmt(salary)}</Text>
                <Text style={s.formulaMuted}>=</Text>
                <Text style={s.formulaOrange}>{fmt(toReturn)} TJS</Text>
              </View>
              <Text style={s.caption}>Собранные наличные − Ваша зарплата</Text>
              {pendingHandover > 0 && (
                <View style={s.pendingRow}>
                  <Text style={s.pendingText}>На проверке у диспетчера</Text>
                  <Text style={s.pendingVal}>{fmt(pendingHandover)} TJS</Text>
                </View>
              )}
              <TouchableOpacity
                style={[s.submitBtn, toReturn === 0 && s.submitBtnDisabled]}
                onPress={() => toReturn > 0 && setShowHandover(true)}
                activeOpacity={toReturn > 0 ? 0.8 : 1}
              >
                <Text style={s.submitBtnText}>
                  {toReturn === 0 ? 'Касса сдана' : 'Сдать наличные'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Segmented control */}
            <View style={s.segmented}>
              <TouchableOpacity style={[s.seg, cashTab === 'handover' && s.segActive]} onPress={() => setCashTab('handover')}>
                <Text style={[s.segText, cashTab === 'handover' && s.segActiveText]}>Сдача наличных</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.seg, cashTab === 'earnings' && s.segActive]} onPress={() => setCashTab('earnings')}>
                <Text style={[s.segText, cashTab === 'earnings' && s.segActiveText]}>Заработки</Text>
              </TouchableOpacity>
            </View>

            {cashTab === 'handover' && (
              <>
                <View style={s.listHead}>
                  <Text style={s.listTitle}>СДАЧА НАЛИЧНЫХ</Text>
                  <Text style={s.listTotal}>Всего сдано: <Text style={{ color: C.orange }}>{fmt(history.filter(h => h.status === 'confirmed').reduce((s, h) => s + (h.actual_returned ?? h.total_to_return ?? 0), 0))} TJS</Text></Text>
                </View>
                <View style={s.histCard}>
                  {history.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: C.muted, fontWeight: '800' }}>Инкассаций пока нет</Text>
                    </View>
                  )}
                  {history.map((h, i) => {
                    const isConfirmed = h.status === 'confirmed'
                    const isPending   = h.status === 'pending'
                    const isRejected  = h.status === 'rejected'
                    const statusColor = isConfirmed ? C.green : isRejected ? C.red : C.orange
                    const statusLabel = isConfirmed ? 'Подтверждено ✅' : isPending ? 'Ожидает проверки ⏳' : isRejected ? 'Отклонено ❌' : h.status
                    const amount = h.actual_returned ?? h.total_to_return ?? 0
                    const date = h.created_at
                    const proof = fullUrl(h.proof_url)
                    return (
                      <View key={h.id || i} style={[s.cashItem, i === history.length - 1 && { borderBottomWidth: 0 }]}>
                        {proof
                          ? <TouchableOpacity activeOpacity={0.85} onPress={() => setPreviewUri(proof)}>
                              <Image source={{ uri: proof }} style={s.receipt} />
                            </TouchableOpacity>
                          : <View style={s.receipt} />}
                        <View style={{ flex: 1 }}>
                          <Text style={s.cashItemTime}>{date ? dayjs(date).format('HH:mm') : '—'}</Text>
                          <Text style={s.cashItemTitle}>Сдано наличными</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.cashAmount}>{fmt(amount)} TJS</Text>
                          <Text style={{ fontSize: 11, marginTop: 4, color: statusColor, fontWeight: '900' }}>{statusLabel}</Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </>
            )}

            {cashTab === 'earnings' && (
              <>
                <View style={s.listHead}>
                  <Text style={s.listTitle}>ЗАРАБОТКИ</Text>
                  <Text style={s.listTotal}>Всего: <Text style={{ color: C.green }}>{fmt(earningsTotal)} TJS</Text></Text>
                </View>
                <View style={s.histCard}>
                  {earnings.length === 0 ? (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: C.muted, fontWeight: '800' }}>Пока нет доставленных заказов</Text>
                    </View>
                  ) : earnings.map((e, i) => (
                    <View key={e.id || i} style={[s.cashItem, i === earnings.length - 1 && { borderBottomWidth: 0 }]}>
                      <View style={s.earnIcon}><Text style={{ fontSize: 20 }}>💰</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cashItemTitle}>{e.number}</Text>
                        <Text style={s.cashItemTime} numberOfLines={1}>
                          {e.date ? dayjs(e.date).format('DD.MM.YYYY') : '—'}{e.address ? ` · ${e.address}` : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[s.cashAmount, { color: C.green }]}>+{fmt(e.fee)} TJS</Text>
                        <Text style={{ fontSize: 11, marginTop: 4, color: C.green, fontWeight: '900' }}>Доставлен</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        }
      </ScrollView>

      {/* Handover bottom sheet */}
      <Modal visible={showHandover} animationType="slide" transparent statusBarTranslucent>
        <Pressable style={s.overlay} onPress={() => { if (!submitting) { setShowHandover(false); setAttachments([]); setActualAmount(''); setNotes('') } }}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />
            <ScrollView contentContainerStyle={s.sheetContent} showsVerticalScrollIndicator={false}>
              <Text style={s.sheetTitle}>Сдать наличные</Text>

              <View style={s.sheetRow}>
                <Text style={s.sheetRowLabel}>Ожидается к сдаче</Text>
                <Text style={s.sheetRowVal}>{fmt(toReturn)} TJS</Text>
              </View>

              <View style={s.field}>
                <Text style={s.fieldLabel}>Сумма перевода *</Text>
                <TextInput
                  style={s.amountInput}
                  placeholder="0"
                  placeholderTextColor={C.muted}
                  value={actualAmount}
                  onChangeText={setActualAmount}
                  keyboardType="decimal-pad"
                />
              </View>

              {hasDiff && (
                <View style={[s.diffRow, Math.abs(diff) < 0.01 ? { backgroundColor: '#e8f8f0', borderColor: C.green } : diff < 0 ? { backgroundColor: '#fff1f1', borderColor: C.red } : { backgroundColor: '#fff5df', borderColor: C.orange }]}>
                  <Text style={s.diffLabel}>Разница</Text>
                  <Text style={[s.diffVal, Math.abs(diff) < 0.01 ? { color: C.green } : diff < 0 ? { color: C.red } : { color: C.orange }]}>
                    {Math.abs(diff) < 0.01 ? '= 0' : diff > 0 ? `+${fmt(diff)} TJS` : `−${fmt(Math.abs(diff))} TJS`}
                  </Text>
                </View>
              )}

              <View style={s.field}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={s.fieldLabel}>Скриншот перевода *</Text>
                  <Text style={{ fontSize: 13, color: C.muted }}>{attachments.length}/{MAX_ATTACHMENTS}</Text>
                </View>
                {attachments.length > 0 && (
                  <FlatList
                    data={attachments}
                    keyExtractor={a => a.uri}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginBottom: 10 }}
                    renderItem={({ item }) => <AttachmentItem item={item} onRemove={removeAttachment} onPreview={setPreviewUri} />}
                  />
                )}
                {attachments.length < MAX_ATTACHMENTS && (
                  <TouchableOpacity style={s.uploadArea} onPress={pickGallery} activeOpacity={0.7}>
                    <Text style={s.uploadPlus}>＋</Text>
                    <Text style={s.uploadText}>Добавить подтверждение</Text>
                    <Text style={s.uploadSub}>Галерея</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={s.field}>
                <Text style={s.fieldLabel}>Примечание</Text>
                <TextInput
                  style={s.textarea}
                  placeholder="Примечание для диспетчера…"
                  placeholderTextColor={C.muted}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                />
              </View>

              <TouchableOpacity style={[s.submitBigBtn, submitting && { opacity: 0.5 }]} onPress={handleHandover} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBigBtnText}>↑ Отправить на проверку</Text>}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-screen image preview — works for both locally selected proofs and
          submitted handover photos from history. Tap anywhere or X to close. */}
      <Modal visible={!!previewUri} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setPreviewUri(null)}>
        <Pressable style={s.previewOverlay} onPress={() => setPreviewUri(null)}>
          <TouchableOpacity style={s.previewClose} onPress={() => setPreviewUri(null)} hitSlop={12}>
            <Text style={s.previewCloseText}>✕</Text>
          </TouchableOpacity>
          {previewUri && (
            <Image source={{ uri: previewUri }} style={s.previewImage} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  headTitle: { fontSize: 28, fontWeight: '900', color: C.ink, letterSpacing: -0.8 },
  headSub: { fontSize: 13, color: C.muted, fontWeight: '800', marginTop: 6 },
  // Cash hero
  cashHero: { marginHorizontal: 18, backgroundColor: C.card, borderWidth: 1, borderColor: '#ffdaa0', borderRadius: 32, padding: 24, marginBottom: 16, shadowColor: C.orange, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.1, shadowRadius: 34, elevation: 4, overflow: 'hidden' },
  cashLabel: { fontSize: 13, color: '#d88900', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  cashSum: { fontSize: 52, fontWeight: '900', letterSpacing: -2, color: C.orange, marginTop: 14, marginBottom: 16, lineHeight: 58 },
  formula: { backgroundColor: '#f6f8fb', borderRadius: 22, padding: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  formulaVal: { fontSize: 18, fontWeight: '900', color: C.ink },
  formulaMuted: { fontSize: 18, fontWeight: '900', color: C.muted },
  formulaGreen: { fontSize: 18, fontWeight: '900', color: C.green },
  formulaOrange: { fontSize: 18, fontWeight: '900', color: C.orange },
  caption: { textAlign: 'center', color: C.muted, fontWeight: '700', marginTop: 12, fontSize: 13 },
  pendingRow: { marginTop: 14, paddingVertical: 14, paddingHorizontal: 15, borderRadius: 20, backgroundColor: '#fff5df', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingText: { color: '#b87500', fontWeight: '900', fontSize: 13 },
  pendingVal: { color: '#b87500', fontWeight: '900', fontSize: 14 },
  submitBtn: { width: '100%', marginTop: 16, borderRadius: 22, paddingVertical: 18, backgroundColor: C.violet, alignItems: 'center', shadowColor: C.violet, shadowOffset: { width: 0, height: 13 }, shadowOpacity: 0.22, shadowRadius: 26, elevation: 4 },
  submitBtnDisabled: { backgroundColor: '#c4c9d4', shadowOpacity: 0 },
  submitBtnText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  // Segmented
  segmented: { marginHorizontal: 18, backgroundColor: '#eaf0f7', borderRadius: 24, padding: 5, flexDirection: 'row', marginBottom: 16 },
  seg: { flex: 1, borderRadius: 20, paddingVertical: 14, alignItems: 'center' },
  segActive: { backgroundColor: C.violet, shadowColor: C.violet, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 18, elevation: 3 },
  segText: { fontSize: 14, fontWeight: '900', color: '#697385' },
  segActiveText: { color: '#fff' },
  // List
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 18, marginBottom: 12 },
  listTitle: { fontSize: 14, letterSpacing: 0.7, color: '#7f8796', textTransform: 'uppercase', fontWeight: '900' },
  listTotal: { fontSize: 13, color: C.muted, fontWeight: '800' },
  histCard: { marginHorizontal: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 28, overflow: 'hidden', shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3 },
  cashItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  receipt: { width: 50, height: 62, borderRadius: 10, backgroundColor: '#f8f8f8' },
  cashItemTime: { fontSize: 12, color: C.muted, fontWeight: '800', marginBottom: 6 },
  cashItemTitle: { fontSize: 14, fontWeight: '900', color: C.ink },
  cashAmount: { fontSize: 16, fontWeight: '900', color: C.orange },
  // Sheet
  overlay: { flex: 1, backgroundColor: 'rgba(7,17,34,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '92%' },
  sheetHandle: { width: 74, height: 6, borderRadius: 99, backgroundColor: '#d9deea', alignSelf: 'center', marginTop: 14 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40, gap: 16 },
  sheetTitle: { fontSize: 28, fontWeight: '900', color: C.ink },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 15 },
  sheetRowLabel: { color: C.muted, fontWeight: '800', fontSize: 14 },
  sheetRowVal: { fontSize: 22, fontWeight: '900', color: C.orange },
  field: {},
  fieldLabel: { fontSize: 14, color: C.muted, fontWeight: '900', marginBottom: 10 },
  amountInput: { borderWidth: 1.5, borderColor: '#dfe5ef', backgroundColor: '#f8fafc', borderRadius: 22, paddingVertical: 18, fontSize: 28, fontWeight: '900', textAlign: 'center', color: C.ink },
  diffRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
  diffLabel: { fontSize: 13, fontWeight: '700', color: C.muted },
  diffVal: { fontSize: 15, fontWeight: '900' },
  uploadArea: { borderWidth: 1.5, borderColor: '#dfe5ef', borderStyle: 'dashed', borderRadius: 22, paddingVertical: 24, alignItems: 'center', backgroundColor: '#f8fafc' },
  uploadPlus: { fontSize: 34, fontWeight: '900', color: C.ink, marginBottom: 8 },
  uploadText: { fontSize: 16, fontWeight: '900', color: C.muted },
  uploadSub: { fontSize: 12, color: C.muted, marginTop: 4 },
  textarea: { borderWidth: 1.5, borderColor: '#dfe5ef', backgroundColor: '#f8fafc', borderRadius: 22, padding: 18, fontSize: 15, fontWeight: '700', color: C.ink, minHeight: 88, textAlignVertical: 'top' },
  submitBigBtn: { backgroundColor: C.violet, borderRadius: 22, paddingVertical: 18, alignItems: 'center', shadowColor: C.violet, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.22, shadowRadius: 28, elevation: 4 },
  submitBigBtnText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  // Earnings
  earnIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#e8f8f0', justifyContent: 'center', alignItems: 'center' },
  // Image preview
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '92%', height: '80%' },
  previewClose: { position: 'absolute', top: 52, right: 22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  previewCloseText: { color: '#fff', fontSize: 20, fontWeight: '900' },
})
