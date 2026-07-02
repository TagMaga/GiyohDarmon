import { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import Avatar from './Avatar'
import { animateLayout } from './motion'

const C = {
  panel: '#0d1a2d',
  line: 'rgba(255,255,255,0.08)',
  text: '#f6f8ff',
  muted: '#7f8aa0',
  violet: '#6366f1',
  green: '#10b981',
  red: '#ff5f6c',
}

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
          <View style={s.header}>
            <Avatar uri={user?.avatar_url} name={user?.full_name} fallback={initials} size={70} color={C.violet} />
            <View style={s.headerText}>
              <Text style={s.name} numberOfLines={1}>{user?.phone || user?.full_name || 'Курьер'}</Text>
              <Text style={s.role}>Курьер</Text>
            </View>
          </View>

          <View style={s.divider} />

          <MenuRow icon="●" label={isOnline ? 'Онлайн' : 'Не на линии'} value={isOnline ? 'Принимать заказы' : 'Пауза'} onPress={onToggleOnline} accent={isOnline ? C.green : C.muted} />
          <MenuRow icon="⟳" label="Обновить данные" value="Синхронизация" onPress={refresh} />
          <MenuRow icon="⌨" label="Мои заказы" value="Открыть список заказов" onPress={() => { onClose(); router.push('/(tabs)/deliveries') }} />
          <MenuRow icon="▤" label="Касса" value="Выручка и сдача наличных" onPress={() => { onClose(); router.push('/(tabs)/cash') }} />

          <View style={s.divider} />

          <MenuRow icon="♙" label="Мой профиль" onPress={goProfile} />
          <MenuRow icon="⚙" label="Настройки" value={settingsOpen ? 'Скрыть параметры' : 'Показать параметры'} onPress={() => { animateLayout(); setSettingsOpen(value => !value) }} />
          {settingsOpen && (
            <View style={s.settingsPanel}>
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
              thumbColor={notificationsEnabled ? C.violet : '#fff'}
            />
          </SwitchRow>
          <SwitchRow icon="☾" label="Тёмная тема">
            <Switch
              value={darkTheme}
              onValueChange={onToggleDarkTheme}
              trackColor={{ false: '#334155', true: '#334155' }}
              thumbColor={darkTheme ? C.violet : '#fff'}
            />
          </SwitchRow>

          <View style={s.divider} />

          <TouchableOpacity style={s.logout} activeOpacity={0.8} onPress={onLogout}>
            <Text style={s.logoutIcon}>↪</Text>
            <Text style={s.logoutText}>Выйти из системы</Text>
          </TouchableOpacity>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

function MenuRow({ icon, label, value, accent, onPress, children }) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.82} onPress={onPress}>
      <Text style={[s.rowIcon, accent && { color: accent }]}>{icon}</Text>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!value && <Text style={s.rowValue}>{value}</Text>}
      </View>
      {children || <Text style={s.chevron}>›</Text>}
    </TouchableOpacity>
  )
}

function SwitchRow({ icon, label, children }) {
  return (
    <View style={s.row}>
      <Text style={s.rowIcon}>{icon}</Text>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
      </View>
      {children}
    </View>
  )
}

function SettingLine({ label, value, last }) {
  return (
    <View style={[s.settingLine, !last && s.settingLineBorder]}>
      <Text style={s.settingLabel}>{label}</Text>
      <Text style={s.settingValue}>{value}</Text>
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
  menu: { width: '100%', maxWidth: 440, borderRadius: 24, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.24, shadowRadius: 30, elevation: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 22 },
  headerText: { flex: 1, minWidth: 0 },
  name: { color: C.text, fontSize: 22, fontWeight: '900', lineHeight: 27 },
  role: { color: C.muted, fontSize: 16, fontWeight: '700', marginTop: 6 },
  divider: { height: 1, backgroundColor: C.line },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 24, paddingVertical: 9 },
  rowIcon: { width: 22, color: '#d7dfef', fontSize: 21, textAlign: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: C.text, fontSize: 18, fontWeight: '800' },
  rowValue: { color: C.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  chevron: { color: '#475569', fontSize: 30, fontWeight: '300', lineHeight: 32 },
  settingsPanel: { marginHorizontal: 18, marginBottom: 8, borderRadius: 16, backgroundColor: '#152238', borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  settingLine: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14 },
  settingLineBorder: { borderBottomWidth: 1, borderBottomColor: C.line },
  settingLabel: { color: C.muted, fontSize: 13, fontWeight: '800' },
  settingValue: { color: C.text, fontSize: 13, fontWeight: '900' },
  logout: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 25 },
  logoutIcon: { color: C.red, fontSize: 22, fontWeight: '800' },
  logoutText: { color: C.red, fontSize: 18, fontWeight: '900' },
})
