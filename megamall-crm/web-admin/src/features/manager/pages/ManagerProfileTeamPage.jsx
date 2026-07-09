import { Link } from 'react-router-dom'
import { ChevronRight, Phone } from 'lucide-react'
import EmptyState from '../../../shared/components/EmptyState'
import useMyManagerTeam from '../hooks/useMyManagerTeam'
import useTeamMembers from '../../people/hooks/useTeamMembers'
import useEmployeesByIds from '../../people/hooks/useEmployeesByIds'
import { buildUserMap } from '../../people/utils/peopleHelpers'
import { M, Card, InitialsAvatar, SectionLabel } from '../../seller/components/mobileUi'

function normalizeUser(user) {
  if (!user) return null
  return {
    id: user.id ?? user.ID,
    full_name: user.full_name ?? user.FullName ?? user.name ?? 'Участник',
    phone: user.phone ?? user.Phone ?? '',
    role: user.role ?? user.Role ?? '',
  }
}

function roleLabel(role) {
  if (role === 'sales_team_lead') return 'Тимлид продавцов'
  if (role === 'manager') return 'Менеджер'
  return 'Продавец'
}

function CallButton({ phone, size = 32 }) {
  const content = (
    <span
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: 10, background: '#F0EFEA', color: '#76766E' }}
    >
      <Phone size={size <= 30 ? 14 : 15} />
    </span>
  )

  if (!phone) return content
  return (
    <a href={`tel:${phone}`} aria-label={`Позвонить ${phone}`} className="inline-flex">
      {content}
    </a>
  )
}

function PersonCard({ person, palette = 0 }) {
  return (
    <Card style={{ borderRadius: 16, padding: '16px 18px' }} className="flex items-center gap-[14px]">
      <InitialsAvatar name={person.full_name} size={48} palette={palette} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>{person.full_name}</div>
        <div className="truncate" style={{ fontSize: 12.5, color: M.muted, marginTop: 1 }}>{roleLabel(person.role)}</div>
      </div>
      <CallButton phone={person.phone} />
    </Card>
  )
}

function SellerRow({ seller, index }) {
  return (
    <div
      className="grid items-center"
      style={{
        gridTemplateColumns: 'minmax(0,1fr) 160px 80px',
        padding: '12px 20px',
        borderBottom: `1px solid ${M.bg}`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <InitialsAvatar name={seller.full_name} size={36} palette={index} />
        <span className="truncate" style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>{seller.full_name}</span>
      </div>
      <div style={{ fontSize: 13.5, color: '#76766E', fontWeight: 500 }}>{roleLabel(seller.role)}</div>
      <div className="flex justify-end">
        <CallButton phone={seller.phone} size={30} />
      </div>
    </div>
  )
}

function MobileSellerRow({ seller, index }) {
  return (
    <div className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: `1px solid ${M.bg}` }}>
      <InitialsAvatar name={seller.full_name} size={36} palette={index} />
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{seller.full_name}</div>
        <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{roleLabel(seller.role)}</div>
      </div>
      <CallButton phone={seller.phone} />
    </div>
  )
}

export default function ManagerProfileTeamPage() {
  const { team, teamId, isLoading: teamLoading } = useMyManagerTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const teamLeadId = team?.team_lead_id ?? team?.TeamLeadID
  const memberIds = members.map(m => m.user_id ?? m.UserID).filter(Boolean)
  const employeeIds = [...new Set([teamLeadId, ...memberIds].filter(Boolean))]
  const { data: employees = [] } = useEmployeesByIds(employeeIds)
  const userMap = buildUserMap(employees)

  const teamLead = normalizeUser(userMap[teamLeadId])
  const sellers = members
    .map(member => normalizeUser(userMap[member.user_id ?? member.UserID]))
    .filter(user => user && user.role === 'seller')

  const loading = teamLoading || membersLoading
  const count = sellers.length + (teamLead ? 1 : 0)

  return (
    <div style={{ fontFamily: M.font, color: M.ink }} className="lg:p-[36px_44px]">
      <div className="hidden lg:flex items-center gap-3">
        <Link
          to="/manager/profile"
          aria-label="Назад к профилю"
          className="inline-flex items-center justify-center"
          style={{ width: 34, height: 34, borderRadius: 12, background: '#fff', border: `1px solid ${M.borderAlt}`, color: M.indigoDeep }}
        >
          <ChevronRight size={16} className="rotate-180" />
        </Link>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Моя команда</h1>
        <span style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>{loading ? '...' : `${count} участников`}</span>
      </div>

      <div className="lg:hidden flex items-center gap-2">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' }}>Моя команда</h1>
        <span style={{ fontSize: 12, color: M.muted, fontWeight: 600 }}>{loading ? '...' : count}</span>
      </div>

      {loading ? (
        <div className="space-y-3" style={{ marginTop: 20 }}>
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-white/70 animate-pulse" />)}
        </div>
      ) : !team ? (
        <div style={{ marginTop: 20 }}>
          <EmptyState title="Команда не назначена" description="Когда вас назначат в команду, состав появится здесь." />
        </div>
      ) : (
        <>
          <SectionLabel style={{ margin: '24px 4px 10px' }}>Руководство</SectionLabel>
          {teamLead ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[14px]">
              <PersonCard person={teamLead} palette={1} />
            </div>
          ) : (
            <Card style={{ borderRadius: 16, padding: '18px 20px', color: M.muted, fontSize: 13 }}>
              Тимлид пока не назначен
            </Card>
          )}

          <SectionLabel style={{ margin: '22px 4px 10px' }}>Продавцы на участке · {sellers.length}</SectionLabel>
          {sellers.length === 0 ? (
            <Card style={{ borderRadius: 16, padding: '18px 20px', color: M.muted, fontSize: 13 }}>
              Продавцы пока не назначены
            </Card>
          ) : (
            <>
              <Card className="hidden lg:block overflow-hidden" style={{ borderRadius: 16 }}>
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: 'minmax(0,1fr) 160px 80px',
                    padding: '13px 20px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: M.muted,
                    letterSpacing: '.03em',
                    textTransform: 'uppercase',
                    borderBottom: `1px solid ${M.bg}`,
                  }}
                >
                  <div>Имя</div>
                  <div>Роль</div>
                  <div style={{ textAlign: 'right' }}>Контакт</div>
                </div>
                {sellers.map((seller, index) => <SellerRow key={seller.id ?? index} seller={seller} index={index} />)}
              </Card>

              <Card className="lg:hidden" style={{ borderRadius: 16, padding: '2px 15px' }}>
                {sellers.map((seller, index) => <MobileSellerRow key={seller.id ?? index} seller={seller} index={index} />)}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}
