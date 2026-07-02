import client from './client'
export const login = (data) => client.post('/auth/login', data)
export const logout = (refreshToken) => client.post('/auth/logout', { refresh_token: refreshToken })
export const getMe = () => client.get('/courier/me')

export const uploadAvatar = (asset) => {
  const form = new FormData()
  form.append('avatar', { uri: asset.uri, type: asset.mimeType || 'image/jpeg', name: asset.fileName || `avatar_${Date.now()}.jpg` })
  return client.post('/users/me/avatar', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
