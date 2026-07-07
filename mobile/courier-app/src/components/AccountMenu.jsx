import { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import Avatar from './Avatar'
import { animateLayout } from './motion'
import { GlassFill, Sheen, useGlass } from './glass'

export function AccountMenu({
  visible,
  user,
  isOnline,
  notificationsEnabled,
  darkTheme,
  onClose,
  onRefresh,
  onToggleOnline,
  onToggleNotifications,
  onToggleDarkTheme,
  onLogout,
}) {
  const initials = getInitials(user)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { T, dark } = useGlass()

  // Spring drop-in: panel slides down slightly and fades while the dim appears
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (visible) {
      progress.setValue(0)
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 17, stiffness: 210, mass: 0.8 }).start()
    }
  }, [visible])

  const goProfile = () => {
    onClose()
    router.push('/(tabs)/profile')
  }

  const refresh = () => {
    onRefresh?.()
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Animated.View
          style={{
            width: '100%', alignItems: 'center',
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
            ],
          }}
        >
        <Pressable style={s.menu} onPress={event => event.stopPropagation()}>
          <GlassFill tint={dark ? 'dark' : 'light'} intensity={56} overlay="rgba(15,26,46,0.62)" androidFallback="rgba(16,28,48,0.94)" />
          <Sheen radius={28} opacity={0.12} />
          <View style={s.header}>
            <Avatar uri={user?.avatar_url} name={user?.full_name} fallback={initials} size={70} color={T.indigo} />
            <View style={s.headerText}>
              <Text style={[s.name, { color: T.ink }]} numberOfLines={1}>{user?.phone || user?.full_name || 'Курьер'}</Text>
              <Text style={[s.role, { color: T.muted }]}>Курьер</Text>
            </View>
          </View>

          <View style={[s.divider, { backgroundColor: T.hairline }]} />

          <MenuRow icon="●" label={isOnline ? 'Онлайн' : 'Не на линии'} value={isOnline ? 'Принимать заказы' : 'Пауза'} onPress={onToggleOnline} accent={isOnline ? T.green : T.muted} />
          <MenuRow icon="⟳" label="Обновить данные" value="Синхронизация" onPress={refresh} />
          <MenuRow icon="⌨" label="Мои заказы" value="Открыть список заказов" onPress={() => { onClose(); router.push('/(tabs)/deliveries') }} />
          <MenuRow icon="▤" label="Касса" value="Выручка и сдача наличных" onPress={() => { onClose(); router.push('/(tabs)/cash') }} />

          <View style={[s.divider, { backgroundColor: T.hairline }]} />

          <MenuRow icon="♙" label="Мой профиль" onPress={goProfile} />
          <MenuRow icon="⚙" label="Настройки" value={settingsOpen ? 'Скрыть параметры' : 'Показать параметры'} onPress={() => { animateLayout(); setSettingsOpen(value => !value) }} />
          {settingsOpen && (
            <View style={[s.settingsPanel, { borderColor: T.hairline }]}>
              <SettingLine label="Статус" value={isOnline ? 'Онлайн' : 'Не на линии'} />
              <SettingLine label="Уведомления" value={notificationsEnabled ? 'Включены' : 'Выключены'} />
              <SettingLine label="Тема" value={darkTheme ? 'Тёмная' : 'Светлая'} last />
            </View>
          )}
          <SwitchRow icon="♢" label="Уведомления">
            <Switch
              value={notificationsEnabled}
              onValueChange={onToggleNotifications}
              trackColor={{ false: '#334155', true: '#334155' }}
              thumbColor={notificationsEnabled ? T.indigo : '#fff'}
            />
          </SwitchRow>
          <SwitchRow icon="☾" label="Тёмная тема">
            <Switch
              value={darkTheme}
              onValueChange={onToggleDarkTheme}
              trackColor={{ false: '#334155', true: '#334155' }}
              thumbColor={darkTheme ? T.indigo : '#fff'}
            />
          </SwitchRow>

          <View style={[s.divider, { backgroundColor: T.hairline }]} />

          <TouchableOpacity style={s.logout} activeOpacity={0.8} onPress={onLogout}>
            <Text style={[s.logoutIcon, { color: T.red }]}>↪</Text>
            <Text style={[s.logoutText, { color: T.red }]}>Выйти из системы</Text>
          </TouchableOpacity>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

function MenuRow({ icon, label, value, accent, onPress, children }) {
  const { T } = useGlass()
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.82} onPress={onPress}>
      <Text style={[s.rowIcon, accent && { color: accent }]}>{icon}</Text>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, { color: T.ink }]}>{label}</Text>
        {!!value && <Text style={[s.rowValue, { color: T.muted }]}>{value}</Text>}
      </View>
      {children || <Text style={s.chevron}>›</Text>}
    </TouchableOpacity>
  )
}

function SwitchRow({ icon, label, children }) {
  const { T } = useGlass()
  return (
    <View style={s.row}>
      <Text style={s.rowIcon}>{icon}</Text>
      <View style={s.rowText}>
        <Text style={[s.rowLabel, { color: T.ink }]}>{label}</Text>
      </View>
      {children}
    </View>
  )
}

function SettingLine({ label, value, last }) {
  const { T } = useGlass()
  return (
    <View style={[s.settingLine, !last && [s.settingLineBorder, { borderBottomColor: T.hairline }]]}>
      <Text style={[s.settingLabel, { color: T.muted }]}>{label}</Text>
      <Text style={[s.settingValue, { color: T.ink }]}>{value}</Text>
    </View>
  )
}

function getInitials(user) {
  const name = user?.full_name?.trim()
  if (name) {
    return name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()
  }
  return (user?.phone || 'К').slice(-2).toUpperCase()
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 62, paddingHorizontal: 12, backgroundColor: 'rgba(6,12,22,0.42)' },
  menu: { width: '100%', maxWidth: 440, borderRadius: 28, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 22 },
  headerText: { flex: 1, minWidth: 0 },
  name: { color: '#f6f8ff', fontSize: 22, fontWeight: '700', lineHeight: 27 },
  role: { color: '#8b96ac', fontSize: 16, fontWeight: '700', marginTop: 6 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.10)' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 24, paddingVertical: 9 },
  rowIcon: { width: 22, color: '#d7dfef', fontSize: 21, textAlign: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: '#f6f8ff', fontSize: 18, fontWeight: '600' },
  rowValue: { color: '#8b96ac', fontSize: 12, fontWeight: '700', marginTop: 2 },
  chevron: { color: '#475569', fontSize: 30, fontWeight: '300', lineHeight: 32 },
  settingsPanel: { marginHorizontal: 18, marginBottom: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  settingLine: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14 },
  settingLineBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)' },
  settingLabel: { color: '#8b96ac', fontSize: 13, fontWeight: '600' },
  settingValue: { color: '#f6f8ff', fontSize: 13, fontWeight: '700' },
  logout: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 25 },
  logoutIcon: { color: '#ff453a', fontSize: 22, fontWeight: '600' },
  logoutText: { color: '#ff453a', fontSize: 18, fontWeight: '700' },
})
