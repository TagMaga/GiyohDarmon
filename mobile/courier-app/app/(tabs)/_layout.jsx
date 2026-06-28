import { Tabs } from 'expo-router'
import { Text, View } from 'react-native'

const TabIcon = ({ emoji, focused }) => (
  <View style={{ alignItems: 'center' }}>
    <Text style={{ fontSize: focused ? 24 : 22, opacity: focused ? 1 : 0.55, transform: [{ translateY: focused ? -2 : 0 }] }}>
      {emoji}
    </Text>
  </View>
)

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1683ff',
        tabBarInactiveTintColor: '#8a93a3',
        tabBarStyle: {
          backgroundColor: 'rgba(255,255,255,0.96)',
          borderTopWidth: 1,
          borderTopColor: '#e6ecf3',
          height: 78,
          paddingBottom: 14,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="dashboard"  options={{ title: 'Главная',   tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Мои заказы',  tabBarIcon: ({ focused }) => <TabIcon emoji="📦" focused={focused} /> }} />
      <Tabs.Screen name="claimable"  options={{ title: 'Общий заказ', tabBarIcon: ({ focused }) => <TabIcon emoji="🎯" focused={focused} /> }} />
      <Tabs.Screen name="cash"       options={{ title: 'Касса',     tabBarIcon: ({ focused }) => <TabIcon emoji="💰" focused={focused} /> }} />
      <Tabs.Screen name="profile"    options={{ href: null }} />
    </Tabs>
  )
}
