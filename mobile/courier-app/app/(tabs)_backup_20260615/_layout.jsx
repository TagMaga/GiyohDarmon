import { Tabs } from 'expo-router'
import { Text } from 'react-native'

const ACCENT = '#6366f1'

const TabIcon = ({ emoji, focused }) => (
  <Text style={{ fontSize: focused ? 22 : 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
)

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: '#5e6478',
        tabBarStyle: {
          backgroundColor: '#1e2130',
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.07)',
          height: 60,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="dashboard"  options={{ title: 'Главная',  tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Доставки', tabBarIcon: ({ focused }) => <TabIcon emoji="📦" focused={focused} /> }} />
      <Tabs.Screen name="claimable"  options={{ title: 'Захват',   tabBarIcon: ({ focused }) => <TabIcon emoji="🎯" focused={focused} /> }} />
      <Tabs.Screen name="cash"       options={{ title: 'Касса',    tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }} />
      <Tabs.Screen name="profile"    options={{ title: 'Профиль',  tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }} />
    </Tabs>
  )
}
