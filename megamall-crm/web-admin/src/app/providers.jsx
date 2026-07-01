import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ToastProvider from '../shared/components/ToastProvider'

/**
 * Global providers wrapper.
 *
 * Zustand stores are self-contained (no Provider needed).
 * TanStack Query + Toast context are wired here.
 */
const queryClient = new QueryClient({
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

export default function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  )
}
