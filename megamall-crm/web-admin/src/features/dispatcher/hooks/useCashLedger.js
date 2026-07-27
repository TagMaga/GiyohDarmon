/**
 * useCashLedger (dispatcher) — same merged ledger as the owner logistics
 * cash tab (see features/logistics/hooks/useCashLedger.js), reused here:
 * courier→dispatcher handovers are system-wide (any dispatcher can act on
 * any courier's handover — see internal/dispatch.ListAllHandovers), so this
 * pulls the same enriched projection as the owner view (now readable by
 * the dispatcher role too, internal/logistics/routes.go) plus this
 * dispatcher's own settlements to the company (already owner_name-enriched
 * by the backend). Read-only here — no confirm/reject/edit, only the owner
 * decides those; see CompanySettlementTab.
 */
import { useMemo } from 'react'
import { useHandovers } from '../../logistics/hooks/useHandovers'
import { useMySettlements } from './useCompanySettlement'

function displayActual(status, actual, expected) {
  return status === 'confirmed' ? (actual ?? expected) : actual
}

function normalizeHandover(h) {
  return {
    id: h.id,
    source: 'handover',
    date: h.created_at,
    senderName: h.courier_name,
    senderRole: 'courier',
    receiverName: h.dispatcher_name || null,
    receiverRole: 'dispatcher',
    expected: h.total_to_return,
    sent: displayActual(h.status, h.actual_returned, h.total_to_return),
    currentDebt: h.courier_debt_after,
    mediaAssets: h.media_assets ?? [],
    status: h.status,
    rejectionReason: h.status === 'rejected' ? h.admin_note : null,
  }
}

function normalizeSettlement(s) {
  return {
    id: s.id,
    source: 'settlement',
    date: s.created_at,
    senderName: s.dispatcher_name,
    senderRole: 'dispatcher',
    receiverName: s.owner_name,
    receiverRole: 'company',
    expected: s.amount,
    sent: displayActual(s.status, s.actual_received, s.amount),
    currentDebt: s.current_debt,
    mediaAssets: s.media_assets ?? [],
    status: s.status,
    rejectionReason: s.rejection_reason,
  }
}

export function useCashLedger({
  from, to, status, senderQuery, receiverQuery, amountMin, amountMax,
} = {}) {
  const handoverParams = {
    limit: 200,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(status ? { status } : {}),
  }

  const handoversQuery = useHandovers(handoverParams)
  const settlementsQuery = useMySettlements()

  const rows = useMemo(() => {
    const handovers = (handoversQuery.data?.items ?? []).map(normalizeHandover)
    const settlements = (settlementsQuery.data?.data ?? []).map(normalizeSettlement)
    let merged = [...handovers, ...settlements]
    merged.sort((a, b) => new Date(b.date) - new Date(a.date))

    if (senderQuery?.trim()) {
      const q = senderQuery.trim().toLowerCase()
      merged = merged.filter((r) => r.senderName?.toLowerCase().includes(q))
    }
    if (receiverQuery?.trim()) {
      const q = receiverQuery.trim().toLowerCase()
      merged = merged.filter((r) => (r.receiverName ?? '').toLowerCase().includes(q))
    }
    if (amountMin != null && amountMin !== '') {
      merged = merged.filter((r) => r.expected >= Number(amountMin))
    }
    if (amountMax != null && amountMax !== '') {
      merged = merged.filter((r) => r.expected <= Number(amountMax))
    }
    return merged
  }, [handoversQuery.data, settlementsQuery.data, senderQuery, receiverQuery, amountMin, amountMax])

  return {
    rows,
    isLoading: handoversQuery.isLoading || settlementsQuery.isLoading,
  }
}
