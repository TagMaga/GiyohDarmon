import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import useAuthStore from '../src/store/authStore'
import usePushRegistration from '../src/hooks/usePushRegistration'
import { GlassThemeProvider, useGlass } from '../src/components/glass'

function AppShell() {
  const { dark } = useGlass()
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const { isAuthenticated, rehydrate } = useAuthStore()

  useEffect(() => {
    rehydrate()
      .then(() => {
        const authed = useAuthStore.getState().isAuthenticated
        router.replace(authed ? '/(tabs)/dashboard' : '/(auth)/login')
      })
      .catch(() => router.replace('/(auth)/login'))
  }, [])

  usePushRegistration(isAuthenticated)

  // Tapping a push (foreground, background, or cold-start-from-notification)
  // opens the notifications screen, which is the same landing spot the bell
  // icon in the dashboard header uses.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      router.push('/notifications')
    })
    return () => sub.remove()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GlassThemeProvider>
        <AppShell />
      </GlassThemeProvider>
    </GestureHandlerRootView>
  )
}
