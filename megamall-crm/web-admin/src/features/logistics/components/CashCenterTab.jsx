/**
 * CashCenterTab — Owner Logistics → "Передачи кассы" tab.
 *
 * A single merged ledger of courier→dispatcher cash handovers and
 * dispatcher→company settlements — see CashLedgerPanel.
 */
import CashLedgerPanel from './CashLedgerPanel'

export default function CashCenterTab() {
  return (
    <div className="space-y-4">
      <CashLedgerPanel />
    </div>
  )
}
