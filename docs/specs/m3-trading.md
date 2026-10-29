# M3 — Trading: placeTrade, order ticket, positions, price chart, invariant job
Status: in-progress (2026-10-29) · Milestone: M3 · Research: docs/research/kalshi/order-ticket.md, docs/research/kalshi/market-page.md · ADRs: 0001, 0002

## Problem
Markets are readable (M2) but nobody can trade. M3 makes points move: a signed-in member buys or
sells YES/NO contracts against the LMSR pool, sees a live quote that equals the fill, watches
positions and a price chart, and the system proves every point is accounted for. This is the first
code that writes `ledger_entries` from user input, so it carries the highest integrity bar
(hard constraints 1, 3, 4). Formulas stay in `packages/engine`; this slice adds orchestration only.

Engine names used below are those of the M1 engine on `main` (c311323; see `docs/specs/m1-engine.md`,
Ship decision): `quotePoints(s, side, points)` for buy by points, `quoteContracts(s, side, n)` for buy by
contracts, `quoteContracts(s, side, −n)` for a sell (signed contracts), `applyFill`, `withinSlippage`,
`probabilityYes`, `displayPrice`, `Quote.stateAfter`. The server calls them through one adapter,
`server/quote.ts`.

## Scope
In:
- `placeTrade` (core function + thin server action), idempotent, one transaction, market row locked.
- Trade size rules, per-trade cap, rate-limit seam, `TRADING_PAUSED` kill switch (SOP-06).
- Order ticket on `/markets/[slug]`: buy by points, buy by contracts, sell from position.
- Per-market "Your position" card and `/portfolio` (holdings, cost basis, value, payout if win).
- Price chart from `price_snapshots` (hand-written SVG), ranges `1D · 1W · ALL`.
- Market state endpoint for 3 s polling (`GET /api/markets/[id]/state`).
- Ledger invariant job: `GET /api/cron/ledger-invariants` (ledger sum, balances, trades/positions/q).
- Tests: PGlite TDD, property test, real-Postgres concurrency test in CI, Playwright trade loop.
Out: resolve/void/payouts (M4), real rate limiter and admin tools (M5), limit orders, fees,
leaderboard, "Also trading" block, realized-vs-unrealized P&L split (needs M4 settlement data).

## Acceptance criteria
- [ ] Given a signed-in member with 10,000 points and a fresh b=100 market, when they buy YES with 500 points, then one trade of 9.76 contracts exists, balance is 9,500, the pool ledger is +500, `q_yes = 9.761859`, a snapshot exists, and the ticket quote matched.
- [ ] Given a stale quote, when the price moved more than 2 points per contract, then nothing is written and the ticket offers the new price.
- [ ] Given the same idempotency key sent concurrently, then exactly one trade exists and every caller gets it.
- [ ] Given two parallel trades (real Postgres), then they serialize on the market lock and invariants hold.
- [ ] Given a closed, paused, suspended, or underfunded case, then the matching error code returns and no rows change.
- [ ] Given a random trade sequence, then ledger sum is 0, balances equal the ledger, positions equal `q`.
- [ ] Given the Playwright loop, then buy, sell, portfolio and the invariant route all pass; e2e sessions come from the Supabase admin API (if the fallback test-session route is used instead, it is 404 when `VERCEL` is set).
- [ ] No UI string contains "bet", "$", "¢" or "cash out".

## Key decisions
1. **Core vs action.** `server/trading.ts` exports `placeTrade(db, userId, input, opts?)` (all logic, testable
   with any `AnyDb`). `app/markets/[slug]/actions.ts` (`"use server"`) resolves the session user via the sign-in
   slice's `requireUser()` / `getCurrentUser()` (`apps/web/src/server/auth.ts`; `getCurrentUser` returns `null`
   for a signed-out session, one with no profile, or one whose email is no longer allowed), calls the core, returns its result. Next's built-in Origin check covers CSRF.
2. **Results are values, not exceptions.** Expected failures return `{ ok: false, code, message, ... }`; only bugs throw.
3. **Lock order is market, then balances row.** Architecture §6 locks only the market, but a user trading two
   markets at once would race on their balance. The balances row is also locked `FOR UPDATE` (conflict #1 below).
4. **Time comes from the database** (`now()`), never the app clock, for the `close_at` check and snapshot time.
5. **Prices are shown as points and percent** ("51 pts", "52%"), never `¢` or `$` (theme copy rules; the Kalshi
   note's `¢` is not adopted).

## `placeTrade`
Input: `{ marketId: uuid, side: "YES"|"NO", mode: "buy_points"|"buy_contracts"|"sell_contracts",
amount: number, expectedAvgPrice: number, maxSlippage?: number (default 2, allowed 0–10),
idempotencyKey: string (16–64 chars of [A-Za-z0-9_-]; the client sends `crypto.randomUUID()`) }`.
`amount` is whole points for `buy_points` (>= 1), else contracts with at most 6 decimals. `expectedAvgPrice`
is points per contract (0–100), the average price the ticket displayed.

Order of operations (any failure rolls the whole transaction back and writes nothing):
0. Pre-transaction: `TRADING_PAUSED=true` -> `trading_paused`. Validate shape -> `invalid_input`. Look up
   `(user_id, idempotencyKey)`; if found, return the original (step 8 rule). Call the rate-limit seam.
1. `BEGIN`. Load the profile; missing -> `unauthenticated`; `suspended_at` set -> `account_suspended`.
2. `SELECT … FROM markets WHERE id = $1 FOR UPDATE`; none -> `market_not_found`.
3. Re-check idempotency (a concurrent retry may have committed while we waited for the lock).
4. `status <> 'open'` -> `market_not_open`; `close_at <= now()` -> `market_closed`.
5. `INSERT INTO balances … ON CONFLICT DO NOTHING`, then `SELECT … FROM balances WHERE user_id = $2 FOR UPDATE`.
   Read the user's `positions` row (absent = `EMPTY_POSITION`).
6. Parse `q_yes`/`q_no` with `parseNumeric`, build `MarketState {b, qYes, qNo}`, quote with the engine by mode.
   Any `EngineError` (whatever its `code`: `INVALID_STATE`, `INVALID_CONTRACTS`, `INVALID_POINTS`,
   `INVALID_SIDE`) maps to `invalid_input`; any other exception maps to `internal_error` and is logged.
   The engine accepts sells that take `q` below 0, so selling more than is held is caught by the holdings
   check in step 7c (and `applyFill` rejects a sell below zero holdings).
7. Checks, in this order:
   a. Size rules (below) -> `trade_too_small` / `trade_too_large`. These run first because on dust the
      one-point minimum charge is far above `avgPrice × contracts`, so the slippage check alone says nothing.
      The engine clamps `avgPrice` to 1..99: a sell on a side whose probability is about 1 reports 99 while
      paying about 100 per contract, and `withinSlippage` compares these clamped prices.
   b. `withinSlippage(expectedAvgPrice, quote, maxSlippage)` else `slippage_exceeded` with a fresh `requote`.
   c. Buy: `balance >= quote.costPoints` else `insufficient_balance {balance, needed}`.
      Sell: held contracts on that side >= amount else `insufficient_position {held}`.
8. `INSERT INTO trades … ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING *`. No row means another
   transaction won the unique constraint (for example the same key sent for two different markets at once):
   roll back, re-read the original, and return it with `replayed: true` only if the full original input matches
   (market, side, mode, amount, `expectedAvgPrice`, `maxSlippage`; stored as `trades.request_fingerprint`,
   see Data touched), else `idempotency_key_reused`. The pre-transaction and step 3 lookups apply the same comparison. A replay never re-validates market status, balance or slippage.
9. `applyFill(position, quote)`; upsert `positions` (`ON CONFLICT (market_id, user_id) DO UPDATE`).
10. `UPDATE markets SET q_yes, q_no` from `quote.stateAfter` (absolute values; exact multiples of 1e-6).
11. `postTransfer(tx, { entries: [user −costPoints, market_pool(marketId) +costPoints], reason: "trade",
    refType: "trade", refId: trade.id })`. Sells use the same call with the signs flipped (costPoints is
    negative). A sell whose proceeds floor to 0 (only a final close-out of dust) writes no ledger rows.
12. `INSERT INTO price_snapshots (market_id, at, prob_yes) VALUES (…, trade.created_at, quote.probAfter)`. `COMMIT`.

Success: `{ ok: true, replayed, trade: { id, side, contracts, costPoints, avgPrice, probBefore, probAfter,
createdAt }, position, balance, market: { qYes, qNo, probabilityYes, displayPrice } }` so the UI updates without
waiting for the next poll.

**Error taxonomy** (`code`; the UI maps each to fixed copy, never shows raw `message`): `trading_paused`,
`unauthenticated`, `account_suspended`, `invalid_input`, `market_not_found`, `market_not_open`, `market_closed`,
`slippage_exceeded` (+ `requote: {avgPrice, contracts, costPoints, probAfter, payoutIfWin}`),
`trade_too_small`, `trade_too_large` (+ `maxPoints`), `insufficient_balance`, `insufficient_position`,
`rate_limited` (+ `retryAfterSec`), `idempotency_key_reused`, `internal_error` (generic message; details to logs
without the DB URL or driver text).

**numeric(18,6) boundary** (`server/numeric.ts`). Drizzle returns `numeric` as strings. `parseNumeric(s)` ->
`Number(s)` and asserts it is an exact multiple of 1e-6 within the engine's micro-contract range.
`formatNumeric(n)` -> asserts the same, returns `n.toFixed(6)`. These are the only places strings and numbers
meet; no SQL arithmetic on `q` or contracts; points (`bigint` mode number) stay safe integers.

### Size rules and limits
| Rule | Value | Reasoning |
|---|---|---|
| Minimum buy | `contracts >= 0.01` and `payoutIfWin >= costPoints` | The engine rounds a buy up to at least 1 point, so a 1e-6 contract buy costs 1 point (M1 review). A buy that pays less than it costs is a guaranteed loss. 0.01 contracts pays 1 point, the smallest meaningful position. |
| Minimum buy by points | 1 point (and the rule above) | Smallest budget the engine accepts; at p near 0.5 it buys about 0.02 contracts. |
| Minimum sell | `contracts >= 0.01`, or the user's entire holding of that side | Lets users close out a remainder smaller than 0.01. Also rejected: a sell whose proceeds are 0 unless it is that close-out. |
| Maximum buy | `costPoints <= min(5000, 50·b)` | Stays under the default market's maximum pool loss (6,931) and half the proposed signup bonus; a single trade cannot decide a market. Sells are never capped: exiting is always allowed. |
| Maximum amount sanity | contracts <= 1e6, points <= 1e9 | Rejects absurd input before the engine sees it. |
Constants live in `server/trade-limits.ts` (one place; later movable to `settings`).

**Rate limit.** M3 ships the seam `checkTradeRateLimit(db, userId, now)` and a cheap implementation: count the
user's trades in the last 60 s (new index `trades(user_id, created_at)`), limit `TRADE_RATE_LIMIT_PER_MIN`
(default 20) -> `rate_limited`. M5 replaces the body with the shared limiter and adds proposals; the
call site and error code do not change.

**Who may trade.** Signed-in, not suspended, market `open` and before `close_at`, balance sufficient for a buy,
and a sell only up to the contracts held on that side. A user may hold both YES and NO in one market.
The DB `CHECK (points >= 0)` is the backstop for the balance check, not a replacement.

## Order ticket (UI)
Pattern adopted from `order-ticket.md` (behavior only), tokens and copy from `docs/design/theme.md`.
- Placement: right card from 1024 px; below it, YES/NO buttons under the chart open the same ticket as a bottom sheet.
- Controls: `Buy | Sell` tabs; YES/NO segmented toggle with words and the price in each segment ("YES 62 pts",
  "NO 38 pts"); unit toggle `Points | Contracts` (Buy only; Sell is contracts); one amount input; `Max` fills the
  held contracts (Sell) or the whole balance capped at the per-trade maximum (Buy).
- Quote rows, Buy: `Avg price 51 pts (51% to break even)`, `Contracts 9.76` (or `You pay 500 pts`), `Payout if YES
  976 pts`, `New price 52%`. Sell: `Avg price`, `You receive`, `New price`, `Left in position`.
  Price impact above 5 percentage points shows a warning chip and the button reads "Buy YES anyway".
- **Quote = fill.** `lib/ticket-quote.ts` `buildTicketQuote(state, tab, side, unit, amountText)` is pure and calls
  the same engine function the server calls (`server/quote.ts` and the client both import the engine through the
  same adapter shape). Display is debounced about 150 ms; the 3 s poll recomputes the on-screen quote from fresh
  `{b, qYes, qNo}`. The server recomputes from locked `q`; the two differ only if `q` moved.
- Submit sends `expectedAvgPrice` = the displayed average price, `maxSlippage` 2 (advanced select: 1, 2, 5), and a
  key from `crypto.randomUUID()`. **Key lifecycle:** keep the same key when retrying an identical submission after
  a network error or timeout; generate a new key whenever side, unit, amount, or `expectedAvgPrice` changes.
- **Slippage UX.** On `slippage_exceeded` the ticket swaps in `requote` and shows "The price moved from 51 to 54
  pts. Review the new price." with the button "Buy at 54 pts" (sets the new `expectedAvgPrice` and a new key). Never auto-resubmit.
- States: logged out (quote works; CTA "Sign in to trade"); suspended ("Your account can't trade right now");
  closed/resolved ("Trading is closed", inputs disabled); pending (button disabled, spinner, `aria-busy`);
  success ("Bought 9.76 YES contracts for 500 pts.", balance and position refresh, input cleared);
  error (inline, `role="alert"`, fixed copy per code: "Not enough points: you have 320 and need 500",
  "You only hold 4.2 YES contracts", "Too small: the smallest trade is 0.01 contracts", "Too big: the most you
  can buy at once here is 5,000 pts", "Slow down a little and try again in 12 s", "Trading is paused").
- Copy lives in `lib/trade-copy.ts`; a test scans it and every ticket string for `bet|wager|prize|cash out|\$|¢`.
- Accessibility: radiogroup semantics for the toggles, labelled input, quote rows in an `aria-live="polite"` region.
- Polling: `GET /api/markets/[id]/state` (`no-store`) returns `{status, closeAt, b, qYes, qNo, probabilityYes}` plus, when
  signed in, `{balance, position}`; the page polls every 3 s while visible and stops when the tab is hidden.

## Positions and portfolio
- Detail page "Your position" card (signed-in, any holding): contracts YES/NO, net cost basis, value now,
  `Pays 976 pts if YES` / `Pays 120 pts if NO`.
- `/portfolio` (redirects signed-out users to sign-in): header with balance, total value of open positions, and
  their sum; one row per market with a nonzero position (open and closed first, by `close_at`): market link,
  status chip, YES and NO contracts, cost basis, value now, pays if YES / NO, change vs cost basis; then the last
  20 trades (side, contracts, points, price, time).
- Definitions (`server/portfolio.ts`, `getPortfolio(db, userId)`): NO price = `100 − displayPrice(probabilityYes)`;
  value now = `round(contracts × displayPrice(side))` summed over both sides, labelled "about" because it ignores
  price impact; pays if win = `floor(contracts × 100)`; change = value now − `cost_basis_points`. Cost basis is per
  market (schema), so there is no per-side average cost. Resolved-market P&L is M4.

## Price chart
Recommend a **hand-written SVG component** (`components/PriceChart.tsx`, about 150 lines), no dependency. One series
of at most 200 points; probabilities are constant between trades, so a step-after line reads truthfully; theme tokens
apply directly to SVG via `currentColor`/CSS variables (YES line plus 10–15 % area, `border` grid, `muted` labels);
no client bundle cost (recharts is roughly 100 KB gzipped, uPlot about 15 KB but canvas, which ignores the CSS tokens
and is harder to make accessible). Revisit only if M4 adds multiple series.
- Data: `getPriceHistory(db, marketId, range)`; downsample to the last snapshot per time bucket; prepend a start point
  (`opened_at ?? created_at`, first trade's `prob_before`, else 0.5) and append "now" at the current probability.
- Ranges `1D · 1W · ALL` (default `1W`, per market-page note); headline change = last − first in range, shown as "up 4" / "down 3".
- Hover/touch shows a crosshair with time and "NN%"; the SVG has `role="img"` and an `aria-label` summary ("YES chance
  rose from 50% to 62% over the last week"); under 2 points, show "No trades yet" instead of a line.

## Ledger invariant job
`server/invariants.ts` `checkTradingInvariants(db)` returns `{ ok, ledgerSum, balanceMismatches, issues[] }`, calling
`checkLedgerInvariants` plus, per market:
- **Positions vs q:** for `open`/`closed` markets, `Σ positions.contracts_yes == q_yes` and `Σ contracts_no == q_no`
  (exact, compared as micro-integers). Resolved/voided markets are skipped until M4 defines what happens to positions.
- **Trades vs q:** `Σ trades.contracts` per side `== q` for every market (trades are immutable, so this holds in all statuses).
- **Per-user:** each position equals the sum of that user's trades per side, and `cost_basis_points == Σ cost_points`.
- **Pool vs trades:** for `open`/`closed` markets, `market_pool` ledger sum `== Σ trades.cost_points` (exact integers).
Route `GET /api/cron/ledger-invariants` requires `Authorization: Bearer ${CRON_SECRET}` (constant-time compare;
`CRON_SECRET` unset or wrong -> 401, fail closed). Success: 200 `{ ok: true, checkedAt }`. Violation: log one
`console.error` JSON line `{event:"ledger_invariant_violation", …ids only, no emails}` and return 500 so the Vercel
log and cron status show the failure (SOP-06 incident P1). Scheduled daily in `vercel.json`; also called by the
unit tests (after every `placeTrade` test, via a shared `afterEach`) and by the Playwright loop.

## Tests
**`placeTrade` unit tests (PGlite, written first).** Each asserts the DB afterwards (trade, position, `q`, two ledger
rows, balance, snapshot):
1. Worked example: b=100, q=(0,0), 500 points on YES -> 9.76 contracts, `costPoints` 500, balance −500, pool +500.
2. Buy by contracts, and the same via NO; sell part of a position; sell all (close-out).
3. A buy then an identical sell restores `q`; balance ends at or below the start (pool rounding).
4. Rejections write nothing (compare a full-table snapshot): each code in the taxonomy, including `market_closed`
   (status `open`, `close_at` in the past), suspended user, unknown market, `q` too small to sell into.
5. `slippage_exceeded` carries `requote`; a retry with `expectedAvgPrice = requote.avgPrice` succeeds.
6. Size rules: 0.009 contracts rejected; 0.01 accepted; dust close-out of 0.004 contracts accepted; buy above
   `min(5000, 50·b)` rejected; `payoutIfWin < costPoints` rejected.
7. Idempotency: same key twice -> one trade, `replayed: true`, balance debited once; same key after the market
   closed still returns the original; same key with a different side, amount, mode or `expectedAvgPrice` ->
   `idempotency_key_reused` (nothing written); same key from two
   users are independent; `Promise.all` of 5 identical calls -> one trade.
8. Numeric boundary: `parseNumeric`/`formatNumeric` round trip for 1e-6, 0.1+0.2-style sums, 2e9; q after 1,000 tiny trades is still an exact multiple of 1e-6.
9. `TRADING_PAUSED`, rate limit (21st trade in a minute), balance row missing (new user with 0 points).
10. Copy guard and `buildTicketQuote` unit tests (pure): quote equals the server's quote for the same state.

**Property test (fast-check, PGlite, one DB per file, a fresh market per run).** Random sequences (<= 12) of
{user from 3, side, mode, amount} against 1–2 markets. After each run: `ledgerSum == 0`, no balance mismatches,
`checkTradingInvariants` ok, pool loss `<= 100·b·ln 2`, no `internal_error`, every rejection has a taxonomy code,
and no user holds negative contracts or a negative balance (affordability is enforced by `placeTrade`; the CHECK is the backstop).

**Concurrency (real Postgres).** PGlite runs one connection, so it cannot exercise row locks; parallel calls there
only prove logic. CI already has the `postgres:16` service and sets `TEST_DATABASE_URL` (added with the review fixes;
it already gates the migration, append-only, RLS, auth-hook and row-locking integration tests), so these tests need no
new CI plumbing. One integration file `trading.concurrency.test.ts` runs when `TEST_DATABASE_URL` is set
(`describe.skipIf`; skipped locally with a console note) and creates a throwaway database per file:
- Two parallel trades on one market: both succeed, the second's `prob_before` equals the first's `prob_after`, invariants hold.
- **Lock witness:** hold `SELECT … FOR UPDATE` on the market in an outside connection, start `placeTrade`, poll
  `pg_stat_activity` until it shows `wait_event_type = 'Lock'`, release, and assert it then completes.
- One user, two markets, in parallel, balance enough for one: exactly one succeeds, the other is `insufficient_balance`.
- Same idempotency key sent 5x in parallel (and for two markets at once): one trade row, every call gets that trade.
- 20 mixed trades from 5 users on 2 markets in parallel: no deadlock, invariants hold.
The `e2e` job (below) reuses the same service shape: `postgres:16`, `POSTGRES_PASSWORD`, `ports: ["5432:5432"]`,
`--health-cmd "pg_isready -U postgres"`, and `TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres`.

**Playwright e2e** (`apps/web/e2e/trade-loop.spec.ts`, new `@playwright/test` dev dependency, `npm run e2e`, separate
CI job `e2e`: Postgres service, `db:migrate`, `db:seed`, `next build && next start`, `npx playwright install --with-deps chromium`).
Authentication without email, preferred: the test setup creates the user and a real session through the Supabase
service role / admin API (`auth.admin.createUser` + `generateLink`/`verifyOtp`, or an admin-minted session) against a
throwaway project or the local stack, then injects the resulting auth cookies into Playwright. No bypass code ships
in the app bundle. **Fallback only if that proves impractical:** a test-only route `POST /api/test/session` (body:
email) that creates the profile with `grantSignupBonus` and sets an HMAC-signed `e2e-session` cookie;
`getCurrentUser()` accepts that cookie only when `isE2EAuthEnabled()` is true. **Guard (one function, unit-tested,
including a case with `VERCEL=1`):** `E2E_AUTH_BYPASS === "1"` AND `E2E_AUTH_SECRET`
is set AND `process.env.VERCEL` is unset. `NODE_ENV` is not usable because `next start` forces `production`; Vercel
always sets `VERCEL`, so the bypass cannot run on production or previews even if the flag leaks there. The route returns
404 when the guard is false. Tests:
- Trade loop: sign in -> open a seeded market -> type 500 points on YES -> quote shows -> submit -> success text, balance
  down by the shown cost, position card and `/portfolio` row appear, headline price rises, chart SVG present -> sell half
  -> balance up, position halves -> call the invariant route with `CRON_SECRET` -> 200.
- Stale quote: a second seeded user moves the price through the helper before submit -> ticket shows the requote
  message -> confirm -> success at the new price.
- Signed out: ticket shows "Sign in to trade"; `/portfolio` redirects.

## Data touched
- Reads: `profiles`, `markets`, `balances`, `positions`, `trades`, `price_snapshots`, `ledger_entries`, `categories`.
- Writes per trade: `trades` (1), `positions` (upsert), `markets.q_yes/q_no`, `ledger_entries` (2, reason `trade`,
  `ref_type = 'trade'`), `balances` (via `postTransfer`), `price_snapshots` (1). Ledger reasons used: `trade`.
- Migration (one): `trades(user_id, created_at)` index for the rate limit and portfolio history; `CHECK (points >= 0)`
  on `balances` (defense in depth beside `placeTrade`'s balance check; see architecture §6 "Balance floor", which is
  **proposed, owner to confirm** together with the M4 void-debit policy, so confirm before this ships); and a
  nullable `trades.request_fingerprint` text column holding a hash of the normalized input, so a replay can compare
  the full original input. No new tables.
- Env vars (add each to `apps/web/.env.example`): `CRON_SECRET`,
  `TRADING_PAUSED` (already in SOP-07), `TRADE_RATE_LIMIT_PER_MIN` (optional, 20), `TEST_DATABASE_URL` (CI/tests only),
  `E2E_AUTH_BYPASS`, `E2E_AUTH_SECRET` (e2e only; never set on Vercel).

## Risks / open questions
Conflicts found between architecture and code (resolved here, decisions recorded):
1. §6 locked only the market; `postTransfer` upserts `balances` with no floor and M2a deliberately has no `points >= 0`
   CHECK. Two markets traded at once would overdraw. Resolved: lock the balances row (step 5), test it on real Postgres,
   and add the CHECK in this slice's migration (architecture §6 "Balance floor"; owner to confirm, including how M4
   voids fund a user whose `void_refund` is a debit larger than their balance).
2. §6 step 5 says a duplicate key "returns the original", but the unique key is `(user_id, key)` while the lock is per
   market, so a duplicate key across two markets is not serialized. Resolved: `ON CONFLICT DO NOTHING` plus re-read (step 8).
3. §4/§7 `positions.cost_basis_points` is per market, not per side, so per-side average cost is unavailable (portfolio shows market-level basis only).
4. §6 says the close cron runs "every minute"; Vercel Hobby cron is, to my knowledge, once per day (SOP-07 corrected).
   Verify before M4 relies on it (owner to-do: Pro vs GitHub Actions `schedule`); the invariant job only needs daily.
5. M1 spec says M3 must enforce a minimum trade size: done above. The engine itself still accepts 1e-6 contracts.
6. The market-page research note uses `¢`; the theme forbids currency signs. Ticket uses "pts" and "%".
Open:
- Positions-vs-q after resolve/void is undefined until M4 (zero positions? keep q?); the check skips those statuses.
- Per-trade cap 5,000 and `maxSlippage` choices are proposals; the human may tune them (constants in one file).
- Supabase free tier pauses idle projects; the daily job also keeps `prod` awake (SOP-07).
- Depends on the sign-in slice for `requireUser()` / `getCurrentUser()`; core `placeTrade` and tests do not, so build them first.
- Whether market pages require sign-in (SOP-09 says yes for MVP; currently public) is an owner decision; the ticket's signed-out state assumes pages stay public until it is made.
- Engine edge: `MIN_TRADE_CONTRACTS` could live in `packages/engine` so the size rule sits with the math; today it is `server/trade-limits.ts`.

## Before placeTrade writes ledger_entries (carried from the M2 review)
The M2 review (security audit GO, code review approve, tests adequate for M2) left these for M3. All must be
done before `placeTrade` ships.

Tests:
- [ ] Concurrent `grantSignupBonus` on real Postgres credits exactly once.
- [ ] The signup-bonus partial unique index rejects a second user bonus row.
- [ ] `anon` and `authenticated` read and write nothing under RLS, tested by switching roles on real Postgres.
- [ ] Concurrent overlapping `postTransfer`s do not deadlock and keep `SUM = 0` and balances = ledger.
- [ ] `adaptSupabaseAuth` maps real `AuthApiError` values.
- [ ] The ledger and profiles suites run in the CI Postgres job, not only the integration file.
- [ ] `migrations.test.ts` checks the journal length, not a hard-coded migration count.
- [ ] No test-order coupling in `ledger.test.ts` and `migrations.test.ts`.

Database and server:
- [ ] A non-owner app role (for example `mc_app`) with only `SELECT`/`INSERT` on `ledger_entries` and `trades`;
  migrations still run as owner. Recorded in a new ADR.
- [ ] `REVOKE ALL` on public tables from `anon` and `authenticated`, plus default privileges, in a new migration.
- [ ] Refuse to connect in production (`VERCEL_ENV=production`) when `DATABASE_CA_CERT` is unset.
- [ ] Indexes on `trades(market_id)`, `positions(user_id)`, `ledger_entries(ref_type, ref_id)`.
- [ ] A `markets` CHECK tying `outcome` to `status`.
- [ ] `import "server-only"` in server modules.

Engine use in `placeTrade` (from the engine review on `feat/m2-integrate`):
- [ ] `withinSlippage` compares `avgPrice`, which measures how far the price moved from the exact cost. The
  one-point minimum charge on tiny buys is not price movement, so the order ticket shows `costPoints`. For
  contract-amount orders, `placeTrade` also rejects when the fill's `costPoints` is more than
  `ceil(maxSlippage × contracts)` above the quoted `costPoints`. Point-budget orders are already capped by
  `quotePoints`.
- [ ] `applyFill` does not tie `costPoints` to `contracts`, so `placeTrade` builds every fill from a fresh engine
  quote, never from client input.
- [ ] `settlePayouts` and `voidRefunds` find duplicate users by `Map` key identity, so callers key them by user id
  strings, never by objects.

Later (M5):
- Per-email wrong-code lockout.
- Supabase cookie options `httpOnly`, `secure`, `sameSite: "lax"`.
- Security headers: CSP with `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`.
- Pin GitHub Actions to commit SHAs.
- Reject sign-out requests with no `Origin` header.

## Tasks
Parallel chunks A–D start after task 0. Each chunk can go to a separate implementer.
0. **Contract** — `server/trade-types.ts` (`TradeInput`, `TradeResult`, error codes, `MarketStateDto`), `trade-limits.ts`, `numeric.ts` + tests. Verify by: unit tests; chunks A–D import only these.
**A. Server action**
1. `parseNumeric`/`formatNumeric`, `server/quote.ts` engine adapter, size rules — TDD. Verify by: tests 6 and 8.
2. `placeTrade` core, tests 1–9 first (red), then green. Verify by: PGlite suite incl. rejections-write-nothing.
3. Property test. Verify by: 100 runs green; mutating the lock/idempotency code makes the concurrency or property test fail.
4. `placeTradeAction`, `checkTradeRateLimit` + index migration, `TRADING_PAUSED`, state endpoint. Verify by: `npm run db:generate` clean; route test.
**B. Ticket UI** (uses types from 0; mocks the action until A4)
5. `buildTicketQuote` + `trade-copy.ts` + copy guard — TDD. Verify by: quote equals server quote; banned-word scan.
6. `OrderTicket` (desktop card, mobile sheet), polling hook, all states and slippage re-quote. Verify by: manual 390 px and 1280 px screenshots, keyboard and screen-reader pass.
**C. Portfolio and chart**
7. `getPortfolio`, `getPriceHistory` (+ downsampling) — TDD on PGlite. Verify by: loader tests with fixtures from `placeTrade`.
8. `PriceChart`, position card, `/portfolio`. Verify by: render tests, screenshot light/dark, `aria-label` summary.
**D. Invariants and CI**
9. `checkTradingInvariants` + deliberate-corruption tests (corrupt rows directly in a test DB, for example `UPDATE markets SET q_yes` or an extra `positions` row; the append-only triggers cover only `ledger_entries` and `trades`) — verify by: each issue type is detected.
10. Cron route, `vercel.json`, `CRON_SECRET` check. Verify by: 401/200/500 route tests; log line shape.
11. Concurrency suite on the existing CI Postgres service (lock witness, balance race, key race). Verify by: green in CI; skipped with a note locally.
**E. Integration (last)**
12. E2E auth via the service role / admin API (fallback: test-session route with `isE2EAuthEnabled` + guard tests), Playwright config, trade-loop spec, CI `e2e` job. Verify by: e2e green in CI; with `VERCEL=1` the test route returns 404.
13. Adversarial review (doubt-driven) of `placeTrade`; `/security-review`; confirm `docs/architecture.md` §6/§9 (balances lock, idempotency order, balance floor) still match the code; SOP-06 invariant-alert steps. Verify by: findings fixed or recorded here.

## Execution plan (orchestrator, 2026-10-29)

Built on branch `feat/m3-trading` in waves; each implementer works in its own git worktree and branch, and the orchestrator merges, runs the gate, and reviews between waves. Merge to `main` waits for the owner's confirmation of the two assumptions below.

Assumptions (recommended defaults from this spec, owner to confirm before merge to `main`):
1. Balance floor: `CHECK (points >= 0)` on `balances` ships in this slice; for M4 voids, a `void_refund` debit larger than a user's balance is covered by a separate house → user entry (architecture §6 "Balance floor").
2. Per-trade cap `min(5000, 50·b)` points and slippage choices 1 / 2 / 5 points as proposed.
3. E2E authentication uses the guarded test-session route (the fallback above): CI has no Supabase project or service-role secret.
4. App database role: a migration creates a `NOLOGIN` role `mc_app` with the minimum grants (no UPDATE/DELETE/TRUNCATE on `ledger_entries` or `trades`); migrations use `MIGRATION_DATABASE_URL` (owner) when set, else `DATABASE_URL`. The owner enables login for `mc_app` and points `DATABASE_URL` at it (new owner step); until then the app keeps working as today. Recorded in ADR-0006.

Waves:
- **Wave 1** (parallel): (a) database hardening and the M2-review test items: migrations for REVOKE + default privileges, indexes, the `markets` outcome/status CHECK, the `balances` floor, `trades.request_fingerprint`, the `trades(user_id, created_at)` index, the `mc_app` role and ADR-0006; RLS-by-role, unique-index and real-Postgres concurrency tests for `grantSignupBonus` and `postTransfer`; journal-length migration test; no test-order coupling; ledger and profiles suites in the CI Postgres job. (b) Task 0 and task 1 (contract types, trade limits, numeric boundary, `server/quote.ts` adapter, size rules) plus `server-only` imports, the production `DATABASE_CA_CERT` guard and `adaptSupabaseAuth` tests.
- **Wave 2** (parallel): tasks 2–4 (`placeTrade`, property test, action, rate limit, pause switch, state endpoint); tasks 5–6 (ticket quote, copy, order ticket against the types); task 9–10 (`checkTradingInvariants`, cron route).
- **Wave 3** (parallel): tasks 7–8 (portfolio, price history, chart, position card); task 11 (concurrency suite); wiring the ticket to the real action.
- **Wave 4**: task 12 (e2e and CI job), task 13 (adversarial review of `placeTrade`, security review), ship.

## Definition of Done
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example`
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human

## Next
Hand chunks A–D to implementers after task 0; the orchestrator adds the README row. M4 decides positions after
resolve/void and extends `checkTradingInvariants` accordingly.
Ticket UI (tasks 5–6) is built as `LiveOrderTicket` in `components/market/order-ticket.tsx`; still to do: replace `OrderTicketPlaceholder` on `/markets/[slug]` (pass `placeTradeAction` as `submit`, the state DTO, account and `now`), then the 390 px / 1280 px screenshots and keyboard and screen-reader pass.
