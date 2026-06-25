import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { addOrderComment, fetchOrderComments } from '../api/comments'

export function useOrderComments(orderId, options = {}) {
  return useQuery({
    queryKey: KEYS.orders.comments(orderId),
    queryFn:  () => fetchOrderComments(orderId),
    enabled:  Boolean(orderId) && (options.enabled ?? true),
    staleTime: 30 * 1000,
  })
}

export function useAddOrderComment(orderId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comment) => addOrderComment(orderId, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.orders.comments(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.seller.orderComments(orderId) })
      qc.invalidateQueries({ queryKey: KEYS.dispatcher.comments(orderId) })
    },
  })
}
