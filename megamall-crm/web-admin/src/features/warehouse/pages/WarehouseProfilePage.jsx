import { LogOut, Phone, Shield, User2 } from 'lucide-react'
import Button from '../../../shared/components/Button'
import useProfile from '../../../shared/hooks/useProfile'
import useAuthStore from '../../../shared/store/authStore'

export default function WarehouseProfilePage() {
  const { fullName, initials, phone } = useProfile()
  const clearAuth = useAuthStore((s) => s.clearAuth)

  return (
    <div className="p-6 pb-28">
      <div className="mx-auto max-w-2xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-black text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black text-slate-950">{fullName ?? phone ?? 'Пользователь'}</h1>
              <p className="mt-1 text-sm text-slate-500">Профиль кладовщика</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)]">
          <InfoRow icon={<User2 size={16} />} label="Имя" value={fullName ?? '—'} />
          <div className="my-3 h-px bg-slate-100" />
          <InfoRow icon={<Phone size={16} />} label="Телефон" value={phone ? <a className="text-indigo-600" href={`tel:${phone}`}>{phone}</a> : '—'} />
          <div className="my-3 h-px bg-slate-100" />
          <InfoRow icon={<Shield size={16} />} label="Роль" value={<span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">Склад</span>} />
        </section>

        <Button variant="danger" fullWidth icon={<LogOut size={16} />} onClick={clearAuth}>
          Выйти из системы
        </Button>
      </div>
    </div>
  )
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2 text-slate-500">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-right text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
