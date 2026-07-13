import { Tabs } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import { Home, Package, MapPin, Wallet, User } from 'lucide-react-native'
import { useGlass } from '../../src/components/glass'

const BLUE = '#0a84ff'

function TabIcon({ Icon, focused, inactiveColor }) {
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
          color={focused ? BLUE : inactiveColor}
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
    backgroundColor: 'rgba(10,132,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(10,132,255,0.20)',
  },
})

export default function TabsLayout() {
  const { dark, T } = useGlass()
  const inactive = dark ? 'rgba(200,212,232,0.55)' : 'rgba(72,88,112,0.62)'
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: T.base },
        tabBarActiveTintColor: BLUE,
        tabBarInactiveTintColor: inactive,
        // Floating liquid-glass pill: real blur over the content scrolling under it
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 24,
          height: 68,
          borderRadius: 34,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={42}
            tint={dark ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: 34,
                overflow: 'hidden',
                backgroundColor: dark ? 'rgba(18,26,44,0.55)' : 'rgba(255,255,255,0.48)',
                borderWidth: 1,
                borderColor: dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.65)',
              },
            ]}
          />
        ),
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.1,
          marginTop: 1,
        },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen name="dashboard"  options={{ title: 'Главная',   tabBarIcon: ({ focused }) => <TabIcon Icon={Home}    focused={focused} inactiveColor={inactive} /> }} />
      <Tabs.Screen name="deliveries" options={{ title: 'Доставки',  tabBarIcon: ({ focused }) => <TabIcon Icon={Package} focused={focused} inactiveColor={inactive} /> }} />
      <Tabs.Screen name="claimable"  options={{ title: 'Доступные', tabBarIcon: ({ focused }) => <TabIcon Icon={MapPin}  focused={focused} inactiveColor={inactive} /> }} />
      <Tabs.Screen name="cash"       options={{ title: 'Касса',     tabBarIcon: ({ focused }) => <TabIcon Icon={Wallet}  focused={focused} inactiveColor={inactive} /> }} />
      <Tabs.Screen name="profile"    options={{ title: 'Профиль',   tabBarIcon: ({ focused }) => <TabIcon Icon={User}    focused={focused} inactiveColor={inactive} /> }} />
    </Tabs>
  )
}
