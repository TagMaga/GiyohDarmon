import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCategories } from '../api'

export default function useCategories() {
  return useQuery({
    queryKey: KEYS.warehouse.categories,
    queryFn: fetchCategories,
    staleTime: 10 * 60_000,
  })
}
