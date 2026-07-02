import { useState } from 'react'
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView
} from 'react-native'
import { router } from 'expo-router'
import { login, getMe } from '../../src/api/auth'
import { API_URL } from '../../src/api/client'
import useAuthStore from '../../src/store/authStore'
import { FadeSlideIn, PressScale } from '../../src/components/motion'

const C = {
  bg: '#0d0f14', bg2: '#13161e', surface: '#1e2130',
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.18)',
  text: '#f0f2f8', text2: '#9095a8',
  accent: '#6366f1', glow: 'rgba(99,102,241,0.3)',
  red: '#ef4444',
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
        // No response = the request never reached the server (network / wrong IP).
        Alert.alert(
          'Нет связи с сервером',
          `Не удалось подключиться к ${API_URL}.\n\nПроверьте, что сервер запущен и телефон в той же Wi-Fi сети, что и компьютер.`
        )
      }
    } finally { setLoading(false) }
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
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
    borderRadius: 20, padding: 32, borderWidth: 1, borderColor: C.border2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 24, elevation: 12,
    alignItems: 'center',
  },
  iconBox: {
    width: 64, height: 64, borderRadius: 18, backgroundColor: C.accent,
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
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, fontSize: 16, color: C.text, fontWeight: '500',
  },
  btn: {
    width: '100%', height: 50, backgroundColor: C.accent,
    borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginTop: 8,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
