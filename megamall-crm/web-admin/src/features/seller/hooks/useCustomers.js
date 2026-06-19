import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchCustomers } from '../api'

function toArray(data) {
  if (Array.isArray(data))       return data
  if (Array.isArray(data?.data)) return data.data
  return []
}

export default function useCustomers() {
  return useQuery({
    queryKey: KEYS.seller.customers,
    queryFn:  () => fetchCustomers().then(toArray),
    staleTime: 5 * 60_000,
  })
}
