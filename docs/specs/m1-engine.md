# M1 — LMSR market engine
Status: in-progress · Milestone: M1 · Research: docs/research/kalshi/order-ticket.md · ADRs: 0001, 0002

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
- [ ] Worked example (§5): b=100, q=(0,0), 500 points on YES → ≈ 9.75 contracts, avgPrice ≈ 51, probAfter ≈ 0.524, payoutIfWin 975 or 976 (floor of contracts×100), costPoints ≤ 500 and ≥ 499.
- [ ] Property 1: `probYes + probNo = 1` (within 1e-12) and `0 < p < 1` for all finite q with |q| ≤ 50·b.
- [ ] Property 2: raw cost(0) = 0; raw cost strictly increasing and convex in Δ.
- [ ] Property 3: buy Δ then sell Δ (rounded) never returns more points than were paid.
- [ ] Property 4: under random sequences of buys/sells by simulated users (who only sell what they hold), pool liability `max(qYes, qNo)·100 − (sum of user costPoints)` never exceeds `100·b·ln 2`.
- [ ] Property 5: `quoteBuyWithPoints(c).costPoints ≤ c` and `≥ c − 1` whenever c ≥ 1 point and the market is not at an extreme (p ∈ [0.01, 0.99]).
- [ ] Property 6: for random trade sequences, `voidRefunds` restores every user's balance exactly to its pre-market value (integer arithmetic, no drift).
- [ ] Extra: no overflow/NaN for q up to ±1e6 with b = 50; quote for a buy and the matching `nextState` agree (`probAfter == probYes(nextState)`).
- [ ] ≥ 95 % line coverage in `packages/engine` (`@vitest/coverage-v8`), enforced by a threshold in the engine's vitest config.

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

## Definition of Done
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points (none in M1)
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example` (none)
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human (no UI change in M1)

## Next
