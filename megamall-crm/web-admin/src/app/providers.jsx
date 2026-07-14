import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../shared/queryClient'
import ToastProvider from '../shared/components/ToastProvider'

/**
 * Global providers wrapper.
 *
 * Zustand stores are self-contained (no Provider needed).
 * TanStack Query + Toast context are wired here.
 */

export default function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </QueryClientProvider>
  )
}
