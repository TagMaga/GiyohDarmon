import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../../shared/components/ToastProvider'
import client from '../../../shared/api/client'
import { submitHandover } from '../api'
import { KEYS }           from '../../../shared/queryKeys'
import { fmtMoney }       from '../utils/courierHelpers'

const S = {
  backdrop: (open) => ({
    position: 'fixed', inset: 0, background: 'rgba(7,17,34,.55)',
    zIndex: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
    transition: 'opacity .22s',
  }),
  sheet: {
    width: '100%', maxHeight: '92dvh', overflowY: 'auto',
    background: '#fff', borderRadius: '32px 32px 0 0',
    padding: `14px 20px calc(26px + env(safe-area-inset-bottom))`,
    boxShadow: '0 -24px 60px rgba(0,0,0,.22)',
    animation: 'sheetUp .25s ease both',
  },
  handle: { width: 74, height: 6, borderRadius: 99, background: '#d9deea', margin: '5px auto 26px' },
  h2: { fontSize: 28, margin: '0 0 20px', fontWeight: 900, color: '#071122' },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: '#f8fafc', border: '1px solid #e6ecf3',
    borderRadius: 22, padding: '15px 17px', marginBottom: 17,
  },
  rowSpan: { color: '#7d8797', fontWeight: 850, fontSize: 14 },
  rowB:    { fontSize: 22, color: '#ff9f0a', fontWeight: 900 },
  fieldLabel: { display: 'block', color: '#7d8797', fontWeight: 900, fontSize: 14, marginBottom: 10 },
  input: {
    width: '100%', border: '1.5px solid #dfe5ef', background: '#f8fafc',
    borderRadius: 22, padding: 18, fontSize: 26, fontWeight: 900,
    textAlign: 'center', color: '#071122', outline: 'none',
    fontFamily: 'inherit',
  },
  textarea: {
    width: '100%', border: '1.5px solid #dfe5ef', background: '#f8fafc',
    borderRadius: 22, padding: 18, fontSize: 15, fontWeight: 750,
    color: '#071122', outline: 'none', resize: 'none', minHeight: 88,
    fontFamily: 'inherit', textAlign: 'left',
  },
  uploadHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  uploadCount: { color: '#7d8797', fontWeight: 850, fontSize: 13 },
  uploadBox: {
    width: '100%', minHeight: 132, border: '1.5px dashed #dfe5ef',
    background: '#fbfcff', borderRadius: 22, padding: 18,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 5, color: '#071122', cursor: 'pointer', fontFamily: 'inherit',
  },
  uploadPlus: { fontSize: 32, lineHeight: 1, fontWeight: 900 },
  uploadTitle: { color: '#7d8797', fontSize: 16, fontWeight: 900 },
  uploadSub: { color: '#9aa3b2', fontSize: 12, fontWeight: 750 },
  proofs: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, marginTop: 10 },
  proof: { position: 'relative', aspectRatio: '1', borderRadius: 14, overflow: 'hidden', background: '#eef2f8', border: '1px solid #dfe5ef' },
  proofImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  removeProof: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 99,
    border: 0, background: 'rgba(7,17,34,.75)', color: '#fff', fontWeight: 900,
  },
  submitBtn: {
    width: '100%', border: 0, borderRadius: 22, padding: 18,
    background: '#665cff', color: 'white', fontSize: 17, fontWeight: 900,
    boxShadow: '0 13px 26px rgba(102,92,255,.22)', cursor: 'pointer',
    marginTop: 16,
  },
  error: { background: '#fee2e2', color: '#991b1b', borderRadius: 16, padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 850 },
}

export default function HandoverSheet({ open, onClose, summary }) {
  const qc      = useQueryClient()
  const toast   = useToast()
  const fileInputRef = useRef(null)
  const suggested = summary?.total_to_return ?? summary?.TotalToReturn ?? ''

  const [amount,  setAmount]  = useState('')
  const [comment, setComment] = useState('')
  const [proofFiles, setProofFiles] = useState([])
  const [proofPreviews, setProofPreviews] = useState([])

  useEffect(() => { if (open && suggested) setAmount(String(suggested)) }, [open, suggested])

  useEffect(() => {
    const urls = proofFiles.map((file) => URL.createObjectURL(file))
    setProofPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [proofFiles])

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      const num = parseFloat(amount)
      if (isNaN(num) || num < 0) throw new Error('Введите корректную сумму')
      if (proofFiles.length === 0) throw new Error('Добавьте скриншот перевода')

      const urls = await Promise.all(proofFiles.map(async (file) => {
        const fd = new FormData()
        fd.append('file', file)
        const uploadRes = await client.post('/uploads', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        return uploadRes.data?.data?.url ?? uploadRes.data?.url ?? ''
      }))
      const validUrls = urls.filter(Boolean)

      return submitHandover({
        proof_url: validUrls[0] || undefined,
        attachments_json: validUrls.length > 1 ? JSON.stringify(validUrls) : undefined,
        actual_amount: num,
        notes: comment.trim() || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.courier.cashSummary })
      qc.invalidateQueries({ queryKey: KEYS.courier.handovers })
      toast.success('Отправлено диспетчеру на проверку')
      handleClose()
    },
  })

  function handleClose() {
    reset(); setAmount(''); setComment(''); setProofFiles([]); onClose()
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function handleProofSelect(files) {
    const next = Array.from(files ?? []).filter((file) => file.type?.startsWith('image/'))
    if (next.length === 0) return
    setProofFiles((current) => [...current, ...next].slice(0, 5))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const errMsg = error?.response?.data?.error?.message ?? error?.message

  return (
    <div style={S.backdrop(open)} onClick={e => { if (e.target === e.currentTarget) handleClose() }}>
      <style>{`@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      {open && (
        <div style={S.sheet}>
          <div style={S.handle} />
          <h2 style={S.h2}>Сдать наличные</h2>

          <div style={S.row}>
            <span style={S.rowSpan}>Ожидается к сдаче</span>
            <b style={S.rowB}>{fmtMoney(suggested)}</b>
          </div>

          {errMsg && <div style={S.error}>{errMsg}</div>}

          <div style={{ marginBottom: 17 }}>
            <label style={S.fieldLabel}>Сумма перевода *</label>
            <input
              style={S.input}
              inputMode="numeric"
              pattern="[0-9]*"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          <div style={{ marginBottom: 17 }}>
            <div style={S.uploadHead}>
              <label style={S.fieldLabel}>Скриншот перевода *</label>
              <span style={S.uploadCount}>{proofFiles.length}/5</span>
            </div>
            {/* Visually hidden — NOT display:none. iOS Safari / Expo web webviews
                ignore programmatic .click() on a display:none file input, so the
                picker never opens. Keeping it in the layout (1px, opacity 0) makes
                .click() reliable across desktop, Android Chrome and iOS Safari. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{
                position: 'absolute', width: 1, height: 1,
                opacity: 0, overflow: 'hidden', pointerEvents: 'none', border: 0, padding: 0,
              }}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => handleProofSelect(e.target.files)}
            />
            <button
              type="button"
              style={S.uploadBox}
              onClick={openFilePicker}
            >
              <span style={S.uploadPlus}>+</span>
              <span style={S.uploadTitle}>Добавить подтверждение</span>
              <span style={S.uploadSub}>Камера · Галерея · Файл</span>
            </button>
            {proofFiles.length > 0 && (
              <div style={S.proofs}>
                {proofFiles.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} style={S.proof}>
                    <img src={proofPreviews[index]} alt="proof" style={S.proofImg} />
                    <button
                      type="button"
                      style={S.removeProof}
                      onClick={() => setProofFiles((current) => current.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: 17 }}>
            <label style={S.fieldLabel}>Примечание</label>
            <textarea
              style={S.textarea}
              placeholder="Примечание для диспетчера…"
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
          </div>

          <button
            disabled={isPending || !amount || proofFiles.length === 0}
            style={{ ...S.submitBtn, opacity: isPending || !amount || proofFiles.length === 0 ? 0.6 : 1 }}
            onClick={() => mutate()}
          >
            {isPending ? 'Отправляем...' : '↑ Отправить на проверку'}
          </button>
        </div>
      )}
    </div>
  )
}
