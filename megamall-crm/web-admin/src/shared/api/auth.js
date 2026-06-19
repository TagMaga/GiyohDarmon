import client from './client'

/**
 * POST /auth/login
 * Returns the full Axios response so the caller can access response.data.data
 */
export async function login(phone, password) {
  return client.post('/auth/login', { phone, password })
}

/**
 * GET /health
 * Expected response: { success: true, data: { status: "ok", db: "ok", migration_version: "..." } }
 */
export async function getHealth() {
  const res = await client.get('/health')
  return res.data
}

/**
 * GET /ready
 * Expected response: { success: true, data: { ready: true, checks: { ... } } }
 */
export async function getReady() {
  const res = await client.get('/ready')
  return res.data
}
