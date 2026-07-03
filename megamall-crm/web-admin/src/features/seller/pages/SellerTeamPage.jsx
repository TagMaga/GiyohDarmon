import { Trophy, Phone, Users } from 'lucide-react'
import { useSellerTeamRank, useMyTeam } from '../hooks/useSellerMe'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import { M, Card, SectionLabel, InitialsAvatar } from '../components/mobileUi'

const ROLE_LABEL = {
  manager:         'Ваш менеджер',
  sales_team_lead: 'Тимлид продавцов',
  seller:          'Продавец',
  owner:           'Владелец',
}

function CallButton({ phone }) {
  if (!phone) return null
  return (
    <a
      href={`tel:${phone}`}
      className="flex items-center justify-center flex-shrink-0 active:scale-95 transition-transform"
      style={{ width: 32, height: 32, borderRadius: 10, background: '#F0EFEA', color: '#76766E' }}
    >
      <Phone size={15} />
    </a>
  )
}

export default function SellerTeamPage() {
  const { data: rankData, isLoading: rankLoading } = useSellerTeamRank()
  const { data: myTeam, isLoading: teamLoading, isError } = useMyTeam()
  const { userId } = useCurrentUser()

  const isLoading = rankLoading || teamLoading

  if (isLoading) {
    return (
      <div className="space-y-3" style={{ fontFamily: M.font }}>
        <Card className="h-28 animate-pulse" />
        <Card className="h-40 animate-pulse" />
      </div>
    )
  }

  const rank = rankData?.rank ?? null
  const totalMembers = rankData?.total_members ?? null
  const leadership = isError ? [] : [myTeam?.manager, myTeam?.team_lead].filter(Boolean)
  const members = isError ? [] : (myTeam?.members ?? [])

  if (!leadership.length && !members.length && rank === null) {
    return (
      <Card className="p-10 text-center" style={{ fontFamily: M.font }}>
        <Users size={30} className="mx-auto mb-3" style={{ color: M.borderAlt }} />
        <p style={{ fontSize: 13, color: M.muted, margin: 0 }}>Вы пока не состоите в команде</p>
      </Card>
    )
  }

  return (
    <div style={{ fontFamily: M.font }}>
      {/* Header */}
      <div className="flex items-baseline gap-2" style={{ marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: 0 }}>Моя команда</h1>
        {myTeam && (
          <span style={{ fontSize: 12, color: M.muted, fontWeight: 500 }}>
            {leadership.length + members.length} участников
          </span>
        )}
      </div>

      {/* Own rank card */}
      {rank !== null && (
        <Card className="flex items-center gap-3" style={{ padding: '14px 15px', marginBottom: 18 }}>
          <div className="flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42, borderRadius: 12, background: M.amberBg, color: '#D97706' }}>
            <Trophy size={19} />
          </div>
          <div className="flex-1">
            <div style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>
              Вы #{rank} в команде{totalMembers ? ` из ${totalMembers}` : ''}
            </div>
            <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>
              Рейтинг по чистой выручке за текущий месяц
            </div>
          </div>
        </Card>
      )}

      {/* Leadership */}
      {leadership.length > 0 && (
        <>
          <SectionLabel style={{ margin: '0 4px 10px' }}>Руководство</SectionLabel>
          <Card className="overflow-hidden" style={{ marginBottom: 18 }}>
            {leadership.map((p, i) => (
              <div
                key={p.id}
                className="flex items-center gap-3"
                style={{ padding: '14px 15px', borderBottom: i < leadership.length - 1 ? `1px solid ${M.bg}` : 'none' }}
              >
                <InitialsAvatar name={p.full_name} size={42} palette={i + 1} />
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>{p.full_name}</div>
                  <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{ROLE_LABEL[p.role] ?? p.role}</div>
                </div>
                <CallButton phone={p.phone} />
              </div>
            ))}
          </Card>
        </>
      )}

      {/* Sellers */}
      {members.length > 0 && (
        <>
          <SectionLabel style={{ margin: '0 4px 10px' }}>Продавцы на участке · {members.length}</SectionLabel>
          <Card className="overflow-hidden" style={{ marginBottom: 14 }}>
            {members.map((p, i) => {
              const isMe = p.id === userId
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3"
                  style={{ padding: '13px 15px', borderBottom: i < members.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                >
                  <InitialsAvatar name={p.full_name} size={36} palette={i} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{p.full_name}</span>
                      {isMe && (
                        <span className="flex-shrink-0" style={{ fontSize: 10, fontWeight: 700, color: M.indigoDeep, background: M.indigoBg, padding: '2px 7px', borderRadius: 6 }}>
                          Вы
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{ROLE_LABEL[p.role] ?? p.role}</div>
                  </div>
                  {!isMe && <CallButton phone={p.phone} />}
                </div>
              )
            })}
          </Card>
        </>
      )}
    </div>
  )
}
