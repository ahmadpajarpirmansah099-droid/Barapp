# BarApp Staging + Browser Smoke Test V1

Status: prepared for the draft PR; not yet executed against a verified staging project.

## Safety gate before testing
- [ ] Confirm the Supabase project ID is the intended staging/test project with a maintainer.
- [ ] Confirm a restorable backup exists and record the backup timestamp.
- [ ] Use test outlet/division and test accounts only; do not use production transactions.
- [ ] Record the deployed Git commit, SQL migration version, test date, browser/device, and tester.
- [ ] Stop immediately if the target is the active production project or cannot be positively identified.

## Roles and access boundaries
- [ ] Admin: can access only the intended outlet/division and permitted closing approvals.
- [ ] Inventory manager: can use inventory and opening-WIP workflows permitted by role.
- [ ] Daily SO-only role: can use Daily SO but cannot open WIP, production, menu-sales, or other COGS pages through direct navigation.
- [ ] User scoped to another division: cannot read or mutate records in the first division.
- [ ] Anonymous role: cannot execute closing/COGS write RPCs or directly mutate operational tables.
- [ ] Staff PIN/token attendance flow still works; validate rate limits and token boundaries without exposing secrets.

## Daily SO and backdate regression
- [ ] Submit a current-day SO with every eligible active non-SUPPLIES material and enabled WIP exactly once.
- [ ] Confirm duplicate component rows are rejected with a clear Indonesian error.
- [ ] Confirm a missing component, cross-division component, wrong component type, and invalid reference are rejected.
- [ ] Confirm SUPPLIES items are excluded from the COGS/Daily SO material set.
- [ ] Confirm current-day closing fails if the active component set changes after SO submission; reconcile and resubmit as appropriate.
- [ ] Create a test material/WIP after a historical test date, then create/inspect a legitimate backdated SO snapshot referencing valid rows. Confirm the later master `created_at` alone does not invalidate the historical snapshot.
- [ ] Confirm backdated approval retains submitted expected quantity, variance, and unit-cost snapshots instead of refreshing them from today's catalog/stock.
- [ ] Confirm future dates and null dates are rejected where required; test midnight boundary using Asia/Jakarta local date.
- [ ] Confirm closing confirmation and approval enforce the same saved-snapshot integrity rules.
- [ ] Verify audit log records actor, division, date, status transitions, and reconciliation reason.

## Stock, production, sales, and inventory roll-forward
- [ ] Record a batch WIP production and verify raw-material consumption and WIP output exactly once.
- [ ] Record a multi-row menu sale and verify recipe consumption exactly once.
- [ ] Cancel a posted operation and verify its effect is reversed once, with cancellation metadata/audit trail.
- [ ] Record stock-out categories and confirm only posted rows affect stock.
- [ ] Test inter-division Move: source decreases and destination increases once, with correct item type and outlet.
- [ ] Test inbound stock and return quantities; returns cannot exceed posted inbound quantities.
- [ ] Create/edit/cancel an opening-WIP balance before any production/consumption activity; verify duplicate opening balance and conflicting-date attempts fail clearly.
- [ ] Compare inventory WIP position and COGS/Daily SO position for the same division/date, including a user without COGS permissions.
- [ ] Verify next day's opening position uses the approved previous-day close according to the configured closing workflow.
- [ ] Verify no operation changes a different division's stock.

## Free validation path (no paid Supabase branch)
- [x] Ran `barapp_closing_reopen_preflight_v1.sql` against the active database as a read-only query on 2026-10-18. Required tables, columns, prerequisite functions, and approval metadata checks passed; the reopen RPC is absent, confirming the feature migration remains unapplied. This is metadata validation only, not a staging transaction test.
- [x] The same preflight found all 11 closing-reconciliation triggers installed for stock-in, stock-out, returns, supplies, Daily SO, menu sales, production batches, and their line/input tables. Each was present for INSERT, UPDATE, and DELETE.
- [x] GitHub Actions runs the static QA, preview build, and `closing-reopen-postgres-test` against a disposable PostgreSQL service; this test path does not connect to Supabase or touch operational data.
- [x] The isolated PostgreSQL smoke test covers cancel, prior snapshot/audit preservation, invalid reason and unauthorized-role guards, resetting module confirmations, and calling the repository's approval RPC again after the required modules are reconfirmed.
- [ ] Scope limitation: the PostgreSQL fixture deliberately disables optional COGS/Daily SO modules. It verifies the closing lifecycle but does not prove current-day stock-position arithmetic or execute the live database's reconciliation trigger implementation.
- [ ] For full stock-calculation regression, use a disposable local PostgreSQL/Supabase CLI environment after the complete schema and prerequisites are available locally. Do not substitute the live database for staging.
- [ ] Do not create a billed Supabase development branch or apply the cancellation migration to production as a workaround.

## Closing approval cancel/reopen regression
- [ ] Use a verified staging-only division and date with a complete, approved closing; capture period row, module snapshots, SO/sales/WIP row counts, and stock positions before cancel.
- [ ] As Developer/Admin Divisi with access to that division, use "Batalkan Approval" and provide a non-empty reason.
- [ ] Confirm period status becomes `needs_reconciliation`, active `approved_by`/`approved_at` are cleared and `summary` is reset, while the prior values remain in audit `old_data`.
- [ ] Confirm Daily SO, sales, production, stock-in/out, and their detail rows are not deleted or rewritten.
- [ ] Confirm `audit_log` contains action `closing_approval_cancelled`, the supplied reason, prior period row, and all prior module snapshots in `old_data`.
- [ ] Confirm all modules return to pending confirmation and the UI requires them to be confirmed again before approval; no transaction re-entry is needed.
- [ ] Confirm blank reason, reason over 500 characters, and non-authorized/out-of-scope user are rejected without changing the period or module rows.
- [ ] Reconfirm the active modules, approve the closing again, and verify period status returns to `approved`, a new approval timestamp is recorded, and stock does not get consumed/applied twice.
- [ ] Verify `barapp_closing_approve` only refreshes closing metadata and Daily SO snapshot/variance fields; compare stock-movement rows and computed stock positions before/after cancel + reapproval to prove no duplicate movement is created.
- [ ] Verify the `cogs_daily_so_lines` update trigger does not leave the closing in `needs_reconciliation` after a successful reapproval; it should only flag a period that was already approved when the transaction changed.
- [ ] Confirm audit history retains both cancellation and subsequent approval; download the closing/Daily SO Excel before and after to verify only expected report values change.

## UI and device checks
- [ ] Desktop: sidebar/page permissions, outlet/division selectors, date filters, refresh/search, notification/account controls.
- [ ] Mobile: no horizontal overflow in forms/tables; input controls remain reachable; dialogs and dropdowns are usable.
- [ ] Batch forms: add/remove rows, duplicate handling, 200-row cap, loading state, retry/error feedback.
- [ ] Daily SO: opening, edit/count, save, submit, confirm, approval/reconciliation detail, and Excel export.
- [ ] Indonesian error messages are actionable and do not expose tokens, SQL, or sensitive data.
- [ ] Browser console has no uncaught errors; network failures do not create duplicate writes after retry.

## Evidence and exit criteria
- [ ] Capture sanitized screenshots for each failed/passed critical flow.
- [ ] Record expected vs actual quantities and reconciliation output for test division.
- [ ] Verify direct DML remains denied and RLS is enabled on operational tables.
- [ ] Run the read-only `barapp_security_verify_v1.sql` suite after migration and review every nonzero finding.
- [ ] Restore/reset test data only using an approved staging cleanup plan.
- [ ] Do not merge the draft PR until all critical checks pass and a reviewer signs off.

## Result log
| Field | Value |
|---|---|
| Staging project ID (confirm with maintainer) | |
| Backup timestamp | |
| Git commit / migration | |
| Tester / date | |
| Browser / device | |
| Passed / failed / blocked | |
| Findings and evidence links | |
| Reviewer sign-off | |
