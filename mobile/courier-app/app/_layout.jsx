import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import useAuthStore from '../src/store/authStore'
import { GlassThemeProvider, useGlass } from '../src/components/glass'

function AppShell() {
  const { dark } = useGlass()
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const { isAuthenticated, rehydrate } = useAuthStore()

  useEffect(() => {
    rehydrate()
      .then(() => {
        if (!useAuthStore.getState().isAuthenticated) {
          router.replace('/(auth)/login')
        }
      })
      .catch(() => router.replace('/(auth)/login'))
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GlassThemeProvider>
        <AppShell />
      </GlassThemeProvider>
    </GestureHandlerRootView>
  )
}
