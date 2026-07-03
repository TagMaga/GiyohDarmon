import { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable,
  Alert, ActivityIndicator, Modal, Image,
  Animated, Dimensions, Linking, TextInput,
} from 'react-native'
import { PanGestureHandler, State } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Phone, MessageCircle, Send, MapPin } from 'lucide-react-native'
import { GlassFill, Sheen } from './glass'
import { updateOrderStatus, reportAddressChanged, deferOrder, getOrderComments, addOrderComment } from '../api/orders'
import useAuthStore from '../store/authStore'
import { resolveCreator } from '../lib/creator'
import Avatar from './Avatar'

const { height: SCREEN_H } = Dimensions.get('window')
export const SHEET_H = SCREEN_H * 0.90
const DRAG_CLOSE_THRESHOLD = 120
const DRAG_CLOSE_VELOCITY = 1
const HANDLE_COLLAPSED_RATIO = 0.34
const HANDLE_MAX_COLLAPSE = 260

// Apple Liquid Glass palette: iOS system accents, translucent card surfaces.
// Sheets get their surface from GlassFill; C.bg is the opaque screen base.
export const C = {
  bg: '#eef2fa', card: 'rgba(255,255,255,0.66)', ink: '#0a1528', muted: '#5f6e88', line: 'rgba(120,144,180,0.30)',
  blue: '#0a84ff', violet: '#5e5ce6', green: '#34c759', orange: '#ff9500', red: '#ff3b30',
  tag: 'rgba(10,132,255,0.10)',
}

export const STATUS_LABEL = {
  new: 'Новый', confirmed: 'Подтверждён', assigned: 'Назначен', in_delivery: 'В пути',
  delivered: 'Доставлен', returned: 'Возврат', issue: 'Проблема', cancelled: 'Отменён',
}
export const STATUS_COLOR = {
  new: '#8a93a3', confirmed: C.blue, assigned: C.violet, in_delivery: C.orange,
  delivered: C.green, returned: C.red, issue: C.red, cancelled: C.red,
}

const PROBLEM_OPTIONS = [
  { key: 'later',   label: 'Доставить позже',     icon: '🕐', desc: 'Перенести доставку' },
  { key: 'address', label: 'Клиент сменил адрес', icon: '📍', desc: 'Снять назначение курьера' },
  { key: 'cancel',  label: 'Отмена заказа',       icon: '✕',  desc: 'Отменить заказ' },
]
const CANCEL_REASONS = ['Клиент не отвечает', 'Клиент отказался', 'Неверный адрес', 'Товар повреждён', 'Другое']
const DEFER_OPTIONS = [
  { key: 'd1', label: 'Завтра',       days: 1 },
  { key: 'd2', label: '+2 дня',       days: 2 },
  { key: 'd3', label: '+3 дня',       days: 3 },
  { key: 'd7', label: 'Через неделю', days: 7 },
]
const ROLE_LABEL = {
  seller: 'Продавец',
  manager: 'Менеджер',
  sales_team_lead: 'Тимлид',
  dispatcher: 'Диспетчер',
  owner: 'Владелец',
  courier: 'Курьер',
}

function addDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d
}

// ── Bottom sheet wrapper ────────────────────────────────────────────────────

export function BottomSheet({ visible, onClose, children, height = SHEET_H }) {
  const insets    = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(height)).current
  const gestureY   = useRef(new Animated.Value(0)).current
  const dimOpacity = useRef(new Animated.Value(0)).current
  const isOpen     = useRef(false)
  const currentSnap = useRef(0)
  const isClosing   = useRef(false)
  const previousHeight = useRef(height)
  const collapsedSnap = Math.min(height * HANDLE_COLLAPSED_RATIO, HANDLE_MAX_COLLAPSE)
  const closeSnap = height + insets.bottom + 32

  const animatedTranslateY = Animated.add(translateY, gestureY).interpolate({
    inputRange: [-height, 0, closeSnap],
    outputRange: [0, 0, closeSnap],
    extrapolate: 'clamp',
  })

  const snapTo = (toValue, after) => {
    gestureY.setValue(0)
    currentSnap.current = toValue
    Animated.spring(translateY, {
      toValue,
      useNativeDriver: true,
      damping: 24,
      stiffness: 230,
      mass: 0.85,
    }).start(({ finished }) => {
      if (finished) after?.()
    })
  }

  const closeWithAnimation = () => {
    if (isClosing.current) return
    isClosing.current = true
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: closeSnap,
        useNativeDriver: true,
        damping: 28,
        stiffness: 260,
        mass: 0.85,
      }),
      Animated.timing(dimOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
    ]).start(() => onClose())
  }

  useEffect(() => {
    const heightChanged = previousHeight.current !== height

    if (visible && !isOpen.current) {
      isOpen.current = true
      isClosing.current = false
      currentSnap.current = 0
      gestureY.setValue(0)
      translateY.setValue(height)
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }),
        Animated.timing(dimOpacity,  { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
    } else if (visible && isOpen.current && heightChanged && !isClosing.current) {
      currentSnap.current = 0
      gestureY.setValue(0)
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 24,
        stiffness: 230,
        mass: 0.85,
      }).start()
    } else if (!visible && isOpen.current) {
      isOpen.current = false
      Animated.parallel([
        Animated.spring(translateY, { toValue: height, useNativeDriver: true, damping: 25, stiffness: 250 }),
        Animated.timing(dimOpacity,  { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start()
    }

    previousHeight.current = height
  }, [visible, height])

  const handleGesture = Animated.event(
    [{ nativeEvent: { translationY: gestureY } }],
    { useNativeDriver: true }
  )

  const handleGestureState = ({ nativeEvent }) => {
    if (nativeEvent.oldState !== State.ACTIVE) return

    const projected = currentSnap.current + nativeEvent.translationY + nativeEvent.velocityY * 80
    const isFastClose = nativeEvent.velocityY > DRAG_CLOSE_VELOCITY && nativeEvent.translationY > 12
    const isPastClose = projected > collapsedSnap + DRAG_CLOSE_THRESHOLD

    if (isFastClose || isPastClose) {
      closeWithAnimation()
      return
    }

    const nextSnap = projected > collapsedSnap / 2 ? collapsedSnap : 0
    snapTo(nextSnap)
  }

  if (!visible) return null

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={closeWithAnimation}>
      <Animated.View style={[bs.backdrop, { opacity: dimOpacity }]}>
        {/* Frost the screen behind the sheet instead of a heavy dim */}
        <GlassFill intensity={16} overlay="rgba(9,17,32,0.30)" androidFallback="rgba(9,17,32,0.42)" />
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeWithAnimation} />
      </Animated.View>
      <Animated.View style={[bs.sheet, { height, paddingBottom: insets.bottom, transform: [{ translateY: animatedTranslateY }] }]}>
        <GlassFill intensity={64} overlay="rgba(242,246,252,0.40)" androidFallback="rgba(240,244,252,0.94)" />
        <Sheen radius={28} opacity={0.35} />
        <PanGestureHandler
          activeOffsetY={[-8, 8]}
          failOffsetX={[-24, 24]}
          onGestureEvent={handleGesture}
          onHandlerStateChange={handleGestureState}
        >
          <Animated.View style={bs.handleArea}>
            <View style={bs.handle} />
          </Animated.View>
        </PanGestureHandler>
        {children}
      </Animated.View>
    </Modal>
  )
}

// ── Order detail sheet ──────────────────────────────────────────────────────

export function OrderDetailSheet({
  order, onClose, onStart, onDelivered, actionLoading, onRefresh, initialStep = 'detail',
}) {
  const [step, setStep]               = useState(initialStep)
  const [cancelReason, setCancelReason] = useState('')
  const [laterDate, setLaterDate]     = useState(null)
  const [newAddress, setNewAddress]   = useState('')
  const [stepLoading, setStepLoading] = useState(false)
  const [comments, setComments]       = useState([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSending, setCommentSending] = useState(false)
  const [expandedComments, setExpandedComments] = useState({})
  const currentUserName = useAuthStore((st) => st.user?.full_name) || ''

  useEffect(() => {
    if (order) {
      setStep(initialStep)
      setCancelReason('')
      setLaterDate(null)
      setNewAddress('')
      setCommentText('')
      setExpandedComments({})
    }
  }, [order?.id])

  const loadComments = async () => {
    if (!order?.id) return
    setCommentsLoading(true)
    try {
      const { data } = await getOrderComments(order.id)
      const body = data?.data ?? data
      setComments(Array.isArray(body) ? body : [])
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  useEffect(() => {
    if (order?.id) loadComments()
  }, [order?.id])

  const resetStep  = () => { setStep('detail'); setCancelReason(''); setLaterDate(null); setNewAddress('') }
  const handleClose = () => { resetStep(); onClose() }

  if (!order) return null

  const creator     = resolveCreator(order, currentUserName)
  const status      = order.status
  const fmt         = (n) => Number(n || 0).toLocaleString()
  const statusColor = STATUS_COLOR[status] || C.muted

  // Payment fields
  const productTotal  = Number(order.product_total ?? order.total_amount ?? order.subtotal ?? 0)
  const deliveryFee   = Number(order.delivery_fee ?? 0)
  const prepayAmt     = Number(order.prepayment_amount ?? 0)
  const collectAmt    = Number(order.amount_to_collect ?? order.courier_collect_amount ?? 0)
  const hasPrepay     = prepayAmt > 0
  const prepayStatus  = order.prepayment_status
  const prepayLabel   = order.prepayment_type === 'full' ? 'Полная предоплата' : 'Частичная предоплата'

  const clientComment = order.notes || order.comment || order.customer_comment || ''

  const sellerName   = order.seller?.full_name || order.seller_name || null
  const sellerPhone  = order.seller?.phone || order.seller_phone || null
  const sellerAvatar = order.seller?.avatar_url || order.seller_avatar_url || null

  // Merged creator display — prefer enriched seller data when available
  const creatorName      = sellerName || creator.name
  const creatorPhone     = sellerPhone || creator.phone
  const creatorAvatarUrl = sellerAvatar || creator.avatarUrl
  const showCreator      = sellerName || creator.hasCreator

  const callPhone = () => {
    const phone = order.customer?.phone
    if (!phone) return
    Linking.openURL(`tel:${phone}`)
  }
  const openWhatsApp = () => {
    if (order.customer?.phone) Linking.openURL(`https://wa.me/${order.customer.phone.replace(/\D/g, '')}`)
  }
  const openTelegram = () => {
    if (!order.customer?.phone) return
    const phone = order.customer.phone.replace(/\D/g, '')
    Linking.openURL(`https://t.me/+${phone}`).catch(() =>
      Alert.alert('Telegram не установлен', 'Установите приложение Telegram')
    )
  }
  const callCreatorPhone = () => creatorPhone && Linking.openURL(`tel:${creatorPhone}`)

  const doStatus = async (st, comment) => {
    setStepLoading(true)
    try {
      await updateOrderStatus(order.id, st, comment ? { comment } : undefined)
      handleClose(); onRefresh?.()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Что-то пошло не так')
    } finally { setStepLoading(false) }
  }

  const doAddressChanged = async () => {
    setStepLoading(true)
    try {
      await reportAddressChanged(order.id, newAddress.trim())
      handleClose(); onRefresh?.()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Что-то пошло не так')
    } finally { setStepLoading(false) }
  }

  const doDefer = async () => {
    const opt = DEFER_OPTIONS.find(o => o.key === laterDate)
    if (!opt) return
    const date = addDays(opt.days); date.setHours(0, 0, 0, 0)
    setStepLoading(true)
    try {
      await deferOrder(order.id, date.toISOString())
      handleClose(); onRefresh?.()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Что-то пошло не так')
    } finally { setStepLoading(false) }
  }

  const sendComment = async () => {
    const value = commentText.trim()
    if (!value || commentSending) return
    setCommentSending(true)
    try {
      await addOrderComment(order.id, value)
      setCommentText('')
      await loadComments()
    } catch (e) {
      Alert.alert('Ошибка', e?.response?.data?.error?.message || 'Не удалось добавить комментарий')
    } finally {
      setCommentSending(false)
    }
  }

  const toggleComment = (id) =>
    setExpandedComments(prev => ({ ...prev, [id]: !prev[id] }))

  const sheetHeight = step === 'detail' ? SHEET_H : SCREEN_H * 0.65

  return (
    <BottomSheet visible={!!order} onClose={handleClose} height={sheetHeight}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={d.header}>
        <View style={{ flex: 1 }}>
          <Text style={d.orderNum}>{order.order_number}</Text>
        </View>
        <View style={[d.statusChip, { backgroundColor: `${statusColor}18` }]}>
          <Text style={[d.statusChipText, { color: statusColor }]}>{STATUS_LABEL[status] || status}</Text>
        </View>
        <TouchableOpacity style={d.closeBtn} onPress={handleClose}>
          <Text style={d.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={d.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Sub-flows ──────────────────────────────────────────── */}
        {step !== 'detail' && (
          <View>
            {step === 'menu' && PROBLEM_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.key} style={ps.optRow} onPress={() => setStep(opt.key)}>
                <View style={ps.optIcon}><Text style={{ fontSize: 22 }}>{opt.icon}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={ps.optLabel}>{opt.label}</Text>
                  <Text style={ps.optDesc}>{opt.desc}</Text>
                </View>
                <Text style={ps.chevron}>›</Text>
              </TouchableOpacity>
            ))}

            {step === 'later' && (<>
              <Text style={ps.stepTitle}>Доставить позже</Text>
              <Text style={ps.stepSub}>Выберите дату. Заказ вернётся в очередь.</Text>
              {DEFER_OPTIONS.map(opt => {
                const dd = addDays(opt.days)
                const dateLabel = dd.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
                return (
                  <TouchableOpacity key={opt.key} style={[ps.reasonRow, laterDate === opt.key && ps.reasonRowActive]} onPress={() => setLaterDate(opt.key)}>
                    <View style={[ps.radio, laterDate === opt.key && ps.radioActive]} />
                    <Text style={[ps.reasonText, laterDate === opt.key && { color: C.ink, fontWeight: '600' }]}>
                      {opt.label} · {dateLabel}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity style={[ps.btnPrimary, (!laterDate || stepLoading) && ps.btnDisabled]} disabled={!laterDate || stepLoading} onPress={doDefer}>
                {stepLoading ? <ActivityIndicator color="#fff" /> : <Text style={ps.btnText}>Подтвердить</Text>}
              </TouchableOpacity>
            </>)}

            {step === 'address' && (<>
              <Text style={ps.stepTitle}>Клиент сменил адрес</Text>
              <Text style={ps.stepSub}>Введите новый адрес. Заказ вернётся в очередь — диспетчер назначит курьера повторно.</Text>
              <TextInput
                style={ps.input} placeholder="Новый адрес клиента" placeholderTextColor={C.muted}
                value={newAddress} onChangeText={setNewAddress} multiline
              />
              <TouchableOpacity style={[ps.btnPrimary, (!newAddress.trim() || stepLoading) && ps.btnDisabled]} disabled={!newAddress.trim() || stepLoading} onPress={doAddressChanged}>
                {stepLoading ? <ActivityIndicator color="#fff" /> : <Text style={ps.btnText}>Снять назначение</Text>}
              </TouchableOpacity>
            </>)}

{step === 'cancel' && (<>
              <Text style={ps.stepTitle}>Отмена заказа</Text>
              <Text style={ps.stepSub}>Выберите причину</Text>
              {CANCEL_REASONS.map(r => (
                <TouchableOpacity key={r} style={[ps.reasonRow, cancelReason === r && ps.reasonRowActive]} onPress={() => setCancelReason(r)}>
                  <View style={[ps.radio, cancelReason === r && ps.radioActive]} />
                  <Text style={[ps.reasonText, cancelReason === r && { color: C.ink, fontWeight: '600' }]}>{r}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[ps.btnPrimary, { backgroundColor: C.red }, (!cancelReason || stepLoading) && ps.btnDisabled]} disabled={!cancelReason || stepLoading} onPress={() => doStatus('returned', cancelReason)}>
                {stepLoading ? <ActivityIndicator color="#fff" /> : <Text style={ps.btnText}>Отменить заказ</Text>}
              </TouchableOpacity>
            </>)}

          </View>
        )}

        {/* ── Main detail view ────────────────────────────────────── */}
        {step === 'detail' && (<>

          {/* 1. CLIENT ───────────────────────────────────────────── */}
          <SectionCard label="Клиент">
            <View style={d.clientRow}>
              <View style={d.avatar}>
                <Text style={d.avatarInitial}>
                  {(order.customer?.full_name || '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={d.clientName}>{order.customer?.full_name || '—'}</Text>
                {order.customer?.phone
                  ? <Text style={d.clientPhone}>{order.customer.phone}</Text>
                  : null}
              </View>
            </View>

            {(order.customer?.address || order.customer?.city || order.delivery_address) && (
              <View style={d.infoRow}>
                <MapPin size={14} color={C.muted} style={{ marginTop: 1 }} />
                <Text style={d.infoText}>
                  {order.delivery_address || [order.customer.address, order.customer.city].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}

            {!!clientComment && (
              <View style={d.commentBox}>
                <Text style={d.commentLabel}>Комментарий</Text>
                <Text style={d.commentText}>{clientComment}</Text>
              </View>
            )}

            <View style={d.contactRow}>
              <TouchableOpacity style={[d.contactBtn, d.contactBtnCall]} onPress={callPhone}>
                <Phone size={20} color={C.blue} strokeWidth={2.5} />
                <Text style={[d.contactLabel, { color: C.blue }]}>Звонок</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[d.contactBtn, d.contactBtnWa]} onPress={openWhatsApp}>
                <MessageCircle size={20} color="#25D366" strokeWidth={2.5} />
                <Text style={[d.contactLabel, { color: '#25D366' }]}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[d.contactBtn, d.contactBtnTg]} onPress={openTelegram}>
                <Send size={20} color="#229ED9" strokeWidth={2.5} />
                <Text style={[d.contactLabel, { color: '#229ED9' }]}>Telegram</Text>
              </TouchableOpacity>
            </View>
          </SectionCard>

          {/* 2. PRODUCTS ─────────────────────────────────────────── */}
          {Array.isArray(order.items) && order.items.length > 0 && (
            <SectionCard label={`Товары · ${order.items.length} шт`}>
              {order.items.map((item, i) => (
                <View
                  key={item.product_id ?? item.id ?? i}
                  style={[d.productRow, i === order.items.length - 1 && { borderBottomWidth: 0 }]}
                >
                  {item.product_image_url
                    ? <Image source={{ uri: item.product_image_url }} style={d.productThumb} />
                    : <View style={d.productThumbPlaceholder}>
                        <Text style={d.productThumbInitial}>
                          {(item.product_name || item.name || '?')[0].toUpperCase()}
                        </Text>
                      </View>
                  }
                  <View style={{ flex: 1 }}>
                    <Text style={d.productName}>{item.product_name || item.name || 'Товар'}</Text>
                    <Text style={d.productQty}>{item.quantity} шт</Text>
                  </View>
                  <Text style={d.productPrice}>{fmt(item.total_price ?? item.price)} сом</Text>
                </View>
              ))}
            </SectionCard>
          )}

          {/* 3. PAYMENT ─────────────────────────────────────────── */}
          <SectionCard label="Оплата">
            <PayRow label="Стоимость товаров" value={`${fmt(productTotal)} сом`} />
            <PayRow
              label={`Доставка${order.delivery_method === 'express' ? ' (экспресс)' : ''}`}
              value={deliveryFee > 0 ? `${fmt(deliveryFee)} сом` : 'Бесплатно'}
              valueColor={deliveryFee === 0 ? C.green : undefined}
            />
            {hasPrepay && (
              <PayRow label={prepayLabel} value={`−${fmt(prepayAmt)} сом`} valueColor={C.green} />
            )}
            <View style={d.collectRow}>
              <Text style={d.collectLabel}>К получению</Text>
              {collectAmt > 0
                ? <Text style={d.collectVal}>{fmt(collectAmt)} сом</Text>
                : <Text style={[d.collectVal, { color: C.green, fontSize: 16 }]}>✓ Оплачено</Text>
              }
            </View>
            {hasPrepay && (
              <View style={d.prepayRow}>
                {prepayStatus === 'verified' && (
                  <View style={[d.prepayPill, { backgroundColor: `${C.green}18` }]}>
                    <Text style={[d.prepayPillText, { color: C.green }]}>✓ Предоплата подтверждена</Text>
                  </View>
                )}
                {prepayStatus === 'pending_verification' && (
                  <View style={[d.prepayPill, { backgroundColor: `${C.orange}18` }]}>
                    <Text style={[d.prepayPillText, { color: C.orange }]}>⏳ Ожидает подтверждения</Text>
                  </View>
                )}
                {prepayStatus === 'rejected' && (
                  <View style={[d.prepayPill, { backgroundColor: `${C.red}18` }]}>
                    <Text style={[d.prepayPillText, { color: C.red }]}>✕ Предоплата отклонена</Text>
                  </View>
                )}
              </View>
            )}
          </SectionCard>

          {/* 4. CREATOR / SELLER (merged) ───────────────────────── */}
          {showCreator && (
            <SectionCard label="Создал заказ">
              <View style={d.personRow}>
                <View style={d.personAvatarRing}>
                  <Avatar uri={creatorAvatarUrl} name={creatorName} size={40} radius={11} color="#eef3ff" textColor={C.violet} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={d.personName}>{creatorName}</Text>
                  {creatorPhone
                    ? <Pressable onPress={callCreatorPhone} hitSlop={6}>
                        {({ pressed }) => (
                          <Text style={[d.personPhone, pressed && { opacity: 0.6 }]}>
                            {creatorPhone}
                          </Text>
                        )}
                      </Pressable>
                    : <Text style={d.personPhoneMuted}>Телефон не указан</Text>
                  }
                </View>
                {sellerName
                  ? <View style={d.rolePill}><Text style={d.rolePillText}>Продавец</Text></View>
                  : creator.isOwn
                    ? <View style={[d.rolePill, { backgroundColor: `${C.green}18` }]}>
                        <Text style={[d.rolePillText, { color: C.green }]}>Мой заказ</Text>
                      </View>
                    : creator.roleLabel
                      ? <View style={[d.rolePill, { backgroundColor: `${creator.roleColor}18` }]}>
                          <Text style={[d.rolePillText, { color: creator.roleColor }]}>{creator.roleLabel}</Text>
                        </View>
                      : null
                }
              </View>
            </SectionCard>
          )}

          {/* 5. COMMENTS ────────────────────────────────────────── */}
          <SectionCard label="Комментарии">
            {commentsLoading && (
              <View style={d.commentsLoading}>
                <ActivityIndicator color={C.violet} />
                <Text style={d.commentsLoadingText}>Загрузка комментариев…</Text>
              </View>
            )}
            {!commentsLoading && comments.length === 0 && (
              <Text style={d.emptyComments}>Комментариев пока нет</Text>
            )}
            {!commentsLoading && comments.map((c, i) => {
              const bodyText = c.comment || c.text || ''
              const isLong = bodyText.length > 120
              const isExpanded = !!expandedComments[c.id ?? i]
              return (
                <View key={c.id ?? i} style={d.commentThreadItem}>
                  <View style={d.commentThreadHeader}>
                    <Text style={d.commentAuthor}>{c.author_name || '—'}</Text>
                    <View style={d.commentRoleBadge}>
                      <Text style={d.commentRoleText}>{ROLE_LABEL[c.author_role] || c.author_role || 'Роль'}</Text>
                    </View>
                  </View>
                  <Text style={d.commentBody} numberOfLines={isExpanded ? undefined : 3}>
                    {bodyText}
                  </Text>
                  {isLong && (
                    <TouchableOpacity onPress={() => toggleComment(c.id ?? i)} hitSlop={6}>
                      <Text style={d.showMoreText}>{isExpanded ? 'Скрыть' : 'Показать больше'}</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={d.commentTime}>
                    {c.created_at ? new Date(c.created_at).toLocaleString('ru-RU') : ''}
                  </Text>
                </View>
              )
            })}
            <View style={d.commentInputRow}>
              <TextInput
                style={d.commentInput}
                placeholder="Написать комментарий…"
                placeholderTextColor={C.muted}
                value={commentText}
                onChangeText={setCommentText}
                multiline
              />
              <TouchableOpacity
                style={[d.commentSendBtn, (!commentText.trim() || commentSending) && d.btnDisabled]}
                disabled={!commentText.trim() || commentSending}
                onPress={sendComment}
              >
                {commentSending
                  ? <ActivityIndicator color="#fff" />
                  : <Send size={18} color="#fff" strokeWidth={2.5} />
                }
              </TouchableOpacity>
            </View>
          </SectionCard>

          {/* ISSUE REASON ─────────────────────────────────────────── */}
          {status === 'issue' && (order.issue_comment || order.notes) && (
            <View style={d.issueBox}>
              <Text style={d.issueLabel}>⚠ Причина проблемы</Text>
              <Text style={d.issueText}>{order.issue_comment || order.notes}</Text>
            </View>
          )}

        </>)}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── Action bar ────────────────────────────────────────────── */}
      <View style={d.actionBar}>
        {step === 'detail' && status === 'assigned' && (<>
          <TouchableOpacity
            style={[d.primaryBtn, { backgroundColor: C.blue }, actionLoading && d.btnDisabled]}
            onPress={() => onStart?.(order)} disabled={actionLoading}
          >
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={d.primaryBtnText}>▶ В путь</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={d.secondaryBtn} onPress={() => setStep('menu')}>
            <Text style={d.secondaryBtnText}>Проблема / Изменить</Text>
          </TouchableOpacity>
        </>)}

        {step === 'detail' && status === 'in_delivery' && (<>
          <TouchableOpacity
            style={[d.primaryBtn, { backgroundColor: C.green }, actionLoading && d.btnDisabled]}
            onPress={() => onDelivered?.(order, {})} disabled={actionLoading}
          >
            {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={d.primaryBtnText}>✓ Доставлен</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={d.secondaryBtn} onPress={() => setStep('menu')}>
            <Text style={d.secondaryBtnText}>Проблема / Изменить</Text>
          </TouchableOpacity>
        </>)}

        {step === 'detail' && ['delivered', 'returned', 'issue', 'confirmed', 'new', 'cancelled'].includes(status) && (
          <TouchableOpacity style={[d.primaryBtn, { backgroundColor: C.violet }]} onPress={handleClose}>
            <Text style={d.primaryBtnText}>Закрыть</Text>
          </TouchableOpacity>
        )}

        {step !== 'detail' && (
          <TouchableOpacity style={[d.primaryBtn, { backgroundColor: C.muted }]} onPress={resetStep}>
            <Text style={d.primaryBtnText}>← Назад</Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionCard({ label, children }) {
  return (
    <View style={d.sectionCard}>
      <Text style={d.sectionLabel}>{label}</Text>
      {children}
    </View>
  )
}

function PayRow({ label, value, valueColor }) {
  return (
    <View style={d.payRow}>
      <Text style={d.payLabel}>{label}</Text>
      <Text style={[d.payVal, valueColor && { color: valueColor }]}>{value}</Text>
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const bs = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    // Liquid glass: GlassFill provides the frosted surface; overflow clips it
    // to the rounded top corners. Solid bg/shadow removed so it stays see-through.
    backgroundColor: 'transparent', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden',
    borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
  },
  handleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 8 },
  handle:     { width: 46, height: 5, borderRadius: 99, backgroundColor: '#d1d9e6' },
})

const d = StyleSheet.create({
  // Header
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 4, paddingBottom: 14, gap: 10 },
  orderNum:     { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.5 },
  statusChip:   { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  statusChipText: { fontSize: 12, fontWeight: '700' },
  closeBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.line, justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { fontSize: 14, color: C.muted, fontWeight: '700' },

  scroll: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },

  // Section card
  sectionCard:  { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },

  // Client
  clientRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar:       { width: 50, height: 50, borderRadius: 17, backgroundColor: '#eef3ff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  avatarInitial: { fontSize: 20, fontWeight: '700', color: C.violet },
  clientName:   { fontSize: 18, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  clientPhone:  { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 2 },
  infoRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  infoText:     { flex: 1, fontSize: 13, color: C.ink, fontWeight: '600', lineHeight: 19 },

  // Client comment
  commentBox:   { backgroundColor: '#f8f4ff', borderRadius: 13, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ece6ff' },
  commentLabel: { fontSize: 10, fontWeight: '700', color: C.violet, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  commentText:  { fontSize: 13, color: C.ink, lineHeight: 19 },

  // Contact buttons
  contactRow:       { flexDirection: 'row', gap: 8 },
  contactBtn:       { flex: 1, borderRadius: 14, paddingVertical: 11, alignItems: 'center', gap: 5, borderWidth: 1 },
  contactBtnCall:   { backgroundColor: '#f0f7ff', borderColor: '#d0e4ff' },
  contactBtnWa:     { backgroundColor: '#f0fff6', borderColor: '#c3f0d5' },
  contactBtnTg:     { backgroundColor: '#f0f8ff', borderColor: '#c5dff5' },
  contactLabel:     { fontSize: 11, fontWeight: '600' },

  // Comments (thread)
  commentsLoading:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  commentsLoadingText: { fontSize: 12, color: C.muted, fontWeight: '700' },
  emptyComments:       { fontSize: 13, color: C.muted, fontWeight: '700', textAlign: 'center', paddingVertical: 12 },
  commentThreadItem:   { backgroundColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.60)', borderRadius: 14, padding: 12, marginBottom: 8 },
  commentThreadHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  commentAuthor:       { flex: 1, fontSize: 12, color: C.ink, fontWeight: '700' },
  commentRoleBadge:    { backgroundColor: '#eef3ff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  commentRoleText:     { fontSize: 10, color: C.violet, fontWeight: '700' },
  commentBody:         { fontSize: 13, color: C.ink, lineHeight: 19, fontWeight: '600' },
  showMoreText:        { fontSize: 12, color: C.violet, fontWeight: '600', marginTop: 4 },
  commentTime:         { fontSize: 10, color: C.muted, fontWeight: '700', marginTop: 6 },
  commentInputRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  commentInput:        { flex: 1, minHeight: 42, maxHeight: 86, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.45)', color: C.ink, fontSize: 13, fontWeight: '700' },
  commentSendBtn:      { width: 42, height: 42, borderRadius: 14, backgroundColor: C.violet, alignItems: 'center', justifyContent: 'center' },

  // Person row (creator merged)
  personRow:         { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personAvatarRing:  { borderRadius: 13, borderWidth: 1, borderColor: C.line, flexShrink: 0, overflow: 'hidden' },
  personName:        { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: 3 },
  personPhone:       { fontSize: 13, color: C.blue, fontWeight: '700' },
  personPhoneMuted:  { fontSize: 13, color: C.muted, fontWeight: '600' },
  rolePill:          { backgroundColor: `${C.violet}18`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  rolePillText:      { fontSize: 11, fontWeight: '700', color: C.violet },

  // Payment
  payRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  payLabel:     { fontSize: 13, color: C.muted },
  payVal:       { fontSize: 13, fontWeight: '600', color: C.ink },
  collectRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11, marginTop: 4 },
  collectLabel: { fontSize: 15, fontWeight: '700', color: C.ink },
  collectVal:   { fontSize: 22, fontWeight: '700', color: C.violet, letterSpacing: -0.5 },
  prepayRow:    { marginTop: 10 },
  prepayPill:   { borderRadius: 10, padding: 10 },
  prepayPillText: { fontSize: 13, fontWeight: '600' },

  // Products
  productRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  productThumb:        { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  productThumbPlaceholder: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#eef5ff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#dbe8fb' },
  productThumbInitial: { fontSize: 18, fontWeight: '700', color: C.blue },
  productName:         { fontSize: 14, fontWeight: '600', color: C.ink, marginBottom: 2 },
  productQty:          { fontSize: 12, color: C.muted, fontWeight: '600' },
  productPrice:        { fontSize: 14, fontWeight: '700', color: C.ink },

  // Issue box
  issueBox:   { backgroundColor: '#fff4f4', borderRadius: 14, padding: 13, borderWidth: 1, borderColor: '#ffd5d5' },
  issueLabel: { fontSize: 11, fontWeight: '700', color: C.red, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  issueText:  { fontSize: 13, color: C.ink, lineHeight: 19 },

  // Action bar
  actionBar:      { gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line },
  primaryBtn:     { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondaryBtn:   { borderRadius: 999, paddingVertical: 13, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderColor: C.line },
  secondaryBtnText: { fontSize: 15, fontWeight: '600', color: C.ink },
  btnDisabled:    { opacity: 0.45 },
})

const ps = StyleSheet.create({
  stepTitle: { fontSize: 20, fontWeight: '700', color: C.ink, marginBottom: 8 },
  stepSub:   { fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 20 },
  optRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  optIcon:   { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.45)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  optLabel:  { fontSize: 15, fontWeight: '600', color: C.ink, marginBottom: 2 },
  optDesc:   { fontSize: 12, color: C.muted, fontWeight: '600' },
  chevron:   { fontSize: 22, color: C.muted },
  btnPrimary:  { backgroundColor: C.blue, borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },
  reasonRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  reasonRowActive: { backgroundColor: '#f0f4ff', borderRadius: 12, paddingHorizontal: 10, marginHorizontal: -10 },
  radio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.line },
  radioActive: { borderColor: C.blue, backgroundColor: C.blue },
  reasonText:  { fontSize: 15, color: C.muted, fontWeight: '600' },
  input:       { borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink, backgroundColor: C.card, minHeight: 64, textAlignVertical: 'top', marginBottom: 16 },
})
