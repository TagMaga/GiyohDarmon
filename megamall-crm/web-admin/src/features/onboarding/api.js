import client from '../../shared/api/client'

// POST /public/worker-applications — unauthenticated. client's request
// interceptor only attaches a Bearer token when one exists in localStorage,
// so this call works fine for an anonymous visitor.
export async function submitWorkerApplication(payload) {
  const res = await client.post('/public/worker-applications', payload)
  return res.data?.data
}
