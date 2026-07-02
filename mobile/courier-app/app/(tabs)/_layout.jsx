import { Tabs } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { Home, Package, MapPin, Wallet } from 'lucide-react-native'

const BLUE = '#1683ff'
const INACTIVE = '#b0bac8'

function TabIcon({ Icon, focused }) {
  // Active pill springs in behind the icon; icon gives a small pop on focus.
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current
  useEffect(() => {
    Animated.spring(progress, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      damping: 14, stiffness: 220, mass: 0.7,
    }).start()
  }, [focused])

  return (
    <Animated.View style={styles.pill}>
      <Animated.View
        style={[styles.pillActive, {
          opacity: progress,
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
        }]}
      />
      <Animated.View
        style={{
          transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
        }}
      >
        <Icon
          size={22}
          color={focused ? BLUE : INACTIVE}
          strokeWidth={focused ? 2.5 : 1.8}
        />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  pill: {
    width: 54,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 17,
    backgroundColor: '#deeaff',
  },
})

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 0,
          shadowColor: '#0a1f44',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.07,
          shadowRadius: 20,
          elevation: 16,
          height: 84,
          paddingBottom: 18,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.1,
          marginTop: 1,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="dashboard"  options={{ title: 'Главная',   tabBarIcon: ({ focused }) => <TabIcon Icon={Home}    focused={focused} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Доставки',  tabBarIcon: ({ focused }) => <TabIcon Icon={Package} focused={focused} /> }} />
      <Tabs.Screen name="claimable"  options={{ title: 'Доступные', tabBarIcon: ({ focused }) => <TabIcon Icon={MapPin}  focused={focused} /> }} />
      <Tabs.Screen name="cash"       options={{ title: 'Касса',     tabBarIcon: ({ focused }) => <TabIcon Icon={Wallet}  focused={focused} /> }} />
      <Tabs.Screen name="profile"    options={{ href: null }} />
    </Tabs>
  )
}
