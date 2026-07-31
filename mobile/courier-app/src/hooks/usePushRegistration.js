import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { registerPushToken } from '../api/notifications'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

// Requests notification permission and registers the device's Expo push
// token with the backend (PUT /courier/push-token). Call once the courier
// is authenticated — a physical device is required (simulators/emulators
// have no push credentials).
export default function usePushRegistration(enabled) {
  useEffect(() => {
    if (!enabled) return
    if (!Device.isDevice) return

    let cancelled = false

    async function register() {
      try {
        const existing = await Notifications.getPermissionsAsync()
        let status = existing.status
        if (status !== 'granted') {
          const requested = await Notifications.requestPermissionsAsync()
          status = requested.status
        }
        if (status !== 'granted' || cancelled) return

        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          })
        }

        const projectId = Constants.expoConfig?.extra?.eas?.projectId
        const { data: token } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        )
        if (!token || cancelled) return

        await registerPushToken(token, Platform.OS)
      } catch (e) {
        console.warn('[push] registration failed:', e?.message)
      }
    }

    register()
    return () => { cancelled = true }
  }, [enabled])
}
