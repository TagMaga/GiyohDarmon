import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import useAuthStore from '../src/store/authStore'

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
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  )
}
