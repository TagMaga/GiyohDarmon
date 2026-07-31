import { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ChevronLeft } from 'lucide-react-native'
import useAuthStore from '../src/store/authStore'
import { changePassword } from '../src/api/auth'
import { GlassBackdrop, useGlass } from '../src/components/glass'

export default function ChangePasswordScreen() {
  const { user } = useAuthStore()
  const { T, dark } = useGlass()

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
    <SafeAreaView style={[s.safe, { backgroundColor: T.base }]}>
      <GlassBackdrop />
      <StatusBar style={dark ? 'light' : 'dark'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.topbar}>
          <TouchableOpacity style={[s.back, { backgroundColor: T.card, borderColor: T.cardEdge }]} onPress={() => router.back()}>
            <ChevronLeft size={20} color={T.ink} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={[s.title, { color: T.ink }]}>Изменить пароль</Text>
        </View>

        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={[s.card, { backgroundColor: T.card, borderColor: T.cardEdge }]}>
            <Text style={[s.cardTitle, { color: T.muted }]}>ПАРОЛЬ</Text>

            <View style={s.field}>
              <Text style={[s.label, { color: T.muted }]}>Текущий пароль</Text>
              <TextInput
                style={[s.input, { backgroundColor: T.chip, borderColor: T.hairline, color: T.ink }]}
                placeholder="••••••••" placeholderTextColor={T.muted}
                value={currentPassword} onChangeText={(v) => { setCurrentPassword(v); setError(null) }}
                secureTextEntry autoComplete="current-password"
              />
            </View>
            <View style={s.field}>
              <Text style={[s.label, { color: T.muted }]}>Новый пароль</Text>
              <TextInput
                style={[s.input, { backgroundColor: T.chip, borderColor: T.hairline, color: T.ink }]}
                placeholder="Минимум 8 символов" placeholderTextColor={T.muted}
                value={newPassword} onChangeText={(v) => { setNewPassword(v); setError(null) }}
                secureTextEntry autoComplete="new-password"
              />
            </View>
            <View style={[s.field, { marginBottom: 2 }]}>
              <Text style={[s.label, { color: T.muted }]}>Повторите новый пароль</Text>
              <TextInput
                style={[s.input, { backgroundColor: T.chip, borderColor: T.hairline, color: T.ink }]}
                placeholder="••••••••" placeholderTextColor={T.muted}
                value={confirmPassword} onChangeText={(v) => { setConfirmPassword(v); setError(null) }}
                secureTextEntry autoComplete="new-password"
              />
            </View>
          </View>

          {error && <Text style={[s.errorText, { color: T.red }]}>{error}</Text>}

          <TouchableOpacity
            style={[s.saveBtn, { backgroundColor: T.blue, shadowColor: T.blue }, !canSave && s.saveBtnDisabled]}
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
  safe: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 },
  back: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700' },
  content: { padding: 16, paddingTop: 4, gap: 14, paddingBottom: 60 },
  card: {
    borderRadius: 14, borderWidth: 1, padding: 14,
    shadowColor: '#101c38', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  cardTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  field: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
  input: {
    height: 46, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 13, fontSize: 14,
  },
  errorText: { fontSize: 12.5, fontWeight: '600', paddingHorizontal: 4 },
  saveBtn: {
    height: 50, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.28, shadowRadius: 18, elevation: 5,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
})
