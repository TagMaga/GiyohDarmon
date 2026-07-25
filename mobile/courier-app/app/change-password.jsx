import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ChevronLeft } from 'lucide-react-native'
import useAuthStore from '../src/store/authStore'
import { changePassword } from '../src/api/auth'
import { GlassBackdrop, useGlass } from '../src/components/glass'

const C = {
  bg: '#0b101e', surface: '#1c2438', surface2: '#242e46',
  border: 'rgba(255,255,255,0.12)', border2: 'rgba(255,255,255,0.20)',
  text: '#f0f2f8', text2: '#9aa2b8', text3: '#68718a',
  accent: '#0a84ff', red: '#ff453a',
}

export default function ChangePasswordScreen() {
  const { user } = useAuthStore()
  const { dark } = useGlass()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const canSave = currentPassword && newPassword && confirmPassword && !loading

  async function handleSave() {
    setError(null)
    if (newPassword.length < 8) {
      setError('Новый пароль должен быть не короче 8 символов')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }
    setLoading(true)
    try {
      await changePassword(user?.id, { current_password: currentPassword, new_password: newPassword })
      Alert.alert('Пароль изменён', '', [{ text: 'ОК', onPress: () => router.back() }])
    } catch (err) {
      setError(err?.response?.data?.error?.message ?? err?.message ?? 'Не удалось изменить пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.topbar}>
          <TouchableOpacity style={s.back} onPress={() => router.back()}>
            <ChevronLeft size={20} color={C.text} />
          </TouchableOpacity>
          <Text style={s.title}>Изменить пароль</Text>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.card}>
            <Text style={s.cardTitle}>ПАРОЛЬ</Text>

            <View style={s.field}>
              <Text style={s.label}>Текущий пароль</Text>
              <TextInput
                style={s.input} placeholder="••••••••" placeholderTextColor={C.text3}
                value={currentPassword} onChangeText={(v) => { setCurrentPassword(v); setError(null) }}
                secureTextEntry autoComplete="current-password"
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>Новый пароль</Text>
              <TextInput
                style={s.input} placeholder="Минимум 8 символов" placeholderTextColor={C.text3}
                value={newPassword} onChangeText={(v) => { setNewPassword(v); setError(null) }}
                secureTextEntry autoComplete="new-password"
              />
            </View>
            <View style={[s.field, { marginBottom: 2 }]}>
              <Text style={s.label}>Повторите новый пароль</Text>
              <TextInput
                style={s.input} placeholder="••••••••" placeholderTextColor={C.text3}
                value={confirmPassword} onChangeText={(v) => { setConfirmPassword(v); setError(null) }}
                secureTextEntry autoComplete="new-password"
              />
            </View>
          </View>

          {error && <Text style={s.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
            disabled={!canSave}
            onPress={handleSave}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>Сохранить пароль</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 },
  back: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  content: { padding: 16, paddingTop: 4, gap: 14, paddingBottom: 60 },
  card: { backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14 },
  cardTitle: { fontSize: 10, fontWeight: '700', color: C.text3, letterSpacing: 1, marginBottom: 12 },
  field: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '600', color: C.text3, marginBottom: 6 },
  input: {
    height: 46, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 13, fontSize: 14, color: C.text,
  },
  errorText: { fontSize: 12.5, fontWeight: '600', color: '#ff6b61', paddingHorizontal: 4 },
  saveBtn: {
    height: 50, backgroundColor: C.accent, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
})
