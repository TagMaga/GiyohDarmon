/**
 * useCashLedger — merges the two cash-movement sources (courier→dispatcher
 * cash_handovers and dispatcher→company dispatcher_settlements) into one
 * list, sorted by date, for the owner logistics cash tab's unified table.
 * Each source keeps its own backend query/filters (date range, status);
 * sender/receiver name and amount-range are applied client-side over the
 * merged result since they're cheap substring/number checks and the two
 * sources don't share a name column to filter on server-side.
 */
import { useMemo } from 'react'
import { useHandovers } from './useHandovers'
import { useSettlements } from './useDispatcherSettlements'

// For confirmed rows the counterpart always accepted the transfer, so fall
// back to the declared/expected amount when no explicit actual was set —
// mirrors CashHandoversPage's displayActual and DispatcherSettlementsPanel's
// equivalent.
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
    comment: h.comment,
    adminNote: h.admin_note,
    rejectionReason: h.status === 'rejected' ? h.admin_note : null,
    raw: h,
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
    comment: s.comment,
    adminNote: s.admin_note,
    rejectionReason: s.rejection_reason,
    raw: s,
  }
}

export function useCashLedger({
  from, to, status, dispatcherId,
  senderQuery, receiverQuery, amountMin, amountMax,
} = {}) {
  const handoverParams = {
    limit: 200,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(status ? { status } : {}),
  }
  const settlementParams = {
    limit: 200,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(status ? { status } : {}),
    ...(dispatcherId ? { dispatcher_id: dispatcherId } : {}),
  }

  const handoversQuery = useHandovers(handoverParams)
  const settlementsQuery = useSettlements(settlementParams)

  const rows = useMemo(() => {
    const handovers = (handoversQuery.data?.items ?? []).map(normalizeHandover)
    const settlements = (settlementsQuery.data?.items ?? []).map(normalizeSettlement)
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
