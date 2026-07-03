import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS }         from '../../../shared/queryKeys'
import { createPayouts } from '../../../shared/api/payoutsApi'

/**
 * useCreatePayouts — the bulk "Выплатить" mutation on TeamLeadFinancePage.
 * Invalidates the payables list (so remaining/earned refresh) on success.
 */
export default function useCreatePayouts(teamLeadId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createPayouts,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts', 'payables', teamLeadId] })
    },
  })
}
