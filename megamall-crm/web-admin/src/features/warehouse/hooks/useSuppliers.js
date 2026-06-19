import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchSuppliers } from '../api'

export default function useSuppliers() {
  return useQuery({
    queryKey: KEYS.warehouse.suppliers,
    queryFn: fetchSuppliers,
    staleTime: 10 * 60_000,
  })
}
