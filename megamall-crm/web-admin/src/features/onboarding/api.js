import client from '../../shared/api/client'

// POST /public/worker-applications — unauthenticated. client's request
// interceptor only attaches a Bearer token when one exists in localStorage,
// so this call works fine for an anonymous visitor.
//
// multipart/form-data, not JSON — an applicant may attach documents
// (passport, etc.) in the same submission. fields' null/undefined/empty
// values are omitted; documents is an array of { file, documentType }.
export async function submitWorkerApplication(fields, documents = []) {
  const form = new FormData()
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') form.append(key, value)
  })
  documents.forEach(({ file, documentType }) => {
    form.append('documents', file)
    form.append('document_types', documentType)
  })
  const res = await client.post('/public/worker-applications', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return res.data?.data
}
