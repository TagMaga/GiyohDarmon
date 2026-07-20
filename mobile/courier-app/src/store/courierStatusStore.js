import { create } from 'zustand'

// Shared online/offline presence toggle — the Dashboard "На линии" pill sets
// it, and the Profile screen's status pill reads it, so both surfaces show
// the same state instead of Profile's badge being hardcoded independently.
const useCourierStatusStore = create((set) => ({
  isOnline: true,
  setOnline: (isOnline) => set({ isOnline }),
}))

export default useCourierStatusStore
