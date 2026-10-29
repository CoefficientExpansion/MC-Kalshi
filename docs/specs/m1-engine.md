# M1 — LMSR market engine
Status: done · Milestone: M1 · Research: docs/research/kalshi/order-ticket.md · ADRs: 0001, 0002

## Problem
Every later milestone (ticket quotes, `placeTrade`, resolution, void) needs one trusted
implementation of the market math. It must be pure, deterministic, and provably safe for the
pool: rounding never leaks points to traders, the pool's loss is bounded, and a void returns
everyone exactly to where they started. Architecture §5 is the source of truth for formulas.

## Scope
In (`packages/engine`, pure TypeScript, zero runtime deps):
- Market state `{ b, qYes, qNo }`; `b` validated to 50–500 for new markets (`validateLiquidity`).
- Cost function `C(q)` and `probYes` / `probNo` via log-sum-exp (no overflow for any finite q).
- `displayPrice(p)`: integer 1–99 (`round(p·100)`, clamped).
- Contract rounding: every contract amount the engine returns is a whole number of
  micro-contracts (multiple of 1e-6). Internally use integer micro-contracts where it helps.
- `quoteBuyWithPoints(state, side, points)`: closed-form budget inversion, contracts floored to
  6 dp, cost rounded **up**; guaranteed `costPoints ≤ points` (step contracts down by 1e-6 if
  float error pushes `ceil` over budget).
- `quoteBuyContracts(state, side, contracts)`: cost rounded **up**.
- `quoteSellContracts(state, side, contracts)`: proceeds rounded **down**; `costPoints` is
  negative (proceeds), matching the `trades.cost_points` sign convention.
- Every quote returns `{ side, contracts, costPoints, avgPrice, probBefore, probAfter, payoutIfWin, nextState }`.
  `contracts` signed (+ buy, − sell); `avgPrice` = |costPoints| / |contracts| (points per
  contract, 0–100); `payoutIfWin` = floor(contracts × 100) for buys, 0 for sells;
  `probBefore`/`probAfter` are P(YES).
- `withinSlippage(expectedAvgPrice, fill, maxSlippagePoints = 2)`: buys reject if
  `fill.avgPrice > expected + tol`; sells reject if `fill.avgPrice < expected − tol`.
- `applyFill(position, fill)`: returns the new position `{ contractsYes, contractsNo, costBasisPoints }`
  (cost basis += costPoints; contracts stay 6 dp exact).
- `settlePayouts(positions, outcome)`: per-user `floor(winningContracts × 100)` payout
  (rounds down, favors the pool).
- `voidRefunds(positions)`: per-user refund = `costBasisPoints` (net cost; may be negative if a
  user sold for more than they paid — then the refund is a debit).
- Errors: `RangeError` for non-finite inputs, non-positive amounts, `b` out of range, selling
  more than `qSide` (would drive the AMM's q below 0).

Out: any I/O, DB types, rate limits, balance checks (server's job), multi-outcome markets.

## Acceptance criteria
- [x] Worked example (§5): b=100, q=(0,0), 500 points on YES → ≈ 9.75 contracts, avgPrice ≈ 51, probAfter ≈ 0.524, payoutIfWin 975 or 976 (floor of contracts×100), costPoints ≤ 500 and ≥ 499. (quote.test.ts: "worked example (architecture §5)" › "b = 100, q = (0, 0), 500 points on YES gives about 9.76 contracts"; actual: 9.761859 contracts, costPoints 500, payoutIfWin 976)
- [x] Property 1: `probYes + probNo = 1` (within 1e-12) and `0 < p < 1` for all finite q with |q| ≤ 50·b. (lmsr.test.ts: "property 1: p_yes + p_no = 1 (1e-12) and 0 < p < 1 for all finite |q| ≤ 50·b", plus the q = ±1e6 extremes test)
- [x] Property 2: raw cost(0) = 0; raw cost strictly increasing and convex in Δ. (lmsr.test.ts: "property 2: raw cost(0) = 0, strictly increasing and convex in Δ")
- [x] Property 3: buy Δ then sell Δ (rounded) never returns more points than were paid. (quote.test.ts: "property 3: buy Δ then sell Δ never returns more points than were paid" and its by-points variant)
- [x] Property 4: under random sequences of buys/sells by simulated users (who only sell what they hold), pool liability `max(qYes, qNo)·100 − (sum of user costPoints)` never exceeds `100·b·ln 2`. (positions.test.ts: "property 4: pool liability max(qYes, qNo)·100 − Σ costPoints never exceeds 100·b·ln 2" and the settlement variant)
- [x] Property 5: `quoteBuyWithPoints(c).costPoints ≤ c` and `≥ c − 1` whenever c ≥ 1 point and the market is not at an extreme (p ∈ [0.01, 0.99]). (quote.test.ts: "property 5: costPoints ≤ c and ≥ c − 1 for c ≥ 1 and p ∈ [0.01, 0.99]")
- [x] Property 6: for random trade sequences, `voidRefunds` restores every user's balance exactly to its pre-market value (integer arithmetic, no drift). (positions.test.ts: "property 6: voidRefunds restores every user's balance exactly (integer arithmetic)")
- [x] Extra: no overflow/NaN for q up to ±1e6 with b = 50; quote for a buy and the matching `nextState` agree (`probAfter == probYes(nextState)`). (quote.test.ts: "no overflow or NaN for q up to ±1e6 with b = 50" and "property: probAfter == probYes(nextState), ..."; lmsr.test.ts: cost/probability extremes)
- [x] ≥ 95 % line coverage in `packages/engine` (`@vitest/coverage-v8`), enforced by a threshold in the engine's vitest config. (`npx vitest run --coverage` in packages/engine: 100 % lines; threshold in vitest.config.ts verified to fail the run below 95 %)

## Data touched
None (pure package). Shapes chosen to map 1:1 onto `trades`, `positions`, `markets.q_*` in M2/M3.

## UX
None directly. The order ticket (M3) shows `avgPrice`, `payoutIfWin`, `probAfter` from these quotes.

## Risks / open questions
- Float error at the rounding boundaries: mitigated by integer micro-contracts and the
  step-down loop in budget inversion; covered by property 5.
- Settlement rounding leaves the pool with fractional surplus; the `house` account absorbs it
  at the ledger layer (M4), not here.

## Tasks
1. Add `@vitest/coverage-v8` and a 95 % threshold — verify by: `npx vitest run --coverage` in the engine.
2. Core math (`lmsr.ts`): cost, probabilities, display price, liquidity validation — TDD; verify by: unit tests + properties 1–2.
3. Quotes (`quote.ts`): buy-by-points, buy-by-contracts, sell — TDD; verify by: worked example + properties 3, 5.
4. Positions and settlement (`positions.ts`): applyFill, settlePayouts, voidRefunds, withinSlippage — verify by: properties 4, 6.
5. Re-export from `index.ts`; docs updated — verify by: `npm run typecheck && npm run lint && npm test` green.
6. Adversarial review of rounding and invariants (doubt-driven) — findings fixed or recorded below.

## Review (task 6): adversarial pass, 2026-10-29
An independent agent tried to break the engine: ~180k quotes checked against a 120-digit
Decimal reference, ~2.4M single-user and ~900k multi-user random trades (round-trip and
both-sides arbitrage, dust vs whale, extreme states), 200k-trade drift, 1.2M garbage inputs,
and 25 mutants. **No pool leak and no invariant violation.** Pool loss peaked at 99.994 % of
`100·b·ln 2`; voids refunded exactly; q stayed an exact multiple of 1e-6.

Fixed (with regression tests):
- `assertState` now enforces `b` in 50–500 on every quote. A corrupt row with `b ≈ 1e20` made the
  budget step-down loop crawl one micro-contract at a time.
- `applyFill` rejects a buy costing < 1 point and a sell that charges the user, so a fill not
  built by a quote cannot hand out free contracts.
- `toMicro` rejects |amount| > 2^51 micro-contracts (~2.25e9 contracts). The micro round trip
  stops being exact near 4.29e15.

Accepted, not fixed:
- Float error can make a buy's `ceil` land 1 point low when the true cost is within ~1e-11 of an
  integer (10 in 120k trials, budgets ≥ 1.7M points). The real shortfall is ~1e-11 points, not
  exploitable; an epsilon would distort exact-integer budgets.
- Dust trades: a 1e-6-contract buy costs 1 point (`avgPrice` 1,000,000). M3's ticket and
  `placeTrade` should enforce a minimum trade size.
- Two mutants (sell ×1.0000001, buy −1e-6 point bias) survive: the suite has no
  high-precision reference test. Worth adding a BigInt/Decimal cross-check if the math changes.

## Definition of Done
- [x] Acceptance criteria met and demonstrated (test or screenshot)
- [x] Unit tests for logic; Playwright for any user-visible flow that moves points (none in M1)
- [x] `npm run typecheck && npm run lint && npm test` green locally (CI: confirm on the branch)
- [x] No secrets in code; new env vars documented in `.env.example` (none)
- [x] Docs or ADR updated when behavior or a decision changed
- [x] Preview deploy checked by a human (n/a: no UI change in M1)

## Next
Merge the branch to `main` (squash). M3 must add a minimum trade size (see Review).
