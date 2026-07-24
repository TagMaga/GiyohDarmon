import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchSalesByProduct } from '../api'

export default function useSalesReport(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.salesReport(params),
    queryFn: () => fetchSalesByProduct(params),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}
