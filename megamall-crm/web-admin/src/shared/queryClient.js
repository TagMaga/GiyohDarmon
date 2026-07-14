import { QueryClient } from '@tanstack/react-query'

/**
 * Single shared QueryClient instance.
 *
 * Exported (not just created inside Providers) so auth code can call
 * `queryClient.clear()` on login/logout — the client persists for the
 * lifetime of the tab, so without an explicit clear, cached responses
 * (e.g. `seller.me`) from a previous account would keep rendering after
 * a different account logs in.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error?.response?.status
        if (status === 401 || status === 403 || status === 429) return false
        return failureCount < 1
      },
      staleTime: 60_000,
    },
  },
})
