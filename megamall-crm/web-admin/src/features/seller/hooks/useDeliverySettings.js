import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchDeliverySettings } from '../api'

export default function useDeliverySettings() {
  return useQuery({
    queryKey: KEYS.settings.delivery,
    queryFn: fetchDeliverySettings,
    staleTime: 5 * 60 * 1000,
  })
}
