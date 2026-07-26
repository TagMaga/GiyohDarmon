# Staging Validation Checklist

**Freeze point:** commit `1225768` on `claude/complete-e2e-security-audit-1rl7kl`
**Status:** READY FOR STAGING (not Production — see `FINAL_PRODUCTION_AUDIT.md`)
**Purpose:** Manual, human-executed verification after deploying the freeze point to staging. This is not a substitute for the automated test suite (`internal/budget`, `internal/courier`, `internal/payouts`, `internal/uploads` — all passing with `-race` at freeze) — it exists to catch anything only observable through the real HTTP/UI/DB stack: RBAC wiring, response envelopes, timing in a real (not disposable) database, and the frontend's actual behavior.

**How to use this document:** Work through items in order. For every item, record actual result next to "Expected result," not just pass/fail. Any item marked **BLOCKER** that fails must stop the staging→production promotion until root-caused — do not re-run and hope it passes the second time; a race condition that "sometimes" fails is the failure.

**Conventions:**
- `owner`, `dispatcher`, `courier`, etc. below refer to the role required to be logged in as when performing that step.
- All amounts are TJS ("с" in the UI). Use round test numbers so DB verification is easy to eyeball.
- "DB records to verify" assumes `psql` or equivalent read access to the staging database.

---

## 1. Create a budget top-up

**Who:** Owner
**Steps:**
1. Log in as owner, go to Company Budget (`/owner/budget`).
2. Note current balance (call it `B0`).
3. Click "Пополнение" → amount `1000`, note `staging-check-topup-1` → Сохранить.

**Expected result:** Success toast; modal closes; dashboard balance updates to `B0 + 1000`.
**DB records to verify:**
```sql
SELECT id, transaction_type, amount, note, balance_after, created_by
FROM company_budget_transactions
WHERE note = 'staging-check-topup-1';
-- transaction_type = 'manual_income', amount = 1000.00
```
**Log entries to verify:** None required (top-up creation has no dedicated audit-log entry beyond the ledger row itself).
**Blocker if:** Row not created; `balance_after` inconsistent with `B0 + 1000`; balance shown in UI doesn't match `GET /owner/budget/summary`.

---

## 2. Edit a budget top-up

**Who:** Owner
**Steps:**
1. Using the row from #1, click it → Редактировать.
2. Change amount `1000` → `1500`, save.
3. Repeat, changing amount `1500` → `0`. Expect rejection (see below) before proceeding.

**Expected result:** Amount change to 1500 succeeds, balance increases by 500 more (total `B0 + 1500`). The edit-to-`0` attempt is **rejected client-side and server-side** with a clear "amount must be greater than zero" message; balance unchanged; modal stays open.
**DB records to verify:**
```sql
SELECT amount, balance_after FROM company_budget_transactions WHERE note = 'staging-check-topup-1';
-- amount = 1500.00

SELECT old_amount, new_amount FROM record_edits
WHERE subject_type = 'budget_transaction' AND subject_id = '<the row id>'
ORDER BY edited_at;
-- one row: old_amount=1000.00, new_amount=1500.00 (the rejected zero-edit must NOT appear here)
```
**Log entries to verify:** `record_edits` row above is itself the audit log for this action — confirm exactly one row, not two (the rejected attempt must leave none).
**Blocker if:** The zero-amount edit succeeds (invariant violation — this is the exact class of bug fixed in this session); `record_edits` has a row for the rejected attempt; balance changes as a side effect of the rejected attempt.

---

## 3. Create an owner withdrawal

**Who:** Owner
**Steps:**
1. Note current balance `B1`.
2. Click "Списание" → amount `200`, note `staging-check-withdrawal-1` → Сохранить.
3. Attempt a withdrawal larger than the current balance (e.g. current balance + 100,000). Expect rejection.

**Expected result:** Successful withdrawal reduces balance by exactly 200. The over-balance withdrawal is rejected with "insufficient balance," balance unchanged, modal stays open showing the error.
**DB records to verify:**
```sql
SELECT amount, balance_after FROM company_budget_transactions WHERE note = 'staging-check-withdrawal-1';
-- transaction_type='owner_withdrawal', amount=200.00
```
**Log entries to verify:** None beyond the ledger row.
**Blocker if:** Over-balance withdrawal succeeds; balance goes negative at any point.

---

## 4. Edit an owner withdrawal

**Who:** Owner
**Steps:**
1. Using the row from #3, edit amount `200` → `50` (a decrease). Confirm balance increases by 150 relative to after step 3.
2. Edit the same row `50` → an amount larger than the current available balance. Expect rejection.
3. Edit the same row `50` → `-10` (negative). Expect rejection (client should block this before it even reaches the server, but verify the server also rejects it if you bypass the UI, e.g. via browser devtools/curl with a valid session token).

**Expected result:** Step 1 succeeds and balance reflects the smaller withdrawal. Steps 2 and 3 are both rejected with clear messages; balance never changes on a rejected edit.
**DB records to verify:**
```sql
SELECT amount FROM company_budget_transactions WHERE note = 'staging-check-withdrawal-1';
-- 50.00 after step 1, unchanged after steps 2/3

SELECT old_amount, new_amount FROM record_edits
WHERE subject_type='budget_transaction' AND subject_id = '<row id>' ORDER BY edited_at;
-- exactly one successful edit (200 -> 50); no rows for the two rejected attempts
```
**Blocker if:** **This is the exact bug found and fixed this session** (`UpdateTransaction` previously had zero balance validation). Any successful edit that produces a negative company balance, or that succeeds despite a zero/negative amount, is an automatic production blocker — stop the promotion immediately and re-open the fix.

---

## 5. Attempt to make the company balance negative

**Who:** Owner (this is the master invariant check — repeat after doing #1-#4 above so the balance is a known, non-trivial number)
**Steps:**
1. Note current balance `B2`.
2. Attempt to withdraw an amount equal to `B2 + 1` (one unit over). Expect rejection.
3. Attempt to edit any existing withdrawal row's amount upward to something that would make the balance negative (e.g. edit a small withdrawal up to `B2 + amount already withdrawn by that row + 1`). Expect rejection.
4. As a final sanity check, query the DB directly for the live balance and confirm it matches what steps 1-3's rejections were computed against:
```sql
-- Manual portion of the ledger
SELECT COALESCE(SUM(CASE WHEN transaction_type='manual_income' THEN amount
                         WHEN transaction_type='owner_withdrawal' THEN -amount ELSE 0 END), 0)
FROM company_budget_transactions;
-- Compare against GET /owner/budget/summary's `balance` field (which also adds live Finance net profit)
```

**Expected result:** Both attempts rejected; balance never goes negative under any UI action.
**Blocker if:** Balance goes negative by **any** amount, via **any** path (create or edit). There is no acceptable "slightly negative, fix it later" outcome here — this is the primary invariant this session's fixes exist to guarantee.

---

## 6. Perform concurrent withdrawal creation and withdrawal editing

**Who:** Owner (or QA engineer with owner credentials + a scripting tool — this is the one item that genuinely benefits from a script rather than two humans clicking fast)
**Steps:**
1. Seed a known balance (e.g. top up to a round number like 10,000 for a clean test).
2. Create one withdrawal of `4000` (note `staging-check-race-target`).
3. Fire two requests as close to simultaneously as possible:
   - **Request A:** `PATCH /owner/budget/transaction/:id` on the `staging-check-race-target` row, editing its amount from 4000 to 7000 (a 3000 increase).
   - **Request B:** `POST /owner/budget/withdrawal` for a brand-new withdrawal of `3000`.
   - Both together would overspend the balance if the concurrency fix weren't in place (4000+3000 already withdrawn, remaining 3000 from a 10,000 balance; both requests' full effect together would require 6000 more, exceeding the 3000 truly available).
   - A simple way to fire these near-simultaneously without custom tooling: open two browser tabs, prepare both actions (fill in the forms), and click "submit" on both within roughly the same second. For a more rigorous test, use two terminal windows with `curl` fired via `&` to background one request immediately before the other.

**Expected result:** Exactly one of the two requests succeeds; the other receives a clear rejection ("insufficient balance"). The final balance is consistent with only the winning operation's effect — never both, never neither.
**DB records to verify:**
```sql
SELECT amount FROM company_budget_transactions WHERE note = 'staging-check-race-target';
-- either 4000.00 (edit lost) or 7000.00 (edit won)

SELECT COALESCE(SUM(CASE WHEN transaction_type='manual_income' THEN amount
                         WHEN transaction_type='owner_withdrawal' THEN -amount ELSE 0 END), 0)
FROM company_budget_transactions;
-- must reconcile exactly with whichever single operation won
```
**Blocker if:** Both operations succeed (balance overspent); neither succeeds when at least one legitimately should; final balance doesn't match either winning scenario exactly (a "torn" or partially-applied state).

---

## 7. Create a payout batch

**Who:** Sales Team Lead (or Owner)
**Steps:**
1. As a team lead, go to Финансы → Кому выплатить.
2. Select 1-2 team members with a nonzero "Remaining" amount, confirm the shown amounts, submit "Подтвердить выплату."

**Expected result:** Success toast; payout(s) recorded; "Remaining" for each paid member drops by the paid amount; the batch cannot be re-submitted by re-clicking (button disables during submission; double-click does not create a duplicate batch — the client generates one idempotency key per submission attempt).
**DB records to verify:**
```sql
SELECT id, payer_id, idempotency_key FROM payout_batches ORDER BY created_at DESC LIMIT 1;
SELECT payee_id, amount, status FROM payouts WHERE batch_id = '<batch id above>';
```
**Log entries to verify:** None dedicated beyond the `payouts`/`payout_batches` rows themselves (this is the ledger).
**Blocker if:** Duplicate batch created from a single user submission; paid amount exceeds what was actually "Remaining" at submission time.

---

## 8. Attempt duplicate payees in the same payout batch

**Who:** QA engineer with team-lead credentials, using direct API access (the web UI's payee-selection is a Set and cannot construct a duplicate-payee request — this specifically tests defense against a client that bypasses the UI, e.g. a modified request or a future mobile client)
**Steps:**
1. Identify a team member with a known "Remaining" amount, say `1000`.
2. Send `POST /payouts` directly with a body containing **two line items for the same `payee_id`**, e.g. `700` and `700` (summing to `1400`, which exceeds the `1000` remaining), with a fresh `idempotency_key`.
3. Repeat with two line items summing to `800` (within the `1000` remaining) as the positive control.

**Expected result:** The over-limit batch (`700+700=1400 > 1000`) is rejected outright with a clear message naming the payee and the amounts involved — **no partial payout is created** (all-or-nothing). The within-limit batch (`800`) succeeds.
**DB records to verify:**
```sql
-- After the rejected 1400 attempt:
SELECT count(*) FROM payouts WHERE batch_id = (SELECT id FROM payout_batches WHERE idempotency_key = '<the rejected key>');
-- must be 0 (or the batch row itself must not exist at all)
```
**Blocker if:** The over-limit batch succeeds (this is the exact double-pay bug fixed this session); any partial insert exists for a rejected batch.

---

## 9. Attempt two concurrent payout batches for the same payee

**Who:** QA engineer with team-lead (or owner) API access, scripted
**Steps:**
1. Identify a payee with `1000` remaining.
2. Fire two separate `POST /payouts` requests **concurrently** (different `idempotency_key` each — this is not a retry, it's two genuinely different batches), each paying `700` to the same payee. Together they would overspend (`1400 > 1000`) if unprotected.

**Expected result:** Exactly one batch succeeds; the other is rejected with a clear conflict/insufficient-remaining message. Total paid to that payee across both attempts is `700`, not `1400`.
**DB records to verify:**
```sql
SELECT SUM(amount) FROM payouts WHERE payee_id = '<payee id>' AND status != 'voided'
  AND period_start <= '<period end>' AND period_end >= '<period start>';
-- must equal exactly 700, not 1400
```
**Blocker if:** Both batches succeed; total paid exceeds what was actually owed.

---

## 10. Courier submits a cash handover

**Who:** Courier
**Steps:**
1. As a courier with delivered, un-handed-over orders, go to Наличные → submit a handover for the eligible orders.

**Expected result:** Handover created in `pending` status; the submitted orders no longer appear as "eligible" for a second handover.
**DB records to verify:**
```sql
SELECT id, status, total_collected, total_to_return FROM cash_handovers ORDER BY created_at DESC LIMIT 1;
-- status = 'pending'
SELECT count(*) FROM cash_handover_orders WHERE handover_id = '<the id above>';
-- matches number of orders submitted
```
**Blocker if:** Same order can be included in two separate pending/confirmed handovers (double-claimed cash).

---

## 11. Dispatcher confirms a cash handover

**Who:** Dispatcher
**Steps:**
1. From the pending handover in #10, dispatcher enters the actual returned amount matching what's expected and confirms.

**Expected result:** Status becomes `confirmed` if amounts match (within 0.01 tolerance) or `disputed` if they don't; `confirmed_at`/`dispatcher_id` set.
**DB records to verify:**
```sql
SELECT status, actual_returned, confirmed_at, dispatcher_id FROM cash_handovers WHERE id = '<id>';
```
**Log entries to verify:** An activity-log entry (`action='confirm_handover'`, `entity_type='cash_handover'`) exists for this action.
**Blocker if:** Status doesn't reflect the amount comparison correctly; confirming twice (re-click, or a second tab) succeeds twice (see #13).

---

## 12. Dispatcher rejects a cash handover

**Who:** Dispatcher
**Steps:**
1. Submit a fresh handover (per #10). Dispatcher rejects it with a reason.

**Expected result:** Status becomes `rejected`; reason recorded.
**DB records to verify:**
```sql
SELECT status, admin_note, comment FROM cash_handovers WHERE id = '<id>';
-- status = 'rejected'
```
**Log entries to verify:** Activity-log entry `action='reject_handover'`.
**Blocker if:** Rejecting an already-confirmed or already-rejected handover succeeds (should be blocked — see #13/#14).

---

## 13. Attempt concurrent confirm vs. reject on the same handover

**Who:** QA engineer, scripted (two different actors: a dispatcher and — separately — an owner using the Logistics admin "Update" action, since this exercises the cross-module race between `internal/courier` and `internal/logistics`, which was the specific new bug found and fixed this session)
**Steps:**
1. Submit a fresh pending handover.
2. Fire, as close to simultaneously as possible: (A) dispatcher confirms it via the normal confirm action, and (B) owner rejects the same handover via the Logistics "Отклонить" action.

**Expected result:** Exactly one of the two succeeds. The loser receives a clear conflict message ("this handover has already been processed or changed") — a proper 4xx, not a silent success and not a 500. The final status matches whichever action actually won; there is no torn/mixed state.
**DB records to verify:**
```sql
SELECT status FROM cash_handovers WHERE id = '<id>';
-- either 'confirmed' or 'rejected', matching whichever request won

SELECT count(*) FROM cash_handover_edits WHERE handover_id = '<id>';
-- if the logistics-side (reject) action won: exactly 1 row here
-- if the courier-side (confirm) action won: 0 rows here (that path logs to
--   the activity log instead, not cash_handover_edits — this asymmetry is
--   expected, see FINAL_PRODUCTION_AUDIT.md's remediation notes)
```
**Blocker if:** Both actions succeed (contradictory final state / double-processed handover — **this is the exact bug found and fixed this session**); the loser gets a 500 error instead of a clean rejection; the handover ends up in neither `confirmed` nor `rejected` (a corrupted intermediate state).

---

## 14. Attempt to edit a confirmed handover

**Who:** Owner
**Steps:**
1. Using an already-confirmed handover, attempt the **ordinary** update action (Logistics "Update" — same action used for the initial pending→decision flow) to change its status. Expect this to be rejected ("only pending or disputed handovers can be updated").
2. Separately, use the dedicated **"Edit" / correction** action (the explicit, owner-only "we made a mistake" workflow, requiring a reason) to correct the same confirmed handover — e.g. change the actual returned amount. This should succeed, since it is an intentionally-permitted exception, not a bug.

**Expected result:** Step 1 is rejected. Step 2 succeeds and is recorded with a reason in the edit history.
**DB records to verify:**
```sql
SELECT * FROM cash_handover_edits WHERE handover_id = '<id>' ORDER BY created_at DESC LIMIT 1;
-- action='edit', reason populated, old/new values recorded
```
**Blocker if:** Step 1 (the ordinary path) succeeds in modifying an already-confirmed handover — that would mean the fix regressed. Step 2 failing is **not** a blocker by itself but should be reported, since it's documented as an intentionally-supported correction workflow.

---

## 15. Verify courier debt after confirmation

**Who:** Owner / Dispatcher (view-only check)
**Steps:**
1. Before confirming a handover, note the courier's shown "debt"/"cash to hand over" figure (Logistics dashboard and the courier's own app/profile should agree).
2. Confirm the handover with a shortfall (actual returned < total to return) via #11.
3. Re-check the debt figure from both the owner/logistics side and (if accessible) the courier's own view.

**Expected result:** Debt figure increases by exactly the shortfall amount and is **consistent between the owner/logistics view and the courier's own view** — this figure is computed live from orders + confirmed handovers (there is no separately-stored "debt" column to desynchronize), so confirming exactly once must change it exactly once.
**DB records to verify:** Not a stored value — cross-check the displayed number against a manual reconstruction: `SUM(total_to_return - COALESCE(actual_returned, total_to_return))` over the courier's confirmed handovers with a shortfall.
**Blocker if:** The two views (owner vs. courier) disagree; confirming the same handover a second time (should be blocked per #11/#13) would double-count the shortfall — verify this cannot happen.

---

## 16. Verify financial events and audit logs

**Who:** Owner (view-only check across several already-performed actions above)
**Steps:**
1. After performing items #1-#14, review: Finance → Events/Ledger (financial_events + the UNION'd payouts/expenses view), Budget transaction history (`record_edits`), and handover edit history (`cash_handover_edits`) plus the activity log.

**Expected result:** Every mutating action above has exactly one corresponding entry — no duplicates, no missing entries, no entries for actions that were rejected/failed.
**DB records to verify:**
```sql
-- No duplicate financial_events for the same order+event_type (pre-existing invariant, unrelated to this session's changes but worth reconfirming):
SELECT order_id, event_type, count(*) FROM financial_events GROUP BY order_id, event_type HAVING count(*) > 1;
-- must return zero rows

-- No orphaned record_edits (edits referencing a subject_id that never existed as a real edit):
SELECT count(*) FROM record_edits WHERE subject_type = 'budget_transaction'
  AND subject_id NOT IN (SELECT id FROM company_budget_transactions);
-- must be 0
```
**Blocker if:** Any duplicate or missing ledger/audit entry for an action confirmed to have happened exactly once in the UI.

---

## 17. Upload a valid avatar image

**Who:** Any authenticated user (seller/owner profile page is the easiest to test from)
**Steps:**
1. Go to profile → upload a real JPEG and, separately, a real PNG as an avatar.

**Expected result:** Both succeed; the new avatar displays immediately (cache-busted) and persists after a page reload.
**DB records to verify:**
```sql
SELECT avatar_url, avatar_media_asset_id FROM users WHERE id = '<user id>';
-- one of these should be set (avatar_media_asset_id for the modern web-admin path)
```
**Blocker if:** Upload succeeds but the image doesn't render (broken URL); upload fails for a genuinely valid JPEG/PNG.

---

## 18. Attempt to upload malicious or disguised files

**Who:** QA engineer with API access (this specifically targets the legacy `POST /users/:id/avatar` / `POST /users/me/avatar` endpoint — confirmed in this session to be actively used by the courier mobile app, not just a theoretical path)
**Steps:** Attempt each of the following as an avatar upload, via direct API call:
1. An HTML file containing `<script>` content, with filename `photo.jpg` and `Content-Type: image/jpeg` (both spoofed).
2. An SVG file containing `<script>` content.
3. A file with valid JPEG magic bytes but corrupted/truncated body (not a real decodable image).
4. A zero-byte file.
5. Random unrecognized binary data claiming to be `image/jpeg`.
6. A filename attempting path traversal, e.g. `../../../etc/passwd.jpg`, on an otherwise-valid JPEG.

**Expected result:** Attempts 1-5 are all rejected with a 400 and a clear message; nothing is stored on disk or referenced in the DB for any of them. Attempt 6 **succeeds** (it's a valid image) but the stored filename is server-generated — the client-supplied path component must never appear anywhere in the response or on disk.
**DB records to verify:**
```sql
SELECT avatar_url FROM users WHERE id = '<test user>';
-- for attempt 6: must be a UUID-based filename under /uploads/, never containing ".." or "etc/passwd"
```
**Blocker if:** Any of 1-5 succeeds in storing content (a live stored-XSS vector); attempt 6's stored path reflects the client's filename in any form.

---

## 19. Verify all primary roles

**Who:** One tester per role (or one tester cycling through test accounts for each)
**Steps:** For each role below, log in and confirm: (a) login succeeds and lands on the correct home screen, (b) the role's primary dashboard loads without error, (c) at least one role-specific action from this checklist (where applicable) works, (d) an action **outside** the role's permission is correctly blocked (403), not silently allowed.

| Role | Primary check | Cross-role check (must be blocked) |
|---|---|---|
| Owner | Budget dashboard, payout view, all user management | N/A (top-level) |
| Team Lead | Payables list, create payout batch (#7-#9) | Cannot access Owner-only budget endpoints |
| Manager | Team income/finance view | Cannot create payouts for another team lead's team |
| Seller | Own orders, own income, own profile/avatar (#17) | Cannot view another seller's customer list |
| Dispatcher | Cash handovers confirm/reject (#11-#13) | Cannot access Owner budget or Logistics admin-edit |
| Warehouse | Inventory receiving/write-offs | Cannot access budget, payouts, or handover confirm/reject |
| Courier | Submit handover (#10), own deliveries, own profile | Cannot view another courier's handovers or confirm/reject their own submission |

**Expected result:** Every role can do its job; every explicitly-listed cross-role attempt returns 403, not 200 and not 500.
**Blocker if:** Any role can perform an action reserved for another role (privilege escalation); any role's own legitimate primary action is broken.

---

## Summary sign-off

| # | Item | Result | Blocker? (Y/N) | Notes |
|---|---|---|---|---|
| 1 | Budget top-up create | | | |
| 2 | Budget top-up edit | | | |
| 3 | Withdrawal create | | | |
| 4 | Withdrawal edit | | | |
| 5 | Negative balance attempt | | | |
| 6 | Concurrent create vs edit | | | |
| 7 | Payout batch create | | | |
| 8 | Duplicate payee in batch | | | |
| 9 | Concurrent batches, same payee | | | |
| 10 | Courier submits handover | | | |
| 11 | Dispatcher confirms | | | |
| 12 | Dispatcher rejects | | | |
| 13 | Concurrent confirm vs reject | | | |
| 14 | Edit confirmed handover | | | |
| 15 | Courier debt after confirm | | | |
| 16 | Financial events/audit logs | | | |
| 17 | Valid avatar upload | | | |
| 18 | Malicious avatar upload | | | |
| 19 | Role verification | | | |

**Promotion to production requires:** every row above marked non-blocker (or explicitly waived with a documented reason and sign-off from whoever owns that risk).
