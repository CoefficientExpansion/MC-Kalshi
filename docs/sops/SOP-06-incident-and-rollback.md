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

## Ledger invariant alert
`GET /api/cron/ledger-invariants` runs daily (Vercel Cron, `apps/web/vercel.json`). A 500 with a log line
`{"event":"ledger_invariant_violation","checkedAt":…,"issues":[…]}` means the ledger, the balances cache, the
positions, the trades and `q` no longer agree: a **P1**. Each issue has a `kind` and ids only (`marketId`,
`userId`, `side`), never emails or amounts. Kinds: `ledger_sum_nonzero`, `balance_mismatch`, `invalid_numeric`,
`positions_q_mismatch`, `trades_q_mismatch`, `position_trades_mismatch`, `cost_basis_mismatch`,
`pool_trades_mismatch`. A 500 with `ledger_invariant_check_failed` means the check itself could not run (treat as P2
unless it repeats). A 401 means `CRON_SECRET` is missing or wrong in Vercel (P2, the check is not running).
1. Set `TRADING_PAUSED=true` in Vercel and redeploy.
2. Read the issue ids from the Vercel log line into the incident file (step 2 above); the kind says which tables disagree.
3. Follow the P1 steps above from step 3 (diagnose on `dev`, repair only with `admin_adjustment` entries).

## Drill (before M6)
Simulate a P1 on `dev`: corrupt a balance row, confirm the invariant job catches it, repair with an adjustment entry, and time the whole procedure.
