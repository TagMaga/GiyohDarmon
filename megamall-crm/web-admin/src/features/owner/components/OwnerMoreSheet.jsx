import { Link } from 'react-router-dom'
import { Wallet, Truck, User, Settings } from 'lucide-react'
import Modal from '../../../shared/components/Modal'

const OWNER_MORE_LINKS = [
  { label: 'Бюджет',    icon: Wallet,   path: '/owner/budget'    },
  { label: 'Логистика', icon: Truck,    path: '/owner/logistics' },
  { label: 'HR',        icon: User,     path: '/owner/team-directory' },
  { label: 'Настройки', icon: Settings, path: '/owner/settings'  },
]

export default function OwnerMoreSheet({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Все разделы" size="sm">
      <div className="grid grid-cols-4 gap-2">
        {OWNER_MORE_LINKS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={onClose}
            className="flex flex-col items-center gap-2 rounded-2xl px-1 py-2.5 text-center min-h-[44px] hover:bg-slate-50 transition-colors"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <item.icon size={21} strokeWidth={2} />
            </span>
            <span className="text-[11px] font-semibold text-slate-700">{item.label}</span>
          </Link>
        ))}
      </div>
    </Modal>
  )
}
