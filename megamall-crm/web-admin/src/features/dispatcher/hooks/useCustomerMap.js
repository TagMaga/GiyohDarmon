import { useQueries } from '@tanstack/react-query'
import { useMemo }    from 'react'
import { KEYS }       from '../../../shared/queryKeys'
import { fetchCustomerById } from '../api'

/**
 * useCustomerMap
 *
 * Given an array of orders (which may only have customer_id, not a customer
 * object), fetches the missing customer details in parallel and returns a
 * lookup map: { [customerId]: customerObject }.
 *
 * Each individual request is cached via TanStack Query with key
 * customers.byId(id) — so repeated renders and navigation do NOT re-fetch.
 *
 * Usage:
 *   const customerMap = useCustomerMap(orders)
 *   const customer    = order.customer ?? customerMap[order.customer_id]
 */
export default function useCustomerMap(orders = []) {
  // Collect unique customer IDs that don't already have an embedded object
  const ids = useMemo(() => {
    const set = new Set()
    for (const o of orders) {
      if (!o.customer && o.customer_id) {
        set.add(o.customer_id)
      }
    }
    return Array.from(set)
  }, [orders])

  // Fire one query per missing customer ID — all in parallel
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: KEYS.customers.byId(id),
      queryFn:  () => fetchCustomerById(id),
      staleTime: 10 * 60_000, // customer data rarely changes — cache 10 min
      retry: false,            // don't hammer if 404
    })),
  })

  // Build the map
  const customerMap = useMemo(() => {
    const map = {}
    ids.forEach((id, i) => {
      const data = results[i]?.data
      if (data) map[id] = data
    })
    return map
  }, [ids, results])

  return customerMap
}
