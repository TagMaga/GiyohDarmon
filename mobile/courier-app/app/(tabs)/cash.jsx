import { useState, useCallback, useRef, useEffect } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, TextInput, RefreshControl, Image, Modal,
  Pressable, FlatList, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from '@react-navigation/native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { getCashSummary, submitHandover, getHandoverHistory, getMyOrders } from '../../src/api/orders'
import { securePrivateUpload } from '../../src/api/media'
import { API_URL } from '../../src/api/client'
import { FadeSlideIn, PressScale, CountUp, Skeleton, animateLayout } from '../../src/components/motion'
import CachedImage from '../../src/components/CachedImage'
import { GlassBackdrop, GlassFill, Sheen, useGlass } from '../../src/components/glass'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
dayjs.locale('ru')

const C = {
  bg: '#eef2fa', card: '#ffffff', ink: '#0a1528', muted: '#5f6e88', line: 'rgba(120,144,180,0.30)',
  blue: '#0a84ff', violet: '#5e5ce6', green: '#34c759', orange: '#ff9500', red: '#ff3b30',
}

const MAX_ATTACHMENTS = 5
const fmt = (n) => Number(n || 0).toLocaleString()

// Cap for a receipt photo's longer side before upload. The picker's own
// `quality` option only re-encodes JPEGs — it does nothing to an
// already-compressed source (e.g. a phone screenshot saved as PNG/WebP), so
// without this a full-resolution screenshot went up untouched, sometimes
// multiple MB, then had to be downloaded again in full just to render a
// small thumbnail in the owner's CRM (see the 2026-07 slow-receipt report).
const MAX_RECEIPT_DIMENSION = 1600

// Resizes a picked asset down to MAX_RECEIPT_DIMENSION if it's larger;
// never upscales. Falls back to the original asset untouched if
// manipulation fails for any reason — a slightly larger upload beats a
// crashed handover submission.
async function resizeForUpload(asset) {
  if (!asset.width || asset.width <= MAX_RECEIPT_DIMENSION) return asset
  try {
    const out = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: MAX_RECEIPT_DIMENSION } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    )
    return {
      ...asset, uri: out.uri, width: out.width, height: out.height,
      mimeType: 'image/jpeg',
      fileName: (asset.fileName || 'receipt').replace(/\.\w+$/, '') + '.jpg',
    }
  } catch {
    return asset
  }
}

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
      <TouchableOpacity
        style={at.removeBtn}
        onPress={() => onRemove(item.uri)}
        hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
      >
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
  // 28px visual target + 8px hitSlop on every side → 44px effective touch target
  removeBtn: { position: 'absolute', top: -9, right: -9, width: 28, height: 28, borderRadius: 14, backgroundColor: C.red, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#f0f4fc' },
  removeText: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 13 },
})

export default function CashScreen() {
  const { dark, T }                 = useGlass()
  const [summary, setSummary]       = useState(null)
  const [history, setHistory]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showHandover, setShowHandover] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [cashTab, setCashTab]         = useState('handover')
  const [periodFilter, setPeriodFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [attachments, setAttachments] = useState([])
  const [actualAmount, setActualAmount] = useState('')
  const [notes, setNotes]           = useState('')
  const [previewUri, setPreviewUri] = useState(null)
  const [previewCacheKey, setPreviewCacheKey] = useState(null)
  const [delivered, setDelivered]   = useState([])

  // Inline popover replacing the old Alert.alert action sheets for
  // "Период"/"Статус" — `openFilter` names which one is showing and
  // `popoverAnchor` is its measured screen position.
  const [openFilter, setOpenFilter] = useState(null) // null | 'period' | 'status'
  const [popoverAnchor, setPopoverAnchor] = useState({ top: 0, left: 0 })
  const periodChipRef = useRef(null)
  const statusChipRef = useRef(null)

  // Inline validation/result state for the handover sheet — replaces the
  // Alert.alert-based confirm/success/error flow with banners rendered in place.
  const [amountError, setAmountError] = useState(null)
  const [attachError, setAttachError] = useState(null)
  const [handoverError, setHandoverError] = useState(null)
  const [toast, setToast] = useState(null) // { type: 'ok'|'err', title, subtitle }
  const toastTimer = useRef(null)
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

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

  // useFocusEffect so the cash summary/history reflects a handover just
  // submitted or an order just delivered elsewhere — see deliveries.jsx for
  // the same fix and the reason it's needed.
  useFocusEffect(useCallback(() => { fetchData() }, []))

  // Tapping the upload zone opens the gallery directly (no camera/gallery action
  // sheet). The native gallery picker presents reliably over the open handover
  // <Modal> inside Expo Go.
  const pickGallery = async () => {
    if (attachments.length >= MAX_ATTACHMENTS) { Alert.alert('Максимум', `Можно добавить не более ${MAX_ATTACHMENTS} файлов`); return }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') { Alert.alert('Нет доступа', 'Разрешите доступ к галерее в настройках'); return }
    const remaining = MAX_ATTACHMENTS - attachments.length
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 0.8 })
    if (result.canceled || !result.assets?.length) return
    const resized = await Promise.all(result.assets.map(resizeForUpload))
    addAssets(resized)
  }

  const addAssets = useCallback((assets) => {
    setAttachError(null)
    setAttachments(prev => {
      const toAdd = assets.slice(0, MAX_ATTACHMENTS - prev.length).map(a => ({
        uri: a.uri, type: a.type === 'video' ? 'video/mp4' : (a.mimeType || 'image/jpeg'),
        name: a.fileName || `attachment_${Date.now()}.jpg`,
      }))
      return [...prev, ...toAdd]
    })
  }, [])

  const removeAttachment = (uri) => setAttachments(prev => prev.filter(a => a.uri !== uri))

  // Closing with entered data (amount, attachments, or a note) is a lossy
  // action — the sheet never persists a draft — so it needs a confirm step
  // instead of silently discarding whatever the courier just typed/attached.
  const closeHandoverSheet = () => {
    if (submitting) return
    const hasData = actualAmount.trim().length > 0 || attachments.length > 0 || notes.trim().length > 0
    const discard = () => {
      setShowHandover(false); setAttachments([]); setActualAmount(''); setNotes('')
      setAmountError(null); setAttachError(null); setHandoverError(null)
    }
    if (!hasData) { discard(); return }
    Alert.alert('Отменить сдачу?', 'Данные будут потеряны', [
      { text: 'Продолжить', style: 'cancel' },
      { text: 'Отменить сдачу', style: 'destructive', onPress: discard },
    ])
  }

  const showToast = (t) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(t)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  // No confirm/success/error Alert popups here — validation shows inline
  // under the relevant field, and the result shows as an inline banner
  // (in the sheet on failure, as a screen toast on success) instead.
  const handleHandover = async () => {
    setHandoverError(null)
    const amt = parseFloat(actualAmount)
    const amountBad = !amt || amt <= 0
    const attachmentsBad = attachments.length === 0
    setAmountError(amountBad ? 'Введите сумму перевода' : null)
    setAttachError(attachmentsBad ? 'Прикрепите скриншот перевода' : null)
    if (amountBad || attachmentsBad) return

    setSubmitting(true)
    try {
      // Each attachment uploads through the centralized media pipeline
      // only (category=cash_handover_proof, PRIVATE). This must never
      // fall back to the legacy /uploads endpoint — see
      // securePrivateUpload's doc comment in src/api/media.js. If the
      // pipeline is unavailable or rejects a file, the upload throws
      // and the catch below shows a clear error; nothing is sent
      // anywhere else.
      const results = await Promise.all(
        attachments.map(a => securePrivateUpload({ uri: a.uri, type: a.type, name: a.name }, 'cash_handover_proof'))
      )
      const mediaAssetIds = results.map(r => r.asset.id)
      await submitHandover({
        media_asset_ids: mediaAssetIds,
        actual_amount: amt,
        notes: notes || undefined,
      })
      setAttachments([]); setActualAmount(''); setNotes(''); setShowHandover(false)
      showToast({ type: 'ok', title: 'Отправлено на проверку', subtitle: `${fmt(amt)} TJS · диспетчер подтвердит` })
      fetchData()
    } catch (e) {
      const msg = e?.response?.status === 404
        ? 'Загрузка защищённых файлов временно недоступна. Обратитесь к администратору.'
        : (e?.response?.data?.error?.message || 'Проверьте соединение и попробуйте ещё раз')
      setHandoverError({ title: 'Не удалось отправить', subtitle: msg })
    } finally { setSubmitting(false) }
  }

  // Earnings = courier's fixed delivery fee per delivered order (independent of
  // handover status). Built from the courier's delivered orders.
  const fullUrl = (u) => (!u ? null : u.startsWith('http') ? u : `${API_URL}${u}`)
  // Prefer the legacy proof_url when present, else the first
  // centralized-media-pipeline proof (media_assets[].url — resolved fresh,
  // signed, by the backend on every read; see
  // internal/courier.Service.ToHandoverResponse).
  const handoverProofUrl = (h) => fullUrl(h.proof_url || h.media_assets?.[0]?.url)
  // The media-pipeline URL above carries a fresh signature on every fetch,
  // so it can't itself be a cache key — the asset's own id is stable across
  // fetches and app restarts, which is what CachedImage needs. Legacy
  // proof_url has no backing media asset (and is already a stable URL), so
  // there's nothing to key a local cache off of.
  const handoverProofCacheKey = (h) => (h.proof_url ? null : h.media_assets?.[0]?.id ?? null)
  const earnings = delivered.map(o => ({
    id: o.order_id ?? o.id,
    number: o.order_number ?? o.OrderNumber ?? '—',
    fee: Number(o.courier_payout ?? o.CourierPayout ?? o.delivery_fee ?? o.DeliveryFee ?? 0),
    date: o.delivered_at ?? o.assigned_at ?? o.created_at,
    address: o.customer_address ?? o.customer?.address,
  }))
  const toReturn  = Math.max(0, Number(summary?.cash_to_handover || 0))
  const salary    = Number(summary?.total_delivery_fees || 0)
  const collected = toReturn + salary
  const cashOrders = summary?.orders_collected || 0
  // Pending-review amount on the hero card is a real-time status, not tied
  // to the display filters below — it always reflects the full history.
  const pendingHandover = history.filter(h => h.status === 'pending').reduce((s, h) => s + (h.actual_returned ?? h.total_to_return ?? 0), 0)

  const PERIOD_OPTIONS = [
    { key: 'all',   label: 'Все' },
    { key: 'today', label: 'Сегодня' },
    { key: 'week',  label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
  ]
  const STATUS_OPTIONS = [
    { key: 'all',       label: 'Все' },
    { key: 'confirmed', label: 'Подтверждено' },
    { key: 'pending',   label: 'Ожидает' },
    { key: 'rejected',  label: 'Отклонено' },
  ]

  const withinPeriod = (dateStr) => {
    if (periodFilter === 'all' || !dateStr) return true
    const d = dayjs(dateStr)
    const now = dayjs()
    if (periodFilter === 'today' && !d.isSame(now, 'day')) return false
    if (periodFilter === 'week'  && d.isBefore(now.subtract(7,  'day'))) return false
    if (periodFilter === 'month' && d.isBefore(now.subtract(30, 'day'))) return false
    return true
  }

  const filteredHistory = history.filter(h => {
    if (statusFilter !== 'all' && h.status !== statusFilter) return false
    return withinPeriod(h.created_at)
  })
  const filteredEarnings = earnings.filter(e => withinPeriod(e.date))

  // The KPI totals mirror whatever the period/status chips below currently
  // select, so they always match the list the courier is looking at.
  const totalHandedOver = filteredHistory.reduce((s, h) => s + (h.actual_returned ?? h.total_to_return ?? 0), 0)
  const earningsTotal = filteredEarnings.reduce((sum, e) => sum + e.fee, 0)

  const POPOVER_WIDTH = 190
  const measureAndOpen = (ref, key) => {
    ref.current?.measure((x, y, width, height, pageX, pageY) => {
      const screenW = Dimensions.get('window').width
      setPopoverAnchor({
        top: pageY + height + 8,
        left: Math.max(16, Math.min(pageX, screenW - POPOVER_WIDTH - 16)),
      })
      setOpenFilter(key)
    })
  }
  const togglePeriodPopover = () => openFilter === 'period' ? setOpenFilter(null) : measureAndOpen(periodChipRef, 'period')
  const toggleStatusPopover = () => openFilter === 'status' ? setOpenFilter(null) : measureAndOpen(statusChipRef, 'status')
  const toggleQuickPeriod = (key) => { setOpenFilter(null); animateLayout(); setPeriodFilter(prev => prev === key ? 'all' : key) }

  const amtNum = parseFloat(actualAmount) || 0
  const diff = amtNum - toReturn
  const hasDiff = amtNum > 0

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData() }} tintColor={C.blue} />}
        contentContainerStyle={s.content}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={[s.headTitle, { color: T.ink }]}>Касса</Text>
            <Text style={[s.headSub, { color: T.muted }]}>{dayjs().format('dddd, D MMMM')}</Text>
          </View>
        </View>

        {/* Result banner — replaces the old "Отправлено!"/"Ошибка" Alert popups */}
        {toast && (
          <FadeSlideIn style={s.pageToast}>
            <View style={[s.toastBanner, toast.type === 'ok' ? s.toastOk : s.toastErr]}>
              <View style={[s.toastIcon, { backgroundColor: toast.type === 'ok' ? C.green : C.red }]}>
                <Text style={s.toastIconText}>{toast.type === 'ok' ? '✓' : '!'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.toastTitle, { color: toast.type === 'ok' ? '#1d8a48' : '#c02c22' }]}>{toast.title}</Text>
                {!!toast.subtitle && <Text style={[s.toastSubtitle, { color: toast.type === 'ok' ? '#1d8a48' : '#c02c22' }]}>{toast.subtitle}</Text>}
              </View>
            </View>
          </FadeSlideIn>
        )}

        {loading
          ? (
            <>
              <View style={s.cashHero}>
                <Skeleton width={170} height={13} />
                <Skeleton width={220} height={44} style={{ marginTop: 16 }} />
                <Skeleton height={52} radius={22} style={{ marginTop: 18 }} />
                <Skeleton height={56} radius={22} style={{ marginTop: 16 }} />
              </View>
              <View style={s.kpiRow}>
                <Skeleton height={96} radius={20} style={{ flex: 1 }} />
                <Skeleton height={96} radius={20} style={{ flex: 1 }} />
              </View>
            </>
          )
          : <>
            {/* Cash hero (white/orange card) */}
            <FadeSlideIn>
            <View style={[s.cashHero, { backgroundColor: T.card }]}>
              <Sheen radius={32} />
              <Text style={s.cashLabel}>нужно вернуть сегодня</Text>
              <CountUp value={toReturn} style={s.cashSum} suffix=" TJS" duration={900} />
              <View style={[s.formula, { backgroundColor: T.chip, borderColor: T.chipEdge }]}>
                <Text style={[s.formulaVal, { color: T.ink }]}>{fmt(collected)}</Text>
                <Text style={s.formulaMuted}>−</Text>
                <Text style={s.formulaGreen}>{fmt(salary)}</Text>
                <Text style={s.formulaMuted}>=</Text>
                <Text style={s.formulaOrange}>{fmt(toReturn)} TJS</Text>
              </View>
              <Text style={[s.caption, { color: T.muted }]}>Собранные наличные − Ваша зарплата</Text>
              {pendingHandover > 0 && (
                <View style={s.pendingRow}>
                  <Text style={s.pendingText}>На проверке у диспетчера</Text>
                  <Text style={s.pendingVal}>{fmt(pendingHandover)} TJS</Text>
                </View>
              )}
              <PressScale
                style={[s.submitBtn, toReturn === 0 && s.submitBtnDisabled]}
                scaleTo={0.96}
                onPress={() => {
                  if (toReturn === 0) return
                  setAmountError(null); setAttachError(null); setHandoverError(null)
                  setShowHandover(true)
                }}
              >
                <Text style={s.submitBtnText}>
                  {toReturn === 0 ? 'Касса сдана' : 'Сдать наличные'}
                </Text>
              </PressScale>
            </View>
            </FadeSlideIn>

            {/* KPI cards (act as tabs) */}
            <FadeSlideIn delay={80}>
            <View style={s.kpiRow}>
              <PressScale
                style={[s.kpiCard, { backgroundColor: T.chip, borderColor: T.chipEdge }, cashTab === 'handover' && s.kpiCardActive, cashTab === 'handover' && { backgroundColor: T.card }]}
                scaleTo={0.95}
                onPress={() => { setOpenFilter(null); animateLayout(); setCashTab('handover') }}
              >
                <Sheen radius={20} />
                <Text style={[s.kpiLabel, { color: T.muted }]}>Сдано наличных</Text>
                <CountUp value={totalHandedOver} style={[s.kpiValue, { color: T.ink }]} />
                <Text style={[s.kpiUnit, { color: T.muted }]}>TJS</Text>
              </PressScale>
              <PressScale
                style={[s.kpiCard, { backgroundColor: T.chip, borderColor: T.chipEdge }, cashTab === 'earnings' && s.kpiCardActive, cashTab === 'earnings' && { backgroundColor: T.card }]}
                scaleTo={0.95}
                onPress={() => { setOpenFilter(null); animateLayout(); setCashTab('earnings') }}
              >
                <Sheen radius={20} />
                <Text style={[s.kpiLabel, { color: T.muted }]}>Заработки</Text>
                <CountUp value={earningsTotal} style={[s.kpiValue, { color: T.ink }]} />
                <Text style={[s.kpiUnit, { color: T.muted }]}>TJS</Text>
              </PressScale>
            </View>
            </FadeSlideIn>

            {/* Filter chips — shared by both tabs (KPI totals above and the
                lists below both derive from these), so they stay visible
                regardless of which KPI card is selected. "Статус" only
                applies to handovers, so it's hidden on the earnings tab. */}
            <FadeSlideIn delay={140}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
                <PressScale
                  scaleTo={0.94}
                  style={[s.quickChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, periodFilter === 'today' && s.quickChipOn]}
                  onPress={() => toggleQuickPeriod('today')}
                >
                  <Text style={[s.quickChipText, { color: T.muted }, periodFilter === 'today' && s.quickChipTextOn]}>Сегодня</Text>
                </PressScale>
                <PressScale
                  scaleTo={0.94}
                  style={[s.quickChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, periodFilter === 'week' && s.quickChipOn]}
                  onPress={() => toggleQuickPeriod('week')}
                >
                  <Text style={[s.quickChipText, { color: T.muted }, periodFilter === 'week' && s.quickChipTextOn]}>Неделя</Text>
                </PressScale>
                <View ref={periodChipRef} collapsable={false}>
                  <PressScale
                    scaleTo={0.94}
                    style={[s.filterChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, (periodFilter === 'month' || openFilter === 'period') && s.filterChipActive]}
                    onPress={togglePeriodPopover}
                  >
                    <Text style={[s.filterChipText, { color: T.muted }, (periodFilter === 'month' || openFilter === 'period') && s.filterChipTextActive]}>
                      Период ⌄
                    </Text>
                  </PressScale>
                </View>
                {cashTab === 'handover' && (
                  <View ref={statusChipRef} collapsable={false}>
                    <PressScale
                      scaleTo={0.94}
                      style={[s.filterChip, { backgroundColor: T.chip, borderColor: T.chipEdge }, (statusFilter !== 'all' || openFilter === 'status') && s.filterChipActive]}
                      onPress={toggleStatusPopover}
                    >
                      <Text style={[s.filterChipText, { color: T.muted }, (statusFilter !== 'all' || openFilter === 'status') && s.filterChipTextActive]}>
                        Статус ⌄
                      </Text>
                    </PressScale>
                  </View>
                )}
              </ScrollView>
            </FadeSlideIn>

            {/* Handover tab */}
            {cashTab === 'handover' && (
              <FadeSlideIn delay={0} from={10}>
                <View style={[s.histCard, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
                  {filteredHistory.length === 0 && (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ color: T.muted, fontWeight: '600' }}>
                        {history.length === 0 ? 'Инкассаций пока нет' : 'Нет записей по фильтру'}
                      </Text>
                    </View>
                  )}
                  {filteredHistory.map((h, i) => {
                    const isConfirmed = h.status === 'confirmed'
                    const isPending   = h.status === 'pending'
                    const isRejected  = h.status === 'rejected'
                    const statusColor = isConfirmed ? C.green : isRejected ? C.red : C.orange
                    const sLabel = isConfirmed ? 'Подтверждено' : isPending ? 'Ожидает проверки' : isRejected ? 'Отклонено' : h.status
                    const amount = h.actual_returned ?? h.total_to_return ?? 0
                    const proof = handoverProofUrl(h)
                    const proofCacheKey = handoverProofCacheKey(h)
                    return (
                      <View key={h.id || i} style={[s.cashItem, { borderBottomColor: T.hairline }, i === filteredHistory.length - 1 && { borderBottomWidth: 0 }]}>
                        {proof
                          ? <TouchableOpacity activeOpacity={0.85} onPress={() => { setPreviewUri(proof); setPreviewCacheKey(proofCacheKey) }}>
                              <CachedImage uri={proof} cacheKey={proofCacheKey} style={s.receipt} />
                            </TouchableOpacity>
                          : <View style={[s.receipt, { backgroundColor: T.chip }]} />}
                        <View style={{ flex: 1 }}>
                          <Text style={[s.cashItemTime, { color: T.muted }]}>{h.created_at ? dayjs(h.created_at).format('HH:mm') : '—'}</Text>
                          <Text style={[s.cashItemTitle, { color: T.ink }]}>Сдано наличными</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.cashAmount}>{fmt(amount)} TJS</Text>
                          <Text style={{ fontSize: 11, marginTop: 4, color: statusColor, fontWeight: '700' }}>{sLabel}</Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              </FadeSlideIn>
            )}

            {/* Earnings tab */}
            {cashTab === 'earnings' && (
              <FadeSlideIn delay={0} from={10}>
              <View style={[s.histCard, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
                {filteredEarnings.length === 0 ? (
                  <View style={{ padding: 24, alignItems: 'center' }}>
                    <Text style={{ color: T.muted, fontWeight: '600' }}>
                      {earnings.length === 0 ? 'Пока нет доставленных заказов' : 'Нет записей по фильтру'}
                    </Text>
                  </View>
                ) : filteredEarnings.map((e, i) => (
                  <View key={e.id || i} style={[s.cashItem, { borderBottomColor: T.hairline }, i === filteredEarnings.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={s.earnIcon}><Text style={{ fontSize: 20 }}>💰</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.cashItemTitle, { color: T.ink }]}>Доставка {e.number}</Text>
                      <Text style={[s.cashItemTime, { color: T.muted }]}>{e.date ? dayjs(e.date).format('HH:mm') : '—'}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.cashAmount}>{fmt(e.fee)} TJS</Text>
                      <Text style={{ fontSize: 11, marginTop: 4, color: C.green, fontWeight: '700' }}>Получено</Text>
                    </View>
                  </View>
                ))}
              </View>
              </FadeSlideIn>
            )}
          </>
        }
      </ScrollView>

      {/* Handover bottom sheet */}
      <Modal visible={showHandover} animationType="slide" transparent statusBarTranslucent onRequestClose={closeHandoverSheet}>
        <Pressable style={s.overlay} onPress={closeHandoverSheet}>
          <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
            <GlassFill fill="#f0f4fc" />
            <Sheen radius={32} opacity={0.35} />
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
                  style={[s.amountInput, amountError && s.amountInputErr]}
                  placeholder="0"
                  placeholderTextColor={C.muted}
                  value={actualAmount}
                  onChangeText={(v) => { setActualAmount(v); if (amountError) setAmountError(null) }}
                  keyboardType="decimal-pad"
                />
                {amountError && <Text style={s.inlineErr}>⚠ {amountError}</Text>}
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
                    renderItem={({ item }) => <AttachmentItem item={item} onRemove={removeAttachment} onPreview={(uri) => { setPreviewUri(uri); setPreviewCacheKey(null) }} />}
                  />
                )}
                {attachments.length < MAX_ATTACHMENTS && (
                  <TouchableOpacity style={[s.uploadArea, attachError && s.uploadAreaErr]} onPress={pickGallery} activeOpacity={0.7}>
                    <Text style={s.uploadPlus}>＋</Text>
                    <Text style={s.uploadText}>Добавить подтверждение</Text>
                    <Text style={s.uploadSub}>Галерея</Text>
                  </TouchableOpacity>
                )}
                {attachError && <Text style={s.inlineErr}>⚠ {attachError}</Text>}
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

              {handoverError && (
                <View style={[s.toastBanner, s.toastErr]}>
                  <View style={[s.toastIcon, { backgroundColor: C.red }]}><Text style={s.toastIconText}>!</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.toastTitle, { color: '#c02c22' }]}>{handoverError.title}</Text>
                    <Text style={[s.toastSubtitle, { color: '#c02c22' }]}>{handoverError.subtitle}</Text>
                  </View>
                  <TouchableOpacity onPress={handleHandover}><Text style={s.toastRetry}>Повторить</Text></TouchableOpacity>
                </View>
              )}

              <TouchableOpacity style={[s.submitBigBtn, submitting && { opacity: 0.5 }]} onPress={handleHandover} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBigBtnText}>↑ Отправить на проверку</Text>}
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Inline filter popover — replaces the old Alert.alert action sheets for
          "Период"/"Статус". Positioned under the chip that opened it. */}
      <Modal visible={!!openFilter} transparent animationType="fade" onRequestClose={() => setOpenFilter(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenFilter(null)}>
          <Pressable
            style={[s.popover, { top: popoverAnchor.top, left: popoverAnchor.left, backgroundColor: T.card, borderColor: T.cardEdge }]}
            onPress={() => {}}
          >
            {(openFilter === 'period' ? PERIOD_OPTIONS : STATUS_OPTIONS).map(o => {
              const selected = (openFilter === 'period' ? periodFilter : statusFilter) === o.key
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[s.popItem, selected && { backgroundColor: T.chip }]}
                  onPress={() => {
                    if (openFilter === 'period') { animateLayout(); setPeriodFilter(o.key) }
                    else { animateLayout(); setStatusFilter(o.key) }
                    setOpenFilter(null)
                  }}
                >
                  <Text style={[s.popItemText, { color: T.ink }, selected && s.popItemTextSel]}>{o.label}</Text>
                  {selected && <Text style={s.popTick}>✓</Text>}
                </TouchableOpacity>
              )
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-screen image preview — works for both locally selected proofs and
          submitted handover photos from history. Tap anywhere or X to close. */}
      <Modal visible={!!previewUri} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { setPreviewUri(null); setPreviewCacheKey(null) }}>
        <Pressable style={s.previewOverlay} onPress={() => { setPreviewUri(null); setPreviewCacheKey(null) }}>
          <TouchableOpacity style={s.previewClose} onPress={() => { setPreviewUri(null); setPreviewCacheKey(null) }} hitSlop={12}>
            <Text style={s.previewCloseText}>✕</Text>
          </TouchableOpacity>
          {previewUri && (
            <CachedImage uri={previewUri} cacheKey={previewCacheKey} style={s.previewImage} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 130 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  headTitle: { fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  headSub: { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 6 },
  // Cash hero
  cashHero: { marginHorizontal: 18, backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(255,149,0,0.30)', borderRadius: 32, padding: 24, marginBottom: 16, shadowColor: C.orange, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.08, shadowRadius: 34, elevation: 3, overflow: 'hidden' },
  cashLabel: { fontSize: 13, color: '#c47c00', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  cashSum: { fontSize: 52, fontWeight: '700', letterSpacing: -2, color: C.orange, marginTop: 14, marginBottom: 16, lineHeight: 58 },
  formula: { backgroundColor: '#eef1f6', borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)', borderRadius: 22, padding: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  formulaVal: { fontSize: 18, fontWeight: '700', color: C.ink },
  formulaMuted: { fontSize: 18, fontWeight: '700', color: C.muted },
  formulaGreen: { fontSize: 18, fontWeight: '700', color: C.green },
  formulaOrange: { fontSize: 18, fontWeight: '700', color: C.orange },
  caption: { textAlign: 'center', color: C.muted, fontWeight: '700', marginTop: 12, fontSize: 13 },
  pendingRow: { marginTop: 14, paddingVertical: 14, paddingHorizontal: 15, borderRadius: 20, backgroundColor: 'rgba(255,149,0,0.14)', borderWidth: 1, borderColor: 'rgba(255,149,0,0.26)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingText: { color: '#b87500', fontWeight: '700', fontSize: 13 },
  pendingVal: { color: '#b87500', fontWeight: '700', fontSize: 14 },
  submitBtn: { width: '100%', marginTop: 16, borderRadius: 999, paddingVertical: 18, backgroundColor: C.blue, alignItems: 'center', shadowColor: C.blue, shadowOffset: { width: 0, height: 13 }, shadowOpacity: 0.25, shadowRadius: 26, elevation: 4 },
  submitBtnDisabled: { backgroundColor: 'rgba(140,152,172,0.55)', shadowOpacity: 0 },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  // KPI cards (tab switcher)
  kpiRow:        { flexDirection: 'row', marginHorizontal: 18, gap: 12, marginBottom: 16 },
  kpiCard:       { flex: 1, backgroundColor: '#eef1f6', borderRadius: 20, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.62)', padding: 16 },
  kpiCardActive: { backgroundColor: '#ffffff', borderColor: C.blue, shadowColor: C.blue, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12, elevation: 3 },
  kpiLabel:      { fontSize: 12, color: C.muted, fontWeight: '600', marginBottom: 6 },
  kpiValue:      { fontSize: 28, fontWeight: '700', color: C.ink, letterSpacing: -1 },
  kpiUnit:       { fontSize: 12, color: C.muted, fontWeight: '700', marginTop: 2 },
  // Filter chips — scrollable row: quick-toggle pills + two chips that open
  // the inline popover below (see `popover` styles further down).
  filterRow:          { marginBottom: 14 },
  filterRowContent:   { flexDirection: 'row', paddingHorizontal: 18, gap: 10, alignItems: 'center' },
  quickChip:          { height: 36, justifyContent: 'center', backgroundColor: '#eef1f6', borderRadius: 999, paddingHorizontal: 15, borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)' },
  quickChipOn:        { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  quickChipText:      { fontSize: 13, fontWeight: '700', color: C.muted },
  quickChipTextOn:    { color: '#fff' },
  filterChip:         { height: 36, justifyContent: 'center', backgroundColor: '#eef1f6', borderRadius: 999, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)' },
  filterChipActive:   { backgroundColor: 'rgba(10,132,255,0.14)', borderColor: C.blue },
  filterChipText:     { fontSize: 13, fontWeight: '600', color: C.muted },
  filterChipTextActive: { color: C.blue },
  // Inline dropdown popover — replaces the old Alert.alert action sheet,
  // positioned under whichever chip opened it (see `measureAndOpen`).
  popover: {
    position: 'absolute', width: 190, borderRadius: 16, borderWidth: 1, padding: 6,
    shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.2, shadowRadius: 30, elevation: 10,
  },
  popItem:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10 },
  popItemText:    { fontSize: 13.5, fontWeight: '600' },
  popItemTextSel: { color: C.blue, fontWeight: '700' },
  popTick:        { color: C.blue, fontWeight: '900' },
  // Result banners — replace the old success/error/validation Alert popups
  pageToast:      { marginHorizontal: 18, marginBottom: 14 },
  toastBanner:    { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, padding: 14 },
  toastOk:        { backgroundColor: '#e8f8f0' },
  toastErr:       { backgroundColor: '#fdecec', marginTop: 14 },
  toastIcon:      { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  toastIconText:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  toastTitle:     { fontSize: 13.5, fontWeight: '700' },
  toastSubtitle:  { fontSize: 12, fontWeight: '600', marginTop: 2, opacity: 0.85 },
  toastRetry:     { color: C.red, fontWeight: '800', fontSize: 13 },
  inlineErr:      { color: C.red, fontWeight: '700', fontSize: 12, marginTop: 8 },
  histCard: { marginHorizontal: 18, backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(255,255,255,0.68)', borderRadius: 28, overflow: 'hidden', shadowColor: '#0f1f37', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 18, elevation: 2 },
  cashItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  receipt: { width: 50, height: 62, borderRadius: 10, backgroundColor: '#f8f8f8' },
  cashItemTime: { fontSize: 12, color: C.muted, fontWeight: '600', marginBottom: 6 },
  cashItemTitle: { fontSize: 14, fontWeight: '700', color: C.ink },
  cashAmount: { fontSize: 16, fontWeight: '700', color: C.orange },
  // Sheet
  overlay: { flex: 1, backgroundColor: 'rgba(9,17,32,0.38)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: 'transparent', borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '92%', overflow: 'hidden', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  sheetHandle: { width: 74, height: 6, borderRadius: 99, backgroundColor: '#d9deea', alignSelf: 'center', marginTop: 14 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40, gap: 16 },
  sheetTitle: { fontSize: 28, fontWeight: '700', color: C.ink },
  sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#eef1f6', borderWidth: 1, borderColor: 'rgba(255,255,255,0.62)', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 15 },
  sheetRowLabel: { color: C.muted, fontWeight: '600', fontSize: 14 },
  sheetRowVal: { fontSize: 22, fontWeight: '700', color: C.orange },
  field: {},
  fieldLabel: { fontSize: 14, color: C.muted, fontWeight: '700', marginBottom: 10 },
  amountInput: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.62)', backgroundColor: '#eef1f6', borderRadius: 22, paddingVertical: 18, fontSize: 28, fontWeight: '700', textAlign: 'center', color: C.ink },
  amountInputErr: { borderColor: C.red },
  diffRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
  diffLabel: { fontSize: 13, fontWeight: '700', color: C.muted },
  diffVal: { fontSize: 15, fontWeight: '700' },
  uploadArea: { borderWidth: 1.5, borderColor: 'rgba(120,144,180,0.40)', borderStyle: 'dashed', borderRadius: 22, paddingVertical: 24, alignItems: 'center', backgroundColor: '#eef1f6' },
  uploadAreaErr: { borderColor: C.red },
  uploadPlus: { fontSize: 34, fontWeight: '700', color: C.ink, marginBottom: 8 },
  uploadText: { fontSize: 16, fontWeight: '700', color: C.muted },
  uploadSub: { fontSize: 12, color: C.muted, marginTop: 4 },
  textarea: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.62)', backgroundColor: '#eef1f6', borderRadius: 22, padding: 18, fontSize: 15, fontWeight: '700', color: C.ink, minHeight: 88, textAlignVertical: 'top' },
  submitBigBtn: { backgroundColor: C.blue, borderRadius: 999, paddingVertical: 18, alignItems: 'center', shadowColor: C.blue, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.25, shadowRadius: 28, elevation: 4 },
  submitBigBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  // Earnings
  earnIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(52,199,89,0.16)', justifyContent: 'center', alignItems: 'center' },
  // Image preview
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  previewImage: { width: '92%', height: '80%' },
  previewClose: { position: 'absolute', top: 52, right: 22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  previewCloseText: { color: '#fff', fontSize: 20, fontWeight: '700' },
})
