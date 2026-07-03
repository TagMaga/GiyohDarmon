import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchPayables } from '../../../shared/api/payoutsApi'

/**
 * usePayables — the Team Lead "Кому выплатить" list + hero numbers.
 * Backs both TeamLeadTeamPage (per-member stats) and TeamLeadFinancePage
 * (hero + bulk payout) — one server-computed source of truth so the two
 * screens never disagree on "how much is owed to X."
 *
 * @param {string} teamLeadId
 * @param {object} params  { from?, to? }
 */
export default function usePayables(teamLeadId, params = {}) {
  return useQuery({
    queryKey: KEYS.payouts.payables(teamLeadId, params),
    queryFn:  () => fetchPayables(teamLeadId, params),
    staleTime: 30_000,
    enabled:  !!teamLeadId,
  })
}
