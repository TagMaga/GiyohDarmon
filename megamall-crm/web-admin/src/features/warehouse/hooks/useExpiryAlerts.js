import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchExpiryAlerts } from '../api'

// useExpiryAlerts polls active batch expiry warnings — refetches every 60s
// so the notification bell stays live without the user having to refresh.
// Only owner/warehouse_manager can call the endpoint; pass enabled:false for
// other roles.
export default function useExpiryAlerts(options = {}) {
  const query = useQuery({
    queryKey: KEYS.warehouse.expiryAlerts,
    queryFn: fetchExpiryAlerts,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: options.enabled ?? true,
  })

  return {
    alerts: query.data?.alerts ?? [],
    meta: query.data?.meta ?? { total: 0, expired_count: 0, expired_units: 0, expiring_count: 0, expiring_units: 0 },
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}
