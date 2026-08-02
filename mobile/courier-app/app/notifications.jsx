import { useCallback, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useFocusEffect } from '@react-navigation/native'
import { ChevronLeft, Bell } from 'lucide-react-native'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../src/api/notifications'
import { useGlass } from '../src/components/glass'
import { dayjsTZ } from '../src/utils/date'
dayjs.locale('ru')

const C = {
  bg: '#0b101e', surface: '#1c2438', surface2: '#242e46',
  border: 'rgba(255,255,255,0.12)',
  text: '#f0f2f8', text2: '#9aa2b8', text3: '#68718a',
  accent: '#0a84ff',
}

// Which tab a notification's type most naturally lands the courier on —
// there is no single "order detail" deep-link screen in this app, so this
// takes them to the tab where that order/info actually lives.
const TYPE_ROUTE = {
  courier_assigned: '/(tabs)/deliveries',
  order_comment: '/(tabs)/deliveries',
  warehouse_pickup: '/(tabs)/deliveries',
  cash_return_due: '/(tabs)/cash',
  orders_available: '/(tabs)/claimable',
}

export default function NotificationsScreen() {
  const { dark } = useGlass()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = async () => {
    try {
      const res = await getNotifications()
      setItems(res.data?.data || [])
    } catch (e) {
      console.warn('[notifications] load failed:', e?.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useFocusEffect(useCallback(() => { load() }, []))

  async function openItem(item) {
    if (!item.read) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)))
      markNotificationRead(item.id).catch(() => {})
    }
    const dest = TYPE_ROUTE[item.type]
    if (dest) router.push(dest)
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    try {
      await markAllNotificationsRead()
    } catch (e) {
      console.warn('[notifications] mark-all-read failed:', e?.message)
    }
  }

  const hasUnread = items.some((n) => !n.read)

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={s.topbar}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <ChevronLeft size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={s.title}>Уведомления</Text>
        {hasUnread && (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={s.markAll}>Прочитать всё</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.accent} /></View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Bell size={36} color={C.text3} />
          <Text style={s.emptyText}>Уведомлений пока нет</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load() }} tintColor={C.accent} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={[s.item, !item.read && s.itemUnread]} onPress={() => openItem(item)}>
              {!item.read && <View style={s.dot} />}
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle}>{item.title}</Text>
                <Text style={s.itemBody}>{item.body}</Text>
                <Text style={s.itemTime}>{dayjsTZ(item.created_at).format('D MMMM, HH:mm')}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 },
  back: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: C.text, flex: 1 },
  markAll: { fontSize: 13, fontWeight: '700', color: C.accent },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  emptyText: { fontSize: 14, fontWeight: '600', color: C.text3 },
  list: { padding: 16, paddingTop: 4, gap: 10, paddingBottom: 60 },
  item: {
    flexDirection: 'row', gap: 10, backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, padding: 14,
  },
  itemUnread: { backgroundColor: C.surface2, borderColor: 'rgba(10,132,255,0.35)' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 6 },
  itemTitle: { fontSize: 14.5, fontWeight: '700', color: C.text },
  itemBody: { fontSize: 13, fontWeight: '500', color: C.text2, marginTop: 3 },
  itemTime: { fontSize: 11, fontWeight: '600', color: C.text3, marginTop: 6 },
})
