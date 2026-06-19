import { useEffect, useRef, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable,
  Alert, ActivityIndicator, Modal,
  Animated, PanResponder, Dimensions, Linking, TextInput,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { updateOrderStatus, reportAddressChanged, deferOrder } from '../api/orders'
import useAuthStore from '../store/authStore'
import { resolveCreator } from '../lib/creator'

const { height: SCREEN_H } = Dimensions.get('window')
export const SHEET_H = SCREEN_H * 0.90
const DRAG_CLOSE_THRESHOLD = 120

export const C = {
  bg: '#f6f8fb', card: '#ffffff', ink: '#071122', muted: '#7d8797', line: '#e6ecf3',
  blue: '#1683ff', violet: '#665cff', green: '#12b76a', orange: '#ff9f0a', red: '#ff453a',
  tag: '#f0f4ff',
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
  { key: 'later',     label: 'Доставить позже',     icon: '🕐', desc: 'Перенести доставку' },
  { key: 'address',   label: 'Клиент сменил адрес', icon: '📍', desc: 'Снять назначение курьера' },
  { key: 'no_answer', label: 'Клиент не отвечает',  icon: '📵', desc: 'Зафиксировать попытку' },
  { key: 'cancel',    label: 'Отмена заказа',       icon: '✕',  desc: 'Отменить заказ' },
]
const CANCEL_REASONS = ['Клиент отказался', 'Неверный адрес', 'Товар повреждён', 'Другое']
const DEFER_OPTIONS = [
  { key: 'd1', label: 'Завтра',       days: 1 },
  { key: 'd2', label: '+2 дня',       days: 2 },
  { key: 'd3', label: '+3 дня',       days: 3 },
  { key: 'd7', label: 'Через неделю', days: 7 },
]

function addDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d
}

// ── Bottom sheet wrapper ────────────────────────────────────────────────────

export function BottomSheet({ visible, onClose, children, height = SHEET_H }) {
  const insets    = useSafeAreaInsets()
  const translateY = useRef(new Animated.Value(height)).current
  const dimOpacity = useRef(new Animated.Value(0)).current
  const isOpen     = useRef(false)

  useEffect(() => {
    if (visible && !isOpen.current) {
      isOpen.current = true
      translateY.setValue(height)
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }),
        Animated.timing(dimOpacity,  { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start()
    } else if (!visible && isOpen.current) {
      isOpen.current = false
      Animated.parallel([
        Animated.spring(translateY, { toValue: height, useNativeDriver: true, damping: 25, stiffness: 250 }),
        Animated.timing(dimOpacity,  { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start()
    }
  }, [visible])

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove:  (_, g) => { if (g.dy > 0) translateY.setValue(g.dy) },
    onPanResponderRelease: (_, g) => {
      if (g.dy > DRAG_CLOSE_THRESHOLD || g.vy > 0.8) onClose()
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }).start()
    },
  })).current

  if (!visible) return null

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[bs.backdrop, { opacity: dimOpacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[bs.sheet, { height, paddingBottom: insets.bottom, transform: [{ translateY }] }]}>
        <View {...panResponder.panHandlers} style={bs.handleArea}>
          <View style={bs.handle} />
        </View>
        {children}
      </Animated.View>
    </Modal>
  )
}

// ── Order detail sheet ──────────────────────────────────────────────────────

export function OrderDetailSheet({
  order, onClose, onStart, onDelivered, actionLoading, onRefresh, initialStep = 'detail',
}) {
  // All hooks before any conditional return
  const [step, setStep]               = useState(initialStep)
  const [cancelReason, setCancelReason] = useState('')
  const [laterDate, setLaterDate]     = useState(null)
  const [newAddress, setNewAddress]   = useState('')
  const [stepLoading, setStepLoading] = useState(false)
  const currentUserName = useAuthStore((st) => st.user?.full_name) || ''

  useEffect(() => {
    if (order) { setStep(initialStep); setCancelReason(''); setLaterDate(null); setNewAddress('') }
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
  const prepayStatus  = order.prepayment_status   // none | pending_verification | verified | rejected
  const prepayLabel   = order.prepayment_type === 'full' ? 'Полная предоплата' : 'Частичная предоплата'

  // Client comment (various field names the backend might use)
  const clientComment = order.notes || order.comment || order.customer_comment || ''

  // Seller info — either from enriched `seller` object or creator fallback
  const sellerName  = order.seller?.full_name || order.seller_name || null
  const sellerPhone = order.seller?.phone || order.seller_phone || null

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
  const callCreator = () => creator.phone && Linking.openURL(`tel:${creator.phone}`)
  const callSeller  = () => sellerPhone && Linking.openURL(`tel:${sellerPhone}`)

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

        {/* ── Sub-flows (problem / change step) ──────────────────── */}
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
                    <Text style={[ps.reasonText, laterDate === opt.key && { color: C.ink, fontWeight: '800' }]}>
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

            {step === 'no_answer' && (<>
              <Text style={ps.stepTitle}>Клиент не отвечает</Text>
              <Text style={ps.stepSub}>Попытка будет зафиксирована. Диспетчер свяжется с клиентом.</Text>
              <TouchableOpacity style={[ps.btnPrimary, stepLoading && ps.btnDisabled]} disabled={stepLoading} onPress={() => doStatus('issue', 'Клиент не отвечает')}>
                {stepLoading ? <ActivityIndicator color="#fff" /> : <Text style={ps.btnText}>Зафиксировать попытку</Text>}
              </TouchableOpacity>
            </>)}

            {step === 'cancel' && (<>
              <Text style={ps.stepTitle}>Отмена заказа</Text>
              <Text style={ps.stepSub}>Выберите причину</Text>
              {CANCEL_REASONS.map(r => (
                <TouchableOpacity key={r} style={[ps.reasonRow, cancelReason === r && ps.reasonRowActive]} onPress={() => setCancelReason(r)}>
                  <View style={[ps.radio, cancelReason === r && ps.radioActive]} />
                  <Text style={[ps.reasonText, cancelReason === r && { color: C.ink, fontWeight: '800' }]}>{r}</Text>
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

          {/* CLIENT ──────────────────────────────────────────────── */}
          <SectionCard label="Клиент">
            <View style={d.clientRow}>
              <View style={d.avatar}><Text style={{ fontSize: 24 }}>👤</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={d.clientName}>{order.customer?.full_name || '—'}</Text>
                {order.customer?.phone
                  ? <Text style={d.clientPhone}>{order.customer.phone}</Text>
                  : null}
              </View>
            </View>
            {(order.customer?.address || order.customer?.city) && (
              <View style={d.infoRow}>
                <Text style={d.infoIcon}>📍</Text>
                <Text style={d.infoText}>
                  {[order.customer.address, order.customer.city].filter(Boolean).join(', ')}
                </Text>
              </View>
            )}

            {/* Client comment */}
            {!!clientComment && (
              <View style={d.commentBox}>
                <Text style={d.commentLabel}>Комментарий</Text>
                <Text style={d.commentText}>{clientComment}</Text>
              </View>
            )}

            {/* Contact buttons */}
            <View style={d.contactRow}>
              <TouchableOpacity style={d.contactBtn} onPress={callPhone}>
                <Text style={d.contactIcon}>📞</Text>
                <Text style={d.contactLabel}>Звонок</Text>
              </TouchableOpacity>
              <TouchableOpacity style={d.contactBtn} onPress={openWhatsApp}>
                <Text style={d.contactIcon}>💬</Text>
                <Text style={d.contactLabel}>WhatsApp</Text>
              </TouchableOpacity>
              <TouchableOpacity style={d.contactBtn} onPress={openTelegram}>
                <Text style={d.contactIcon}>✈️</Text>
                <Text style={d.contactLabel}>Telegram</Text>
              </TouchableOpacity>
            </View>
          </SectionCard>

          {/* SELLER / CREATOR ────────────────────────────────────── */}
          {/* Show dedicated seller block if we have enriched seller data */}
          {sellerName && (
            <SectionCard label="Продавец">
              <View style={d.personRow}>
                <View style={d.personAvatar}><Text style={{ fontSize: 18 }}>🏪</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={d.personName}>{sellerName}</Text>
                  {sellerPhone
                    ? <Pressable onPress={callSeller} hitSlop={6}>
                        {({ pressed }) => <Text style={[d.personPhone, pressed && { opacity: 0.6 }]}>📞 {sellerPhone}</Text>}
                      </Pressable>
                    : <Text style={d.personPhoneMuted}>Телефон не указан</Text>
                  }
                </View>
                <View style={d.rolePill}><Text style={d.rolePillText}>Продавец</Text></View>
              </View>
            </SectionCard>
          )}

          {/* Creator block (always shown; may overlap with seller if same person) */}
          {creator.hasCreator && (
            <SectionCard label="Создал заказ">
              <View style={d.personRow}>
                <View style={d.personAvatar}><Text style={{ fontSize: 18 }}>👤</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={d.personName}>{creator.name}</Text>
                  {creator.phone
                    ? <Pressable onPress={callCreator} hitSlop={6}>
                        {({ pressed }) => <Text style={[d.personPhone, pressed && { opacity: 0.6 }]}>📞 {creator.phone}</Text>}
                      </Pressable>
                    : <Text style={d.personPhoneMuted}>Телефон не указан</Text>
                  }
                </View>
                {creator.isOwn
                  ? <View style={[d.rolePill, { backgroundColor: `${C.green}18` }]}><Text style={[d.rolePillText, { color: C.green }]}>Мой заказ</Text></View>
                  : creator.roleLabel
                    ? <View style={[d.rolePill, { backgroundColor: `${creator.roleColor}18` }]}><Text style={[d.rolePillText, { color: creator.roleColor }]}>{creator.roleLabel}</Text></View>
                    : null
                }
              </View>
            </SectionCard>
          )}

          {/* PAYMENT ─────────────────────────────────────────────── */}
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

            {/* Prepayment status pill */}
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

          {/* PRODUCTS ────────────────────────────────────────────── */}
          {Array.isArray(order.items) && order.items.length > 0 && (
            <SectionCard label={`Товары · ${order.items.length} шт`}>
              {order.items.map((item, i) => (
                <View
                  key={item.product_id ?? item.id ?? i}
                  style={[d.productRow, i === order.items.length - 1 && { borderBottomWidth: 0 }]}
                >
                  <View style={d.productThumb}><Text style={{ fontSize: 18 }}>🛍️</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={d.productName}>{item.product_name || item.name || 'Товар'}</Text>
                    <Text style={d.productQty}>{item.quantity} шт</Text>
                  </View>
                  <Text style={d.productPrice}>{fmt(item.total_price ?? item.price)} сом</Text>
                </View>
              ))}
            </SectionCard>
          )}

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
            onPress={() => onDelivered?.(order)} disabled={actionLoading}
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7,17,34,0.52)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.14, shadowRadius: 28, elevation: 24,
  },
  handleArea: { alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  handle:     { width: 40, height: 5, borderRadius: 99, backgroundColor: '#d1d9e6' },
})

const d = StyleSheet.create({
  // Header
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 4, paddingBottom: 14, gap: 10 },
  orderNum:     { fontSize: 20, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  statusChip:   { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  statusChipText: { fontSize: 12, fontWeight: '900' },
  closeBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.line, justifyContent: 'center', alignItems: 'center' },
  closeBtnText: { fontSize: 14, color: C.muted, fontWeight: '900' },

  scroll: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },

  // Section card
  sectionCard:  { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16 },
  sectionLabel: { fontSize: 10, fontWeight: '900', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },

  // Client
  clientRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  avatar:       { width: 50, height: 50, borderRadius: 17, backgroundColor: '#eef3ff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  clientName:   { fontSize: 18, fontWeight: '900', color: C.ink, letterSpacing: -0.3 },
  clientPhone:  { fontSize: 13, color: C.muted, fontWeight: '600', marginTop: 2 },
  infoRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10 },
  infoIcon:     { fontSize: 13, marginTop: 2 },
  infoText:     { flex: 1, fontSize: 13, color: C.ink, fontWeight: '600', lineHeight: 19 },

  // Client comment
  commentBox:   { backgroundColor: '#f8f4ff', borderRadius: 13, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#ece6ff' },
  commentLabel: { fontSize: 10, fontWeight: '900', color: C.violet, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  commentText:  { fontSize: 13, color: C.ink, lineHeight: 19 },

  // Contact buttons
  contactRow:   { flexDirection: 'row', gap: 8 },
  contactBtn:   { flex: 1, backgroundColor: C.bg, borderRadius: 13, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  contactIcon:  { fontSize: 17, marginBottom: 3 },
  contactLabel: { fontSize: 11, fontWeight: '800', color: C.ink },

  // Person row (seller / creator)
  personRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  personAvatar: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#eef3ff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line, flexShrink: 0 },
  personName:   { fontSize: 15, fontWeight: '900', color: C.ink, marginBottom: 3 },
  personPhone:  { fontSize: 13, color: C.blue, fontWeight: '700' },
  personPhoneMuted: { fontSize: 13, color: C.muted, fontWeight: '600' },
  rolePill:     { backgroundColor: `${C.violet}18`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0 },
  rolePillText: { fontSize: 11, fontWeight: '900', color: C.violet },

  // Payment
  payRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  payLabel:     { fontSize: 13, color: C.muted },
  payVal:       { fontSize: 13, fontWeight: '800', color: C.ink },
  collectRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11, marginTop: 4 },
  collectLabel: { fontSize: 15, fontWeight: '900', color: C.ink },
  collectVal:   { fontSize: 22, fontWeight: '900', color: C.violet, letterSpacing: -0.5 },
  prepayRow:    { marginTop: 10 },
  prepayPill:   { borderRadius: 10, padding: 10 },
  prepayPillText: { fontSize: 13, fontWeight: '800' },

  // Products
  productRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.line },
  productThumb: { width: 40, height: 40, borderRadius: 11, backgroundColor: '#eef5ff', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#dbe8fb' },
  productName:  { fontSize: 14, fontWeight: '800', color: C.ink, marginBottom: 2 },
  productQty:   { fontSize: 12, color: C.muted, fontWeight: '600' },
  productPrice: { fontSize: 14, fontWeight: '900', color: C.ink },

  // Issue box
  issueBox:     { backgroundColor: '#fff4f4', borderRadius: 14, padding: 13, borderWidth: 1, borderColor: '#ffd5d5' },
  issueLabel:   { fontSize: 11, fontWeight: '900', color: C.red, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  issueText:    { fontSize: 13, color: C.ink, lineHeight: 19 },

  // Action bar
  actionBar:    { gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line },
  primaryBtn:   { borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  secondaryBtn: { borderRadius: 18, paddingVertical: 13, alignItems: 'center', backgroundColor: C.bg, borderWidth: 1, borderColor: C.line },
  secondaryBtnText: { fontSize: 15, fontWeight: '800', color: C.ink },
  btnDisabled:  { opacity: 0.45 },
})

const ps = StyleSheet.create({
  stepTitle:    { fontSize: 20, fontWeight: '900', color: C.ink, marginBottom: 8 },
  stepSub:      { fontSize: 14, color: C.muted, marginBottom: 20, lineHeight: 20 },
  optRow:       { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  optIcon:      { width: 44, height: 44, borderRadius: 14, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  optLabel:     { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 2 },
  optDesc:      { fontSize: 12, color: C.muted, fontWeight: '600' },
  chevron:      { fontSize: 22, color: C.muted },
  btnPrimary:   { backgroundColor: C.blue, borderRadius: 18, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText:      { color: '#fff', fontSize: 16, fontWeight: '900' },
  btnDisabled:  { opacity: 0.45 },
  reasonRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  reasonRowActive: { backgroundColor: '#f0f4ff', borderRadius: 12, paddingHorizontal: 10, marginHorizontal: -10 },
  radio:        { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.line },
  radioActive:  { borderColor: C.blue, backgroundColor: C.blue },
  reasonText:   { fontSize: 15, color: C.muted, fontWeight: '600' },
  input:        { borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink, backgroundColor: C.card, minHeight: 64, textAlignVertical: 'top', marginBottom: 16 },
})
