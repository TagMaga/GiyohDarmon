import client from './client'

/**
 * POST /auth/login
 * Returns the full Axios response so the caller can access response.data.data
 */
export async function login(phone, password) {
  return client.post('/auth/login', { phone, password })
}
