import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Building2, Boxes, CircleDollarSign, WalletCards, Plus, Search, MapPin,
  Phone, UserRound, ChevronRight, PackagePlus, Banknote, Undo2, Check,
  X, Printer, Download, ArrowRightLeft, Archive,
} from 'lucide-react'
import Modal from '../../../shared/components/Modal'
import SearchableSelect from '../../../shared/components/SearchableSelect'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import { usePharmacies, usePharmacy, usePharmacyDashboard, usePharmacyMutation } from '../hooks'
import * as api from '../api'

const money = value => `${Number(value || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} c`
const date = value => value ? new Date(value).toLocaleString('ru-RU') : '—'
const errorText = error => error?.response?.data?.error?.message || error?.message || 'Не удалось выполнить действие'

const field = 'w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100'
const primary = 'min-h-[42px] rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50'
const secondary = 'min-h-[42px] rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])

function printInvoice(invoice, pharmacy) {
  const popup = window.open('', '_blank')
  if (!popup) return
  popup.opener = null
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${html(invoice.invoice_number)}</title>
    <style>body{font-family:Arial,sans-serif;padding:36px;color:#111}h1{font-size:22px}.meta{color:#555;margin:6px 0 24px}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:10px;text-align:left}th{background:#f5f5f5}
    .sum{text-align:right;font-size:18px;font-weight:700;margin-top:20px}</style></head><body>
    <h1>Накладная ${html(invoice.invoice_number)}</h1>
    <div class="meta">Аптека: ${html(pharmacy.name)}<br>Адрес: ${html(pharmacy.address)}<br>Дата: ${html(date(invoice.created_at))}</div>
    <table><thead><tr><th>Товар</th><th>Количество</th><th>Цена</th><th>Скидка</th><th>Сумма</th></tr></thead><tbody>
    ${(invoice.items || []).map(item => `<tr><td>${html(item.product_name)}</td><td>${item.quantity}</td><td>${html(money(item.unit_price))}</td><td>${html(money(item.discount_amount))}</td><td>${html(money(item.line_total))}</td></tr>`).join('')}
    </tbody></table><div class="sum">Итого: ${html(money(invoice.total_amount))}</div>
    <script>window.onload=()=>window.print()<\/script></body></html>`)
  popup.document.close()
}

export default function PharmaciesPage() {
  const { role } = useCurrentUser()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [invoicePharmacy, setInvoicePharmacy] = useState(null)

  const { data: rows = [], isLoading } = usePharmacies()
  const { data: dashboard = {} } = usePharmacyDashboard()
  const filtered = useMemo(() => rows.filter(row => {
    const text = `${row.name} ${row.address} ${row.responsible_seller_name}`.toLowerCase()
    return text.includes(search.toLowerCase()) && (!status || row.status === status)
  }), [rows, search, status])

  function exportExcel() {
    const lines = [
      ['Аптека', 'Ответственный', 'Адрес', 'Остаток', 'Выдано', 'Долг', 'Статус'],
      ...filtered.map(row => [row.name, row.responsible_seller_name, row.address, row.stock_quantity, row.issued_amount, row.current_debt, row.status]),
    ]
    const csv = '\uFEFF' + lines.map(line => line.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.download = `apteki-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const title = role === 'seller' ? 'Мои аптеки' : 'Аптеки'
  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">Выдачи, оплаты, возвраты и ответственность продавцов</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={secondary} onClick={exportExcel}><Download size={16} className="mr-2 inline" />Excel</button>
            {(role === 'owner' || role === 'warehouse_manager') && <button className={primary} onClick={() => setCreateOpen(true)}><Plus size={16} className="mr-2 inline" />Добавить аптеку</button>}
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={Building2} label="Активных аптек" value={dashboard.active_pharmacies || 0} tone="indigo" />
          <Kpi icon={Boxes} label="Товар в аптеках" value={`${dashboard.goods_quantity || 0} шт.`} tone="blue" />
          <Kpi icon={CircleDollarSign} label="Общая сумма долга" value={money(dashboard.total_debt)} tone="rose" />
          <Kpi icon={WalletCards} label="Оплачено за 30 дней" value={money(dashboard.paid_in_period)} tone="emerald" />
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3 text-slate-400" size={18} />
            <input className={`${field} pl-10`} placeholder="Поиск по аптеке, адресу или продавцу" value={search} onChange={e => setSearch(e.target.value)} />
          </label>
          <select className={`${field} sm:w-52`} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Все статусы</option>
            <option value="no_debt">Нет долга</option>
            <option value="has_debt">Есть долг</option>
          </select>
        </div>

        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
          <div className="hidden grid-cols-[1.5fr_1.1fr_.55fr_.75fr_.75fr_44px] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
            <span>Аптека</span><span>Ответственный</span><span>Остаток</span><span>Выдано</span><span>Долг</span><span />
          </div>
          {isLoading ? <div className="p-10 text-center text-sm text-slate-500">Загрузка…</div>
            : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Аптеки не найдены</div>
              : filtered.map(row => (
                <button key={row.id} onClick={() => setSelectedId(row.id)} className="grid w-full gap-3 border-b border-slate-100 px-5 py-4 text-left last:border-0 hover:bg-slate-50 lg:grid-cols-[1.5fr_1.1fr_.55fr_.75fr_.75fr_44px] lg:items-center lg:gap-4">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-slate-900">{row.name}<DebtBadge status={row.status} /></div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-slate-500"><MapPin size={12} />{row.address}</div>
                  </div>
                  <div className="text-sm text-slate-700"><UserRound size={14} className="mr-1 inline text-slate-400" />{row.responsible_seller_name}</div>
                  <Metric label="Остаток" value={`${row.stock_quantity} шт.`} />
                  <Metric label="Выдано" value={money(row.issued_amount)} />
                  <Metric label="Долг" value={money(row.current_debt)} danger={row.current_debt > 0} />
                  <ChevronRight className="hidden text-slate-400 lg:block" />
                </button>
              ))}
        </div>

        <div className="space-y-2.5 lg:hidden">
          {isLoading ? <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[12.5px] text-slate-400">Загрузка…</div>
            : filtered.length === 0 ? <div className="rounded-[18px] border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-[12.5px] text-slate-400">Аптеки не найдены</div>
              : filtered.map(row => (
                <button key={row.id} onClick={() => setSelectedId(row.id)} className="block w-full rounded-[18px] bg-white p-3.5 text-left" style={{ boxShadow: '0 2px 8px rgba(15,23,42,.05)' }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[14px] font-bold text-[#0B1020]">{row.name}</p>
                    <span className="flex-shrink-0"><DebtBadge status={row.status} /></span>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-[12px] text-slate-400"><MapPin size={12} />{row.address}</p>
                  <p className="mt-0.5 text-[12px] text-slate-500">Ответственный: {row.responsible_seller_name}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2.5 text-center">
                    <div><p className="text-[15px] font-extrabold text-[#0B1020]">{row.stock_quantity} шт.</p><p className="mt-0.5 text-[10px] font-semibold text-slate-400">Остаток</p></div>
                    <div><p className="text-[15px] font-extrabold text-slate-700">{money(row.issued_amount)}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-400">Выдано</p></div>
                    <div><p className={`text-[15px] font-extrabold ${row.current_debt > 0 ? 'text-rose-600' : 'text-slate-700'}`}>{money(row.current_debt)}</p><p className="mt-0.5 text-[10px] font-semibold text-slate-400">Долг</p></div>
                  </div>
                </button>
              ))}
        </div>
      </div>

      <PharmacyForm open={createOpen} onClose={() => setCreateOpen(false)} />
      <PharmacyDetail id={selectedId} role={role} onClose={() => setSelectedId(null)} onIssue={pharmacy => setInvoicePharmacy(pharmacy)} />
      <InvoiceForm pharmacy={invoicePharmacy} onClose={() => setInvoicePharmacy(null)} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone }) {
  const colors = { indigo: 'bg-indigo-50 text-indigo-600', blue: 'bg-blue-50 text-blue-600', rose: 'bg-rose-50 text-rose-600', emerald: 'bg-emerald-50 text-emerald-600' }
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${colors[tone]}`}><Icon size={18} /></div>
    <p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
  </div>
}

function DebtBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status === 'has_debt' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
    {status === 'has_debt' ? 'Есть долг' : 'Нет долга'}
  </span>
}

function Metric({ label, value, danger }) {
  return <div><span className="mr-2 text-xs text-slate-400 lg:hidden">{label}</span><span className={`text-sm font-semibold ${danger ? 'text-rose-600' : 'text-slate-800'}`}>{value}</span></div>
}

function PharmacyForm({ open, onClose }) {
  const [form, setForm] = useState({ name: '', address: '', owner_name: '', owner_phone: '', contact_details: '', comment: '', responsible_seller_id: '' })
  const { data: sellers = [] } = useQuery({ queryKey: ['pharmacies', 'seller-options'], queryFn: api.fetchSellerOptions, enabled: open })
  const mutation = usePharmacyMutation(api.createPharmacy)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  async function submit(e) {
    e.preventDefault()
    await mutation.mutateAsync(form)
    setForm({ name: '', address: '', owner_name: '', owner_phone: '', contact_details: '', comment: '', responsible_seller_id: '' })
    onClose()
  }
  return <Modal open={open} onClose={onClose} title="Добавить аптеку" description="Ответственный продавец лично отвечает за долг аптеки." size="lg">
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Input label="Название аптеки" value={form.name} onChange={v => set('name', v)} required />
      <Input label="Адрес" value={form.address} onChange={v => set('address', v)} required />
      <Input label="Владелец аптеки" value={form.owner_name} onChange={v => set('owner_name', v)} required />
      <Input label="Телефон владельца" value={form.owner_phone} onChange={v => set('owner_phone', v)} required />
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">Ответственный продавец
        <SearchableSelect
          className="mt-1"
          options={sellers.map(seller => ({ value: seller.id, label: `${seller.full_name} · ${seller.phone}` }))}
          value={form.responsible_seller_id}
          onChange={value => set('responsible_seller_id', value)}
          placeholder="Выберите продавца"
          required
        />
      </label>
      <Input label="Контактные данные" value={form.contact_details} onChange={v => set('contact_details', v)} />
      <Input label="Комментарий" value={form.comment} onChange={v => set('comment', v)} />
      {mutation.error && <p className="text-sm text-rose-600 sm:col-span-2">{errorText(mutation.error)}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" className={secondary} onClick={onClose}>Отмена</button><button className={primary} disabled={mutation.isPending}>Сохранить</button></div>
    </form>
  </Modal>
}

function Input({ label, value, onChange, required, type = 'text', min }) {
  return <label className="text-sm font-medium text-slate-700">{label}<input className={`${field} mt-1`} type={type} min={min} value={value} onChange={e => onChange(e.target.value)} required={required} /></label>
}

function PharmacyDetail({ id, role, onClose, onIssue }) {
  const { data, isLoading } = usePharmacy(id)
  const [tab, setTab] = useState('products')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const mutation = usePharmacyMutation(async action => {
    if (action.type === 'accept_invoice') return api.acceptPharmacyInvoice(action.id)
    if (action.type === 'reject_invoice') return api.rejectPharmacyInvoice({ id: action.id, reason: action.reason })
    if (action.type === 'confirm_payment') return api.confirmPharmacyPayment(action.id)
    if (action.type === 'reject_payment') return api.rejectPharmacyPayment({ id: action.id, reason: action.reason })
    if (action.type === 'correct_payment') return api.correctPharmacyPayment({ id: action.row.id, payload: action.payload })
    if (action.type === 'process_return') return api.processPharmacyReturn({ id: action.row.id, payload: action.payload })
    if (action.type === 'archive') return api.archivePharmacy(action.id)
  }, id)
  const pharmacy = data?.pharmacy
  const tabs = [['products', 'Товары'], ['invoices', 'Накладные'], ['payments', 'Оплаты'], ['returns', 'Возвраты'], ['history', 'История']]
  const ask = (message, fallback = '') => window.prompt(message, fallback)

  return <Modal open={Boolean(id)} onClose={onClose} title={pharmacy?.name || 'Аптека'} description={pharmacy?.address} size="xl">
    {isLoading || !data ? <div className="py-12 text-center text-sm text-slate-500">Загрузка…</div> : <>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <SmallStat label="Товарный остаток" value={`${pharmacy.stock_quantity} шт.`} />
        <SmallStat label="Текущий долг" value={money(pharmacy.current_debt)} danger />
        <SmallStat label="Выдано" value={money(pharmacy.issued_amount)} />
        <SmallStat label="Кредит" value={money(pharmacy.credit_balance)} />
      </div>
      <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="font-semibold text-slate-800">{pharmacy.responsible_seller_name}</p>
        <p className="mt-1 text-slate-500"><UserRound size={13} className="mr-1 inline" />{pharmacy.owner_name} · <Phone size={13} className="mx-1 inline" />{pharmacy.owner_phone}</p>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(role === 'owner' || role === 'warehouse_manager') && <button className={primary} onClick={() => onIssue(pharmacy)}><PackagePlus size={15} className="mr-1 inline" />Выдать товар</button>}
        {(role === 'owner' || role === 'seller') && <button className={secondary} onClick={() => setPaymentOpen(true)}><Banknote size={15} className="mr-1 inline" />Добавить оплату</button>}
        {(role === 'owner' || role === 'seller') && <button className={secondary} onClick={() => setReturnOpen(true)}><Undo2 size={15} className="mr-1 inline" />Запрос возврата</button>}
        <button className={secondary} onClick={() => window.print()}><Printer size={15} className="mr-1 inline" />Печать</button>
        {(role === 'owner' || role === 'warehouse_manager') && <button className={secondary} onClick={() => setTransferOpen(true)}><ArrowRightLeft size={15} className="mr-1 inline" />Ответственный</button>}
        {(role === 'owner' || role === 'warehouse_manager') && <button className={secondary} onClick={() => mutation.mutate({ type: 'archive', id: pharmacy.id })}><Archive size={15} className="mr-1 inline" />Архив</button>}
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold ${tab === key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'}`}>{label}</button>)}
      </div>
      {tab === 'products' && <Rows empty="Товаров нет">{data.stock.map(row => <Row key={row.product_id} title={row.product_name} subtitle={row.sku} value={`${row.quantity} шт.`} />)}</Rows>}
      {tab === 'invoices' && <Rows empty="Накладных нет">{data.invoices.map(row => <div key={row.id} className="border-b border-slate-100 py-3 last:border-0">
        <Row title={row.invoice_number} subtitle={date(row.created_at)} value={money(row.total_amount)} status={row.status} />
        <p className="mt-1 text-xs text-slate-500">{row.items?.map(item => `${item.product_name} × ${item.quantity}`).join(', ')}</p>
        <button className={`${secondary} mt-2`} onClick={() => printInvoice(row, pharmacy)}><Printer size={14} className="mr-1 inline" />PDF-накладная</button>
        {role === 'seller' && row.status === 'issued' && <div className="mt-2 flex gap-2"><button className={primary} onClick={() => mutation.mutate({ type: 'accept_invoice', id: row.id })}><Check size={14} className="mr-1 inline" />Принять</button><button className={secondary} onClick={() => { const reason = ask('Причина отклонения'); if (reason) mutation.mutate({ type: 'reject_invoice', id: row.id, reason }) }}><X size={14} className="mr-1 inline" />Отклонить</button></div>}
      </div>)}</Rows>}
      {tab === 'payments' && <Rows empty="Оплат нет">{data.payments.map(row => <div key={row.id} className="border-b border-slate-100 py-3 last:border-0">
        <Row title={row.payment_number} subtitle={`${date(row.created_at)} · ${row.method === 'cash' ? 'Наличные' : 'Безналичные'}`} value={money(row.amount)} status={row.status} />
        {role === 'owner' && row.status === 'pending' && <div className="mt-2 flex gap-2"><button className={primary} onClick={() => mutation.mutate({ type: 'confirm_payment', id: row.id })}>Подтвердить</button><button className={secondary} onClick={() => { const reason = ask('Причина отклонения'); if (reason) mutation.mutate({ type: 'reject_payment', id: row.id, reason }) }}>Отклонить</button></div>}
        {role === 'owner' && (row.status === 'pending' || row.status === 'confirmed') && <button className={`${secondary} mt-2`} onClick={() => {
          const amount = ask('Исправленная сумма', row.amount)
          if (!amount) return
          const method = ask('Способ: cash или cashless', row.method)
          if (!['cash', 'cashless'].includes(method)) return
          const comment = ask('Комментарий', row.comment || '')
          mutation.mutate({ type: 'correct_payment', row, payload: { amount: Number(amount), method, comment } })
        }}>Изменить с сохранением истории</button>}
      </div>)}</Rows>}
      {tab === 'returns' && <Rows empty="Возвратов нет">{data.returns.map(row => <div key={row.id} className="border-b border-slate-100 py-3 last:border-0">
        <Row title={row.return_number} subtitle={`${date(row.created_at)} · ${row.reason}`} value={`${row.items?.reduce((sum, item) => sum + item.requested_quantity, 0)} шт.`} status={row.status} />
        {(role === 'owner' || role === 'warehouse_manager') && row.status === 'requested' && <div className="mt-2 flex gap-2">
          <button className={primary} onClick={() => {
            const items = row.items.map(item => {
              const value = ask(`Фактически принято: ${item.product_name} (запрошено ${item.requested_quantity})`, item.requested_quantity)
              return { item_id: item.id, accepted_quantity: Math.max(0, Math.min(item.requested_quantity, Number(value || 0))) }
            })
            mutation.mutate({ type: 'process_return', row, payload: { items } })
          }}>Зафиксировать приёмку</button>
          <button className={secondary} onClick={() => {
            const reason = ask('Причина отклонения возврата')
            if (reason) mutation.mutate({ type: 'process_return', row, payload: { items: row.items.map(item => ({ item_id: item.id, accepted_quantity: 0 })), rejection_reason: reason } })
          }}>Отклонить</button>
        </div>}
      </div>)}</Rows>}
      {tab === 'history' && <Rows empty="Истории нет">{data.timeline.map(row => <Row key={row.id} title={eventLabel(row.event_type)} subtitle={`${row.actor_name} · ${date(row.created_at)}`} />)}</Rows>}
      {mutation.error && <p className="mt-3 text-sm text-rose-600">{errorText(mutation.error)}</p>}
      <PaymentForm open={paymentOpen} pharmacy={pharmacy} onClose={() => setPaymentOpen(false)} />
      <ReturnForm open={returnOpen} pharmacy={pharmacy} stock={data.stock} onClose={() => setReturnOpen(false)} />
      <TransferForm open={transferOpen} pharmacy={pharmacy} onClose={() => setTransferOpen(false)} />
    </>}
  </Modal>
}

function SmallStat({ label, value, danger }) {
  return <div className="rounded-xl border border-slate-200 p-3"><p className="text-[11px] text-slate-500">{label}</p><p className={`mt-1 font-bold ${danger ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p></div>
}
function Rows({ children, empty }) { return <div>{children?.length ? children : <p className="py-8 text-center text-sm text-slate-500">{empty}</p>}</div> }
function Row({ title, subtitle, value, status }) { return <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800">{title}</p><p className="mt-0.5 text-xs text-slate-500">{subtitle}</p></div><div className="text-right"><p className="text-sm font-semibold text-slate-800">{value}</p>{status && <Status value={status} />}</div></div> }
function Status({ value }) {
  const labels = { issued: 'Выдано', accepted: 'Принято', rejected: 'Отклонено', pending: 'Ожидает', confirmed: 'Подтверждено', requested: 'Запрошено', partially_accepted: 'Частично принято' }
  return <span className="text-[10px] font-semibold text-indigo-600">{labels[value] || value}</span>
}
function eventLabel(value) {
  return ({ pharmacy_created: 'Аптека добавлена', pharmacy_updated: 'Данные аптеки изменены', responsibility_transferred: 'Ответственность передана', invoice_issued: 'Товар выдан', invoice_accepted: 'Накладная принята', invoice_rejected: 'Накладная отклонена', payment_created: 'Оплата добавлена', payment_confirmed: 'Оплата подтверждена', payment_rejected: 'Оплата отклонена', return_requested: 'Создан запрос возврата', return_accepted: 'Возврат принят', return_partially_accepted: 'Возврат принят частично' })[value] || value
}

function InvoiceForm({ pharmacy, onClose }) {
  const { data: products = [] } = useQuery({ queryKey: ['pharmacies', 'product-options'], queryFn: api.fetchProductOptions, enabled: Boolean(pharmacy) })
  const [items, setItems] = useState([{ product_id: '', quantity: 1, discount_amount: 0 }])
  const [comment, setComment] = useState('')
  const mutation = usePharmacyMutation(api.createPharmacyInvoice, pharmacy?.id)
  const update = (index, key, value) => setItems(current => current.map((item, i) => i === index ? { ...item, [key]: value } : item))
  async function submit(e) {
    e.preventDefault()
    await mutation.mutateAsync({ pharmacy_id: pharmacy.id, comment, items: items.map(item => ({ ...item, quantity: Number(item.quantity), discount_amount: Number(item.discount_amount) })) })
    setItems([{ product_id: '', quantity: 1, discount_amount: 0 }]); setComment(''); onClose()
  }
  return <Modal open={Boolean(pharmacy)} onClose={onClose} title="Выдать товар аптеке" description={pharmacy?.name} size="lg">
    <form onSubmit={submit} className="space-y-3">
      {items.map((item, index) => <div key={index} className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_90px_120px_38px]">
        <select className={field} value={item.product_id} onChange={e => update(index, 'product_id', e.target.value)} required><option value="">Выберите товар</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · {money(product.sale_price)}</option>)}</select>
        <input className={field} type="number" min="1" value={item.quantity} onChange={e => update(index, 'quantity', e.target.value)} required />
        <input className={field} type="number" min="0" step="0.01" title="Скидка за единицу" value={item.discount_amount} onChange={e => update(index, 'discount_amount', e.target.value)} />
        <button type="button" className="text-rose-500" onClick={() => setItems(current => current.filter((_, i) => i !== index))}><X /></button>
      </div>)}
      <button type="button" className={secondary} onClick={() => setItems(current => [...current, { product_id: '', quantity: 1, discount_amount: 0 }])}><Plus size={14} className="mr-1 inline" />Добавить товар</button>
      <Input label="Комментарий" value={comment} onChange={setComment} />
      {mutation.error && <p className="text-sm text-rose-600">{errorText(mutation.error)}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Отмена</button><button className={primary} disabled={mutation.isPending}>Оформить накладную</button></div>
    </form>
  </Modal>
}

function PaymentForm({ open, pharmacy, onClose }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [comment, setComment] = useState('')
  const mutation = usePharmacyMutation(api.createPharmacyPayment, pharmacy?.id)
  async function submit(e) {
    e.preventDefault(); await mutation.mutateAsync({ pharmacy_id: pharmacy.id, amount: Number(amount), method, comment }); setAmount(''); setComment(''); onClose()
  }
  return <Modal open={open} onClose={onClose} title="Добавить оплату" description="Оплата продавца ожидает подтверждения владельца.">
    <form onSubmit={submit} className="space-y-4">
      <Input label="Сумма" type="number" min="0.01" value={amount} onChange={setAmount} required />
      <label className="text-sm font-medium text-slate-700">Способ оплаты<select className={`${field} mt-1`} value={method} onChange={e => setMethod(e.target.value)}><option value="cash">Наличные</option><option value="cashless">Безналичные</option></select></label>
      <Input label="Комментарий" value={comment} onChange={setComment} />
      {mutation.error && <p className="text-sm text-rose-600">{errorText(mutation.error)}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Отмена</button><button className={primary}>Добавить</button></div>
    </form>
  </Modal>
}

function ReturnForm({ open, pharmacy, stock, onClose }) {
  const [reason, setReason] = useState('')
  const [items, setItems] = useState({})
  const mutation = usePharmacyMutation(api.createPharmacyReturn, pharmacy?.id)
  async function submit(e) {
    e.preventDefault()
    const selected = Object.entries(items).filter(([, qty]) => Number(qty) > 0).map(([product_id, quantity]) => ({ product_id, quantity: Number(quantity) }))
    await mutation.mutateAsync({ pharmacy_id: pharmacy.id, reason, items: selected }); setReason(''); setItems({}); onClose()
  }
  return <Modal open={open} onClose={onClose} title="Запрос возврата" description="Укажите обязательную причину и количество.">
    <form onSubmit={submit} className="space-y-3">
      <Input label="Причина возврата" value={reason} onChange={setReason} required />
      {stock.map(row => <label key={row.product_id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm"><span>{row.product_name}<small className="block text-slate-500">Доступно: {row.quantity}</small></span><input className="w-24 rounded-lg border border-slate-200 p-2" type="number" min="0" max={row.quantity} value={items[row.product_id] || ''} onChange={e => setItems(current => ({ ...current, [row.product_id]: e.target.value }))} /></label>)}
      {mutation.error && <p className="text-sm text-rose-600">{errorText(mutation.error)}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Отмена</button><button className={primary}>Отправить запрос</button></div>
    </form>
  </Modal>
}

function TransferForm({ open, pharmacy, onClose }) {
  const [sellerId, setSellerId] = useState('')
  const [comment, setComment] = useState('')
  const { data: sellers = [] } = useQuery({ queryKey: ['pharmacies', 'seller-options'], queryFn: api.fetchSellerOptions, enabled: open })
  const mutation = usePharmacyMutation(api.transferPharmacy, pharmacy?.id)
  async function submit(e) {
    e.preventDefault(); await mutation.mutateAsync({ id: pharmacy.id, payload: { seller_id: sellerId, comment } }); setSellerId(''); setComment(''); onClose()
  }
  return <Modal open={open} onClose={onClose} title="Передать ответственность" description="Будущие оплаты будут начисляться новому продавцу. Полная история сохранится.">
    <form onSubmit={submit} className="space-y-4">
      <SearchableSelect
        options={sellers.map(s => ({ value: s.id, label: s.full_name }))}
        value={sellerId}
        onChange={setSellerId}
        placeholder="Выберите продавца"
        required
      />
      <Input label="Комментарий" value={comment} onChange={setComment} />
      {mutation.error && <p className="text-sm text-rose-600">{errorText(mutation.error)}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={secondary} onClick={onClose}>Отмена</button><button className={primary}>Передать</button></div>
    </form>
  </Modal>
}
