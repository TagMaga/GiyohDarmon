/**
 * CashCenterTab — Owner Logistics → "Передачи кассы" tab.
 *
 * Mirrors the dispatcher panel's Касса page, reusing its exact handover
 * data so behavior stays identical — only the chrome is restyled to the
 * new design language. The "Сдачи" view keeps
 * the richer owner-only verification flow (receipts, admin_note, delete)
 * that already exists here, since it's a superset of the dispatcher's view.
 */
import CashHandoversPage from './CashHandoversPage'
import DispatcherSettlementsPanel from './DispatcherSettlementsPanel'

export default function CashCenterTab() {
  return (
    <div className="space-y-6">
      <DispatcherSettlementsPanel />
      <CashHandoversPage />
    </div>
  )
}
