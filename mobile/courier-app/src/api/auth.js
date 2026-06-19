import client from './client'
export const login = (data) => client.post('/auth/login', data)
export const logout = (refreshToken) => client.post('/auth/logout', { refresh_token: refreshToken })
export const getMe = () => client.get('/courier/me')
