import { useQuery } from '@tanstack/react-query'
import { fetchCities } from '../api'

// Active delivery cities for the order form city selector.
export default function useCities() {
  return useQuery({
    queryKey: ['cities', 'active'],
    queryFn: fetchCities,
    staleTime: 5 * 60 * 1000,
  })
}
