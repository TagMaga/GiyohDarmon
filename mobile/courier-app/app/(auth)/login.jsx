import { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView
} from 'react-native'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { login, getMe } from '../../src/api/auth'
import { API_URL } from '../../src/api/client'
import useAuthStore from '../../src/store/authStore'
import { FadeSlideIn, PressScale } from '../../src/components/motion'
import { GlassBackdrop } from '../../src/components/glass'

const C = {
  bg: '#0b101e', bg2: '#1b2338', surface: '#1c2438',
  border: 'rgba(255,255,255,0.12)', border2: 'rgba(255,255,255,0.20)',
  text: '#f0f2f8', text2: '#9aa2b8',
  accent: '#0a84ff', glow: 'rgba(10,132,255,0.3)',
  red: '#ff453a',
}

export default function LoginScreen() {
  const [loginVal, setLoginVal] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const setAuth = useAuthStore(s => s.setAuth)
  const setUser = useAuthStore(s => s.setUser)

  const handleLogin = async () => {
    if (!loginVal || !password) { Alert.alert('Ошибка', 'Введите логин и пароль'); return }
    setLoading(true)
    try {
      const { data } = await login({ phone: loginVal, password })
      const tokens = data.data
      if (!tokens?.access_token) throw new Error('Неожиданный ответ сервера')
      await setAuth(tokens.access_token, tokens.refresh_token)
      const { data: meRes } = await getMe()
      const profile = meRes.data
      if (profile.role !== 'courier') {
        Alert.alert('Нет доступа', 'Этот аккаунт не является курьером')
        return
      }
      setUser(profile)
      router.replace('/(tabs)/dashboard')
    } catch (err) {
      if (err.response) {
        // Server responded — a real auth/validation error.
        const msg = err.response.data?.error?.message || err.response.data?.error || 'Неверный логин или пароль'
        Alert.alert('Ошибка', String(msg))
      } else {
        // No response = the request never reached the server. Surface the actual
        // cause (timeout, DNS, cleartext-blocked, connection refused, ...) instead
        // of assuming a dev-mode "wrong WiFi" problem — this build talks to a
        // fixed public IP, so that's rarely the real reason.
        console.log('[login] network error:', err.code, err.message)
        Alert.alert(
          'Нет связи с сервером',
          `Не удалось подключиться к ${API_URL}.\n\nОшибка: ${err.message || 'неизвестная сетевая ошибка'}${err.code ? ` (${err.code})` : ''}.\n\nПроверьте подключение к интернету и убедитесь, что сервер запущен.`
        )
      }
    } finally { setLoading(false) }
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <GlassBackdrop dark />
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <FadeSlideIn from={22} style={{ width: '100%', alignItems: 'center' }}>
        <View style={s.card}>
          <FadeSlideIn delay={90} from={10}>
            <View style={s.iconBox}><Text style={s.iconText}>🛵</Text></View>
          </FadeSlideIn>
          <Text style={s.title}>Курьер Портал</Text>
          <Text style={s.sub}>MegaMall Delivery</Text>

          <View style={s.field}>
            <Text style={s.label}>ЛОГИН</Text>
            <TextInput
              style={s.input} placeholder="+992 ··· ···" placeholderTextColor={C.text2}
              value={loginVal} onChangeText={setLoginVal}
              autoCapitalize="none" keyboardType="phone-pad"
            />
          </View>
          <View style={s.field}>
            <Text style={s.label}>ПАРОЛЬ</Text>
            <TextInput
              style={s.input} placeholder="••••••••" placeholderTextColor={C.text2}
              value={password} onChangeText={setPassword} secureTextEntry
            />
          </View>

          <PressScale
            style={[s.btn, loading && s.btnDisabled]}
            scaleTo={0.96}
            onPress={handleLogin} disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Войти</Text>}
          </PressScale>
        </View>
        </FadeSlideIn>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, backgroundColor: C.surface,
    borderRadius: 28, padding: 32, borderWidth: 1, borderColor: C.border2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.45, shadowRadius: 32, elevation: 12,
    alignItems: 'center',
  },
  iconBox: {
    width: 64, height: 64, borderRadius: 20, backgroundColor: C.accent,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  iconText: { fontSize: 30 },
  title: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 },
  sub: { fontSize: 12, color: C.text2, marginBottom: 28 },
  field: { width: '100%', marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '700', color: C.text2, letterSpacing: 0.8, marginBottom: 6 },
  input: {
    width: '100%', height: 48, backgroundColor: C.bg2,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 16,
    paddingHorizontal: 14, fontSize: 16, color: C.text, fontWeight: '500',
  },
  btn: {
    width: '100%', height: 50, backgroundColor: C.accent,
    borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 8,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
