# SOP-06: Incidents and rollback

**Purpose**: stop damage first, then fix, then learn. Points are play money, but trust is not.

## Severity
- **P1**: trading produces wrong balances, ledger invariant fails, anyone can sign in without an MC email, data exposure. Act immediately.
- **P2**: trading unavailable, resolution/payout stuck, cron not running. Act within the day.
- **P3**: cosmetic or single-user issues. Normal workflow (SOP-02).

## Steps (P1/P2)
1. **Freeze**: set the `TRADING_PAUSED=true` env flag in Vercel (the `placeTrade` action refuses while set) and, if needed, roll back to the previous Vercel deployment.
2. **Capture**: copy the error, affected market IDs, timestamps, and the last deploy ID into `docs/incidents/YYYY-MM-DD-<slug>.md`. The repo is public: refer to people only by opaque user IDs, never by email or display name, and keep screenshots out.
3. **Diagnose**: `debugging-and-error-recovery` skill; reproduce on `dev` with a copy of the relevant rows, never on prod.
4. **Repair data** only through ledger entries with reason `admin_adjustment` and a note referencing the incident file. Never UPDATE `balances` or `ledger_entries` by hand.
5. **Fix forward** via SOP-02 with a regression test that fails before the fix.
6. **Unfreeze**, verify with a 10-point trade, run the ledger invariant job.
7. **Write-up** within 48 hours: timeline, root cause, what prevents recurrence (test, constraint, alert). Link from the incident file.

## Drill (before M6)
Simulate a P1 on `dev`: corrupt a balance row, confirm the invariant job catches it, repair with an adjustment entry, and time the whole procedure.
