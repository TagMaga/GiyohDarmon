import { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, TextInput, RefreshControl, Image, Modal,
  Pressable, FlatList,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import { getCashSummary, submitHandover, getHandoverHistory } from '../../src/api/orders'
import client from '../../src/api/client'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
dayjs.locale('ru')

const C = {
  bg: '#0d0f14', surface: '#1e2130', surface2: '#252838',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.13)',
  text: '#f0f2f8', text2: '#9095a8', text3: '#5e6478',
  accent: '#6366f1', green: '#10b981', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6',
  amberDim: 'rgba(245,158,11,0.12)', greenDim: 'rgba(16,185,129,0.15)',
  accentDim: 'rgba(99,102,241,0.15)', redDim: 'rgba(239,68,68,0.12)',
}

const MAX_ATTACHMENTS = 5
const fmt = (n) => Number(n || 0).toLocaleString()

// ── Attachment item ───────────────────────────────────────────────────────────

function AttachmentItem({ item, onRemove }) {
  const isImage = item.type?.startsWith('image')
  return (
    <View style={at.wrap}>
      {isImage
        ? <Image source={{ uri: item.uri }} style={at.thumb} />
        : (
          <View style={at.filePlaceholder}>
            <Text style={at.fileIcon}>📄</Text>
          </View>
        )
      }
      <Text style={at.name} numberOfLines={1}>{item.name || 'файл'}</Text>
      <TouchableOpacity style={at.removeBtn} onPress={() => onRemove(item.uri)}>
        <Text style={at.removeText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

const at = StyleSheet.create({
  wrap: {
    width: 80, marginRight: 10, alignItems: 'center', position: 'relative',
  },
  thumb: {
    width: 72, height: 72, borderRadius: 12, backgroundColor: C.surface2,
  },
  filePlaceholder: {
    width: 72, height: 72, borderRadius: 12, backgroundColor: C.surface2,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: C.border2,
  },
  fileIcon: { fontSize: 28 },
  name: { fontSize: 9, color: C.text3, marginTop: 4, textAlign: 'center', width: 72 },
  removeBtn: {
    position: 'absolute', top: -4, right: 0,
    width: 18, height: 18, borderRadius: 9, backgroundColor: C.red,
    justifyContent: 'center', alignItems: 'center',
  },
  removeText: { color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 18 },
})

// ── Main screen ───────────────────────────────────────────────────────────────

export default function CashScreen() {
  const [summary, setSummary]       = useState(null)
  const [history, setHistory]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showHandover, setShowHandover] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Form state ──
  const [attachments, setAttachments] = useState([])   // { uri, type, name }
  const [actualAmount, setActualAmount] = useState('')
  const [notes, setNotes]             = useState('')
  const [showPicker, setShowPicker]   = useState(false)

  const fetchData = async () => {
    try {
      const [s, h] = await Promise.all([getCashSummary(), getHandoverHistory()])
      setSummary(s.data.data)
      setHistory(h.data.data || [])
    } catch {}
    finally { setLoading(false); setRefreshing(false) }
  }

  useEffect(() => { fetchData() }, [])

  // ── Attachment picker ──────────────────────────────────────────────────────

  const pickCamera = async () => {
    setShowPicker(false)
    const { status } = await ImagePicker.requestCameraPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Нет доступа', 'Разрешите доступ к камере в настройках')
      return
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsMultipleSelection: false })
    if (!result.canceled && result.assets?.length) {
      addAssets(result.assets)
    }
  }

  const pickGallery = async () => {
    setShowPicker(false)
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Нет доступа', 'Разрешите доступ к галерее в настройках')
      return
    }
    const remaining = MAX_ATTACHMENTS - attachments.length
    if (remaining <= 0) {
      Alert.alert('Максимум', `Можно добавить не более ${MAX_ATTACHMENTS} файлов`)
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.8,
    })
    if (!result.canceled && result.assets?.length) {
      addAssets(result.assets)
    }
  }

  const addAssets = useCallback((assets) => {
    setAttachments(prev => {
      const toAdd = assets.slice(0, MAX_ATTACHMENTS - prev.length).map(a => ({
        uri:  a.uri,
        type: a.type === 'video' ? 'video/mp4' : (a.mimeType || 'image/jpeg'),
        name: a.fileName || `attachment_${Date.now()}.jpg`,
      }))
      return [...prev, ...toAdd]
    })
  }, [])

  const removeAttachment = (uri) => {
    setAttachments(prev => prev.filter(a => a.uri !== uri))
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleHandover = async () => {
    const expected = summary?.cash_to_handover || 0
    const amt = parseFloat(actualAmount)

    if (!amt || amt <= 0) {
      Alert.alert('Укажите сумму', 'Введите сумму перевода')
      return
    }
    if (attachments.length === 0) {
      Alert.alert('Нет подтверждения', 'Прикрепите скриншот перевода')
      return
    }

    const diff = amt - expected
    const diffStr = Math.abs(diff) < 0.01
      ? 'совпадает с ожидаемой суммой'
      : diff > 0
        ? `на ${fmt(diff)} смн больше ожидаемого`
        : `на ${fmt(Math.abs(diff))} смн меньше ожидаемого`

    Alert.alert(
      'Отправить на проверку?',
      `Сумма перевода: ${fmt(amt)} смн\nОжидается: ${fmt(expected)} смн\nРазница: ${diffStr}`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отправить',
          onPress: async () => {
            setSubmitting(true)
            try {
              // Upload all attachments
              const urls = await Promise.all(
                attachments.map(async (a) => {
                  const form = new FormData()
                  form.append('file', { uri: a.uri, type: a.type, name: a.name })
                  const res = await client.post('/uploads', form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                  })
                  return res.data.data?.url || res.data.url || ''
                })
              )
              const validUrls = urls.filter(Boolean)
              const proofUrl  = validUrls[0] || undefined
              const attJson   = validUrls.length > 1
                ? JSON.stringify(validUrls)
                : undefined

              await submitHandover({
                proof_url:        proofUrl,
                attachments_json: attJson,
                actual_amount:    amt,
                notes:            notes || undefined,
              })

              Alert.alert('Отправлено!', 'Запрос на передачу наличных отправлен на проверку')
              setAttachments([])
              setActualAmount('')
              setNotes('')
              setShowHandover(false)
              fetchData()
            } catch (e) {
              const msg = e?.response?.data?.error?.message || 'Попробуйте ещё раз'
              Alert.alert('Ошибка', msg)
            } finally {
              setSubmitting(false)
            }
          },
        },
      ]
    )
  }

  const toReturn   = summary?.cash_to_handover || 0
  const salary     = summary?.total_delivery_fees || 0
  const collected  = Number(toReturn) + Number(salary)
  const cashOrders = summary?.orders_collected || 0
  const hasDebt    = Number(toReturn) > 0

  // Difference preview
  const amtNum = parseFloat(actualAmount) || 0
  const diff   = amtNum - toReturn
  const hasDiff = amtNum > 0

  return (
    <SafeAreaView style={s.safe}>

      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>💰 Касса</Text>
          <Text style={s.headerDate}>{dayjs().format('dddd, D MMMM')}</Text>
        </View>
        <TouchableOpacity style={s.handoverBtn} onPress={() => setShowHandover(true)}>
          <Text style={s.handoverBtnText}>↩ Сдать наличные</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={C.accent} />}
        contentContainerStyle={s.content}
      >
        {loading
          ? <ActivityIndicator color={C.accent} style={{ marginTop: 64 }} />
          : <>
            {/* 2×2 KPI grid */}
            <View style={s.kpiGrid}>
              <View style={s.kpiCard}>
                <Text style={s.kpiIcon}>💵</Text>
                <Text style={s.kpiVal}>{fmt(collected)} смн</Text>
                <Text style={s.kpiLbl}>Собрано нал.</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={s.kpiIcon}>💼</Text>
                <Text style={[s.kpiVal, { color: C.green }]}>{fmt(salary)} смн</Text>
                <Text style={s.kpiLbl}>Моя зарплата</Text>
              </View>
              <View style={[s.kpiCard, hasDebt && { borderColor: C.amber }]}>
                <Text style={s.kpiIcon}>↩</Text>
                <Text style={[s.kpiVal, { color: hasDebt ? C.amber : C.text2 }]}>{fmt(toReturn)} смн</Text>
                <Text style={s.kpiLbl}>Вернуть в кассу</Text>
              </View>
              <View style={s.kpiCard}>
                <Text style={[s.kpiVal, { fontSize: 14 }]}>{cashOrders} зак.</Text>
                <Text style={s.kpiLbl}>Нал. заказов</Text>
              </View>
            </View>

            {/* Hero return card */}
            <View style={s.heroCard}>
              <Text style={s.heroLabel}>↩ НУЖНО СДАТЬ В КАССУ</Text>
              <Text style={s.heroAmount}>{fmt(toReturn)} смн</Text>
              <Text style={s.heroSub}>Собранные наличные – ваша зарплата</Text>
            </View>

            {/* Already handed */}
            {Number(summary?.already_handed) > 0 && (
              <View style={s.alreadyCard}>
                <Text style={s.alreadyLabel}>✓ Уже сдано</Text>
                <Text style={s.alreadyVal}>{fmt(summary?.already_handed)} смн</Text>
              </View>
            )}

            {/* History */}
            {history.length > 0 && (
              <View style={s.histSection}>
                <Text style={s.histTitle}>ИСТОРИЯ СДАЧИ</Text>
                <View style={s.histCard}>
                  {history.slice(0, 10).map((h, i) => {
                    const isConfirmed = h.status === 'confirmed'
                    const isPending   = h.status === 'pending'
                    const isRejected  = h.status === 'rejected'
                    const statusColor = isConfirmed ? C.green : isRejected ? C.red : C.amber
                    const statusLabel = isConfirmed ? 'Подтверждено' : isPending ? 'На проверке' : isRejected ? 'Отклонено' : h.status
                    return (
                      <View key={h.id} style={[s.histRow, i < history.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.histDate}>{dayjs(h.created_at).format('DD.MM.YYYY HH:mm')}</Text>
                          {h.admin_note && isRejected && (
                            <Text style={{ fontSize: 10, color: C.red, marginTop: 2 }} numberOfLines={1}>
                              ↩ {h.admin_note}
                            </Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 3 }}>
                          <Text style={[s.histAmount, { color: statusColor }]}>
                            {fmt(h.actual_returned ?? h.total_to_return)} смн
                          </Text>
                          <View style={[s.histBadge, { backgroundColor: `${statusColor}20` }]}>
                            <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor }}>{statusLabel}</Text>
                          </View>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </View>
            )}
          </>
        }
      </ScrollView>

      {/* ── Handover bottom sheet ─────────────────────────────────────────── */}
      <Modal visible={showHandover} animationType="slide" transparent statusBarTranslucent>
        <Pressable style={s.overlay} onPress={() => { if (!submitting) { setShowHandover(false); setAttachments([]); setActualAmount(''); setNotes('') } }}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <View style={s.sheetHandle} />

            <Text style={s.sheetTitle}>Сдать наличные</Text>

            {/* Expected amount */}
            <View style={s.expectedRow}>
              <Text style={s.expectedLabel}>Ожидается к сдаче</Text>
              <Text style={s.expectedVal}>{fmt(toReturn)} смн</Text>
            </View>

            {/* Actual amount input */}
            <View>
              <Text style={s.inputLabel}>Сумма перевода *</Text>
              <TextInput
                style={s.amountInput}
                placeholder="0"
                placeholderTextColor={C.text3}
                value={actualAmount}
                onChangeText={setActualAmount}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Difference preview */}
            {hasDiff && (
              <View style={[
                s.diffRow,
                Math.abs(diff) < 0.01
                  ? { backgroundColor: 'rgba(16,185,129,0.12)', borderColor: C.green }
                  : diff < 0
                    ? { backgroundColor: C.redDim, borderColor: C.red }
                    : { backgroundColor: C.amberDim, borderColor: C.amber }
              ]}>
                <Text style={s.diffLabel}>Разница</Text>
                <Text style={[
                  s.diffVal,
                  Math.abs(diff) < 0.01 ? { color: C.green } : diff < 0 ? { color: C.red } : { color: C.amber },
                ]}>
                  {Math.abs(diff) < 0.01 ? '= 0' : diff > 0 ? `+${fmt(diff)} смн` : `−${fmt(Math.abs(diff))} смн`}
                </Text>
              </View>
            )}

            {/* Attachments section */}
            <View>
              <View style={s.attachHeader}>
                <Text style={s.inputLabel}>Скриншот перевода *</Text>
                <Text style={s.attachCount}>{attachments.length}/{MAX_ATTACHMENTS}</Text>
              </View>

              {attachments.length > 0 && (
                <FlatList
                  data={attachments}
                  keyExtractor={a => a.uri}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 10 }}
                  renderItem={({ item }) => (
                    <AttachmentItem item={item} onRemove={removeAttachment} />
                  )}
                />
              )}

              {attachments.length < MAX_ATTACHMENTS && (
                <TouchableOpacity
                  style={s.addProofBtn}
                  onPress={() => setShowPicker(true)}
                >
                  <Text style={s.addProofIcon}>＋</Text>
                  <Text style={s.addProofText}>Добавить подтверждение</Text>
                  <Text style={s.addProofSub}>Камера · Галерея · Файл</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Notes */}
            <TextInput
              style={s.notesInput}
              placeholder="Примечание (необязательно)"
              placeholderTextColor={C.text3}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            {/* Submit */}
            <TouchableOpacity
              style={[s.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={handleHandover}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.submitBtnText}>↑ Отправить на проверку</Text>
              }
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Source picker modal ────────────────────────────────────────────── */}
      <Modal visible={showPicker} animationType="fade" transparent statusBarTranslucent>
        <Pressable style={s.pickerOverlay} onPress={() => setShowPicker(false)}>
          <View style={s.pickerSheet}>
            <Text style={s.pickerTitle}>Добавить подтверждение</Text>

            <TouchableOpacity style={s.pickerOption} onPress={pickCamera}>
              <Text style={s.pickerOptionIcon}>📷</Text>
              <View>
                <Text style={s.pickerOptionLabel}>Камера</Text>
                <Text style={s.pickerOptionSub}>Сфотографировать квитанцию</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.pickerOption} onPress={pickGallery}>
              <Text style={s.pickerOptionIcon}>🖼️</Text>
              <View>
                <Text style={s.pickerOptionLabel}>Галерея</Text>
                <Text style={s.pickerOptionSub}>Выбрать скриншот или фото</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[s.pickerOption, { borderBottomWidth: 0 }]} onPress={pickGallery}>
              <Text style={s.pickerOptionIcon}>📁</Text>
              <View>
                <Text style={s.pickerOptionLabel}>Файл</Text>
                <Text style={s.pickerOptionSub}>Выбрать документ из галереи</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={s.pickerCancel} onPress={() => setShowPicker(false)}>
              <Text style={s.pickerCancelText}>Отмена</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  headerDate:  { fontSize: 12, color: C.text2, marginTop: 2 },
  handoverBtn: {
    backgroundColor: C.accent, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  handoverBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  content: { paddingHorizontal: 12, paddingBottom: 32, gap: 12 },

  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiCard: {
    width: '48%', backgroundColor: C.surface2, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 3,
  },
  kpiIcon: { fontSize: 18, marginBottom: 4 },
  kpiVal:  { fontSize: 16, fontWeight: '800', color: C.text },
  kpiLbl:  { fontSize: 11, color: C.text2 },

  heroCard: {
    backgroundColor: C.amberDim, borderRadius: 16, padding: 18,
    borderWidth: 1.5, borderColor: C.amber,
  },
  heroLabel:  { fontSize: 10, fontWeight: '700', color: C.amber, letterSpacing: 1.2, marginBottom: 8 },
  heroAmount: { fontSize: 44, fontWeight: '800', color: C.amber, lineHeight: 50, marginBottom: 6 },
  heroSub:    { fontSize: 11, color: C.text3 },

  alreadyCard: {
    backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.green, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  alreadyLabel: { fontSize: 12, fontWeight: '600', color: C.green },
  alreadyVal:   { fontSize: 16, fontWeight: '800', color: C.green },

  histSection: { gap: 8 },
  histTitle:   { fontSize: 10, fontWeight: '700', color: C.text3, letterSpacing: 1 },
  histCard:    { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  histRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  histDate:    { fontSize: 13, fontWeight: '600', color: C.text },
  histBadge:   { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  histAmount:  { fontSize: 13, fontWeight: '700' },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: C.border2,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16,
    gap: 14, maxHeight: '92%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 99, backgroundColor: C.border2, alignSelf: 'center', marginBottom: 6 },
  sheetTitle:  { fontSize: 18, fontWeight: '800', color: C.text },

  expectedRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  expectedLabel: { fontSize: 12, color: C.text2, fontWeight: '500' },
  expectedVal:   { fontSize: 18, fontWeight: '800', color: C.amber },

  inputLabel: { fontSize: 11, fontWeight: '600', color: C.text2, marginBottom: 6, letterSpacing: 0.5 },
  amountInput: {
    backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.accent,
    borderRadius: 12, padding: 14, fontSize: 24, fontWeight: '800', color: C.text,
    textAlign: 'center',
  },

  diffRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1,
  },
  diffLabel: { fontSize: 12, fontWeight: '600', color: C.text2 },
  diffVal:   { fontSize: 15, fontWeight: '800' },

  attachHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  attachCount:  { fontSize: 11, color: C.text3, fontWeight: '600' },

  addProofBtn: {
    borderWidth: 1.5, borderColor: C.border2, borderStyle: 'dashed', borderRadius: 14,
    height: 72, justifyContent: 'center', alignItems: 'center', gap: 2,
    backgroundColor: C.surface2,
  },
  addProofIcon: { fontSize: 20, marginBottom: 2 },
  addProofText: { fontSize: 13, fontWeight: '600', color: C.text2 },
  addProofSub:  { fontSize: 10, color: C.text3 },

  notesInput: {
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    padding: 12, fontSize: 14, color: C.text, minHeight: 48,
  },
  submitBtn: {
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5,
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 16, paddingBottom: 40,
  },
  pickerTitle: {
    fontSize: 12, fontWeight: '700', color: C.text3, letterSpacing: 1,
    textAlign: 'center', marginBottom: 8, paddingHorizontal: 20,
  },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  pickerOptionIcon:  { fontSize: 24, width: 32, textAlign: 'center' },
  pickerOptionLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  pickerOptionSub:   { fontSize: 11, color: C.text3, marginTop: 1 },
  pickerCancel: {
    marginTop: 8, paddingVertical: 14, alignItems: 'center', marginHorizontal: 20,
    backgroundColor: C.surface2, borderRadius: 12,
  },
  pickerCancelText: { fontSize: 15, fontWeight: '600', color: C.text2 },
})
