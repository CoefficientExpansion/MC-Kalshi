# SOP-08: Admin operations

**Purpose**: the few privileged actions outside the market lifecycle (SOP-04), done the same way every time and always auditable.
**Who**: admins only. Every action below writes an `audit_log` row with the actor, target, and reason; the admin UI (M5) enforces this, and until then the SQL snippets in `scripts/admin/` do.

## 1. Roles
- Roles: `member` (default), `moderator` (SOP-04 actions), `admin` (this SOP plus dispute decisions).
- Grant moderator: project lead approves in writing (message is fine); admin sets `profiles.role`; audit row `role_change` with the approval reference. Minimum two moderators and two admins before public beta; the developer is one admin.
- Revoke: same path; also close any dispute assigned to that person.
- Never grant `admin` to an account that is not a staff member or the developer.

## 2. Point adjustments
- Only through a ledger entry with reason `admin_adjustment`, a `ref` to the incident or ticket, and a free-text note. Never update `balances` or edit ledger rows.
- Allowed cases: compensation for a confirmed bug (SOP-06), reversal of abuse gains, stipend correction.
- Two-person rule: adjustments over 10,000 points, or more than 10 accounts at once, need a second admin's written OK before posting.
- After posting, run the ledger invariant check; it must still sum to zero (the house account is the counterparty).

## 3. Suspensions and abuse
- Signals: many accounts trading one thin market in the same direction within minutes, trading by a person who decides or organizes the event, automated trade cadence, harassment in display names.
- Steps: (1) set `profiles.suspended_at` (blocks trading and proposing, keeps the account readable); (2) if a market was manipulated and is still open, close it early (`close_at = now()`) and decide with a second admin whether to void (SOP-04 §6); (3) message the person from the project email with the reason and how to appeal; (4) audit row `suspend` with evidence (market ids, timestamps).
- Lift a suspension the same way with reason `unsuspend`.

## 4. Account removal (user request or student leaves)
- Ledger and trade rows are never deleted (the ledger must balance and history must stay auditable).
- Steps: (1) set `display_name` to `Removed user`, replace `email` with `removed+<id>@invalid`, set `suspended_at`; (2) delete the Supabase Auth user so sign-in is impossible; (3) audit row `anonymize`; (4) reply to the person within 7 days confirming completion.
- The leaderboard and market pages show `Removed user` for that account from then on.

## 5. Economy settings
- Sign-up bonus, weekly stipend, balance cap, default liquidity `b`: changed by an admin in the `settings` table (M5) or env vars (before M5), with an audit row `settings_change` and a line in the CHANGELOG. Announce stipend changes to users before they take effect.

## Checks
- `select count(*) from audit_log where created_at > now() - interval '1 day'` matches the number of admin actions the admin remembers doing today.
- No `UPDATE` or `DELETE` grant on `ledger_entries` for the app role (`\dp ledger_entries`).
- Every suspended account has an audit row with evidence.
