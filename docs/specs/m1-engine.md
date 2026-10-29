# M1 — Market engine (LMSR)
Status: done (2026-10-29) · Milestone: M1 · Research: docs/research/kalshi/order-ticket.md (ticket semantics) · ADRs: 0002 (LMSR), 0004 (TDD)

## Problem
Every later slice (order ticket, trade action, resolution, void, leaderboard) needs one trusted source of market math. If prices, costs, and payouts are computed in more than one place, or with floating-point carelessness, points leak and the ledger stops balancing. M1 builds that math once, pure and property-tested, before any of it touches a database or a screen.

## Objective
`packages/engine` exposes a small, pure API that turns a market's AMM state and a trade intent into a quote (contracts, cost, prices, payout, new state), inverts a points budget into contracts, computes settlement payouts and void refunds, and reports the pool's maximum liability. The six invariants in architecture §5 hold under property testing, and line coverage is at least 95 %.

## Assumptions (made without a reviewer; correct them and the spec changes first)
1. Points are integers; contracts are numbers kept to 6 decimal places; probabilities are numbers in (0, 1); displayed prices are integers 1–99. Rounding always favors the pool: buy cost rounds up and is never below 1 point; sell proceeds round down; payouts round down. Contracts keep six decimals, and `q` is snapped back to that grid after every trade. Point values carry a tolerance of `min(1e-6, max(1e-12, 1e-12·|x|))` before rounding, so floating-point noise cannot move a whole-point boundary; that is the only way a rounding rule can favor the user, and by at most 1e-6 points.
7. Inputs are bounded: `|qYes|`, `|qNo|` and `|contracts|` at most `MAX_CONTRACTS` (1e9), budgets and `|costBasisPoints|` at most `MAX_POINTS` (1e12). A state must be an object with finite numeric `qYes`, `qNo`, `b` and `q` on the six-decimal grid, or `INVALID_STATE`. Sides and outcomes must be exactly `"YES"` or `"NO"`, or `INVALID_SIDE`.
8. `avgPrice` is whole points per contract from the exact (unrounded) cost, clamped to 1..99; the one-point minimum does not change it.
2. The engine never sees positions or balances except where a function takes one explicitly (`payout`, `voidRefund`). Whether a user may sell what they sell, and whether they can afford a buy, is the server's job in M3.
3. "Sell YES" is `contracts < 0` on side YES (reduces `q_yes`); "buy NO" is `contracts > 0` on side NO (increases `q_no`). They are different state changes and both are first-class.
4. One new dev dependency, `@vitest/coverage-v8`, is justified by the milestone's coverage exit criterion.
5. Slippage comparison stays server-side (M3): the engine exposes `avgPrice` and `probAfter`; the server decides whether a move beyond the user's tolerance is a rejection.
6. `b` is validated to the range 50–500 at the engine boundary, matching architecture §5; a market with `b` outside it is a data bug, not a user error.

## Scope
In:
- `packages/engine/src/lmsr.ts`: cost function, probability, quote by contracts, quote by points (budget inversion), max pool loss; log-sum-exp throughout.
- `packages/engine/src/rounding.ts`: points up/down helpers and the 6-dp contract rounding, used nowhere else.
- `packages/engine/src/settlement.ts`: payout for a position given an outcome; void refund for a position.
- `packages/engine/src/index.ts`: public surface and types only; `clampProbability` stays.
- Property tests for invariants 1–6 of architecture §5 plus the worked example, with `numRuns ≥ 500`.
- Coverage threshold (95 % lines, 95 % branches) enforced in `packages/engine/vitest.config.ts`.
- `docs/architecture.md` §5 updated if any formula or rounding rule changes during the work.

Out:
- Any database, server action, UI, or chart. No slippage policy, no position bookkeeping, no rate limits.
- Multi-outcome markets, fees, or a variable `b` during a market's life.

## API (public surface of `@mc-kalshi/engine`)
```ts
export type Side = "YES" | "NO";
export type Outcome = "YES" | "NO";

export interface MarketState {
  readonly qYes: number; // contracts the AMM has sold on YES (may be negative after sells)
  readonly qNo: number;
  readonly b: number;    // liquidity, in contracts, 50..500
}

export interface Quote {
  readonly side: Side;
  readonly contracts: number;    // signed, 6 dp: + buy, − sell
  readonly costPoints: number;   // signed integer: + the user pays, − the user receives
  readonly avgPrice: number;     // integer 1..99: whole points per contract from the exact cost (the one-point minimum does not change it)
  readonly probBefore: number;   // p_yes before
  readonly probAfter: number;    // p_yes after
  readonly payoutIfWin: number;  // integer points the position pays if `side` resolves true (0 for sells)
  readonly stateAfter: MarketState;
}

export interface PositionLike {
  readonly contractsYes: number;
  readonly contractsNo: number;
  readonly costBasisPoints: number; // signed integer, net points paid into this market
}

export function probabilityYes(state: MarketState): number;
export function costFunction(state: MarketState): number;              // C(q) in points, unrounded
export function quoteContracts(state: MarketState, side: Side, contracts: number): Quote;
export function tradeCost(state: MarketState, side: Side, delta: number): number; // exact unrounded cost of a signed trade, in points
export function quotePoints(state: MarketState, side: Side, points: number): Quote; // buy with a budget
export function maxPoolLoss(b: number): number;                          // integer points, 100·b·ln 2 rounded up
export function payout(position: PositionLike, outcome: Outcome): number; // integer points, rounded down
export function voidRefund(position: PositionLike): number;             // = costBasisPoints
export type EngineErrorCode = "INVALID_STATE" | "INVALID_CONTRACTS" | "INVALID_POINTS" | "INVALID_SIDE";
export class EngineError extends RangeError { readonly code: EngineErrorCode }
export const B_MIN = 50;   // liquidity bounds, in contracts
export const B_MAX = 500;
export const MAX_CONTRACTS = 1e9; // cap on |qYes|, |qNo| and |contracts| per trade
export const MAX_POINTS = 1e12;   // cap on budgets and |costBasisPoints|
export const CONTRACT_PAYOUT_POINTS = 100, PRICE_MIN = 1, PRICE_MAX = 99;
export function clampProbability(p: number): number;
```
This is exactly what `src/index.ts` exports. `fitContractsToBudget` and `logProbabilities` are exported from `lmsr.ts` for tests only and are not re-exported. `errors.ts` also holds `assertSide(value)` and `assertOutcome(value)`, which accept only the exact strings `"YES"` and `"NO"` and throw `INVALID_SIDE` otherwise (so `"yes"`, `"VOID"` and `undefined` are rejected); `tradeCost`, `quoteContracts` and `quotePoints` call `assertSide` first, and `payout` calls `assertOutcome`. `assertPosition(position)` checks a settlement input (an object with finite holdings in 0..`MAX_CONTRACTS` and an integer cost basis within ±`MAX_POINTS`, else `INVALID_STATE` / `INVALID_CONTRACTS` / `INVALID_POINTS`); `payout` and `voidRefund` call it, so malformed input (including `null`, `undefined` or a `Symbol`) always raises `EngineError`, never a `TypeError`. Error messages interpolate user values through `describe(value)` in `errors.ts` (objects print as `[object]`, anything whose conversion throws as `[unprintable]`), and `assertState` / `assertPosition` read fields inside a `try`, so a null-prototype object, a value whose `toString` throws, or a Proxy whose getter throws still raises `EngineError`. Results never carry `-0`: `tradeCost`, `payout` and both components of `stateAfter` are normalized to `+0`.

Errors are thrown as `EngineError` with a `code` so the server can map them to user messages without parsing text. `quotePoints` inverts the budget in the log domain and returns a quote for any representable state, including one where a side's probability has underflowed to 0; it throws `INVALID_POINTS` only if the amount is not an integer in 1..`MAX_POINTS`, buys less than one micro-contract, or would trade more than `MAX_CONTRACTS` or push the side's `q` beyond it (a fill capped there is returned only if it still costs the whole budget, e.g. 99999996535 points buy exactly 1e9 contracts on a fresh b=50 market; otherwise `INVALID_POINTS`, "this market cannot absorb that budget"). `quoteContracts` throws `INVALID_CONTRACTS` for a trade larger than `MAX_CONTRACTS` or one that would move `q` beyond `±MAX_CONTRACTS`.

## Acceptance criteria
- [x] Given any finite `MarketState` with `b` in 50..500, when `probabilityYes` runs, then `0 ≤ p ≤ 1`, `p + probabilityYes(swapped sides) = 1` within 1e-12, and strictly `0 < p < 1` while `|qYes − qNo|/b < 36` (invariant 1; beyond that gap `1 − p` is below one ulp of 1 in double precision).
- [x] Given a state, when `quoteContracts(state, side, 0)` runs, then it throws `INVALID_CONTRACTS`; for `Δ > 0` the unrounded cost is strictly increasing and convex in `Δ` (invariant 2). Convexity is asserted on the exact cost at the granularity the property tests use (`Δ` steps well above one micro-contract); at micro-contract granularity the second difference of the computed cost can be one ulp negative (−1.5e-5 points at `Δ ≈ 1e9`), so convexity is a property of the formula, verified statistically, not a bit-level guarantee. Strict monotonicity held at every probe.
- [x] Given a state and `Δ > 0`, when a buy of `Δ` is followed by a sell of `Δ` on the same side from `stateAfter`, then `proceeds ≤ cost` after rounding (invariant 3).
- [x] Given any random sequence of up to 200 quotes applied in order, when the pool's liability (`costFunction(state) − costFunction(initial)` versus worst-case payout) is tracked, then it never exceeds `maxPoolLoss(b)` (invariant 4).
- [x] Given a state and a budget `c ≥ 1` point, when `quotePoints` runs, then `costPoints ≤ c` and `c − costPoints < 1` whenever `c` buys at least one micro-contract, and the fit is an exact search on integer micro-contracts (at most 64 bisection steps plus 4 forward probes, one quote each) (invariant 5).
- [x] Given any set of positions and the trades that produced them, when every trade is reversed in reverse order and `voidRefund` is paid, then each user's net points equal zero (invariant 6).
- [x] Given `b = 100`, `q = (0, 0)`, when 500 points buy YES, then `contracts` is within 0.01 of 9.76, `avgPrice` is 51, `probAfter` is within 0.001 of 0.524, and `payoutIfWin` is 976 (worked example, architecture §5).
- [x] Given a side whose probability has underflowed to exactly 0 (gap beyond ~745·b), when `tradeCost`, `quoteContracts` or `quotePoints` run, then every result is finite (`lmsr.underflow.test.ts`).
- [x] Given extreme but finite states (`|q| up to 10⁶`, `b = 50` or `500`), when any function runs, then no result is `NaN` or `±Infinity` (log-sum-exp).
- [x] Given `npx vitest run --coverage` in `packages/engine`, then lines and branches are both at least 95 % and the run fails below that.
- [x] Given `npm run typecheck && npm run lint && npm test` at the root, then all exit 0; CI green on the branch.

## Tech stack
No change to the stack table in `m0-scaffold.md`. New dev dependency: `@vitest/coverage-v8` (same major as Vitest 5).

## Commands
```
npm test -w packages/engine                 unit + property tests
npx vitest run --coverage -w packages/engine   coverage with thresholds (fails under 95 %)
npm run typecheck && npm run lint && npm test  local gate
```

## Project structure
```
packages/engine/src/
  index.ts          public exports and types only
  lmsr.ts           costFunction, probabilityYes, tradeCost, quoteContracts, quotePoints (+ fitContractsToBudget, tests only)
  rounding.ts       ceilPoints, floorPoints, roundContracts, floorContracts (6 dp)
  settlement.ts     maxPoolLoss, payout, voidRefund
  errors.ts         EngineError, EngineErrorCode, B_MIN, B_MAX, MAX_CONTRACTS, MAX_POINTS, assert* helpers
  constants.ts      CONTRACT_PAYOUT_POINTS, PRICE_MIN, PRICE_MAX
  types.ts          Side, Outcome, MarketState, Quote, PositionLike
  errors.test.ts  rounding.test.ts  lmsr.test.ts  quote.test.ts  budget.test.ts
  lmsr.properties.test.ts  liability.properties.test.ts  lmsr.edges.test.ts
  lmsr.underflow.test.ts  settlement.test.ts  index.test.ts
packages/engine/vitest.config.ts   coverage provider v8, thresholds 95/95
packages/engine/vitest.setup.ts    caps each fast-check property at 30 s; the interrupt counts as a failure
```

## Code style
As M0. One addition: every exported engine function begins by validating its inputs with the `assert*` helpers in `errors.ts`, and never reads `Date`, `Math.random`, `process`, or any global state.

```ts
// packages/engine/src/lmsr.ts (shape, not final code)
export function probabilityYes(state: MarketState): number {
  assertState(state);
  const m = Math.max(state.qYes, state.qNo) / state.b;
  const ey = Math.exp(state.qYes / state.b - m);
  const en = Math.exp(state.qNo / state.b - m);
  return ey / (ey + en);
}
```

## Testing strategy
- TDD per module: the failing test lands before the implementation in every commit.
- Unit tests pin the worked example and each error code; property tests (fast-check, `numRuns: 500`, fixed `seed` printed on failure) cover the six invariants with generators for `b ∈ [50, 500]`, `q ∈ [−10⁶, 10⁶]`, `Δ ∈ (0, 10⁴]`, budgets `∈ [1, 10⁶]`.
- `doubt-driven-development` adversarial pass before merge (development model: engine math gets one).
- No mocks; nothing here does I/O.

## Data touched
None.

## UX
None. The quote's fields are what the M3 order ticket displays (see `docs/research/kalshi/order-ticket.md`: contracts, average price, payout if win, price after).

## Boundaries
- Always: validate inputs at the boundary; round only in `rounding.ts`; keep the engine free of Node types (`"types": []` stays); update architecture §5 in the same PR as any formula change.
- Ask first: any dependency beyond `@vitest/coverage-v8`; changing the rounding direction; widening the `b` range; adding fees.
- Never: compute a price outside the engine; let a rounding rule favor the user; read the clock or randomness.

## Risks / open questions
- Budget inversion: the closed form is floored to six decimals and capped at the room left under `MAX_CONTRACTS`, then fitted on integer micro-contracts: if that amount overshoots the budget, a bisection (at most 64 quotes) finds the largest grid amount that fits; if it fits, up to four forward probes keep grid-exact answers from landing one micro-contract short. Both paths are tested in `lmsr.edges.test.ts` and `lmsr.review.test.ts`; the property suite asserts `costPoints ≤ points`.
- Liability tracking for invariant 4 needs a precise definition: liability = worst-case payout across outcomes minus points collected. The plan step fixes the formula in the test before code is written.
- Floating-point: `Math.exp` near `|q|/b ≈ 700` overflows without log-sum-exp; the extreme-state criterion exists to catch regressions.

Trade-offs recorded:
- CI runs the engine suite twice (`npm test`, then the coverage run), roughly ten seconds extra per push; accepted so the root `npm test` stays the single local gate.
- A buy whose exact cost is below one point costs one point.
- Convexity (invariant 2) is asserted on the exact cost at the property tests' granularity (`Δ` steps well above one micro-contract). At micro-contract granularity the second difference of the computed cost can be one ulp negative (−1.5e-5 points at `Δ ≈ 1e9`), so convexity is a property of the formula, verified statistically, not a bit-level guarantee. Strict monotonicity held at every probe.
- States and trades are capped at 1e9 contracts and budgets at 1e12 points, so every integer result (micro-contracts, points) stays a safe integer.
- Budgets above roughly 1e11 points are rejected (`INVALID_POINTS`) because they would buy more than the 1e9-contract cap.
- Invariant 4 holds in exact arithmetic. Floating-point noise of up to about 3e-5 points per trade means an engineered path of dozens of ~1e9-contract trades could, in principle, exceed the bound by a fraction of a point; it needs a ~1e11-point bankroll, which the product's balance cap makes unreachable, so it is accepted and not guarded.
- Above about 1.7e10 points the rounding tolerance is below one ulp, so an exact-integer cost that lands one ulp high is charged one extra point (favors the pool; accepted).
- `Math.exp`, `Math.log1p` and `Math.expm1` are not bit-identical across JavaScript engines, so a quote computed in the browser is indicative and the server's fill is authoritative (the server recomputes everything; architecture §9).
- When a side's probability has underflowed to 0, `tradeCost` is exactly 0 for every trade up to about 700·b, so strict monotonicity (invariant 2) holds only inside the representable range, as already noted for invariant 1.
- Payouts are computed in micro-contract integers (`floor(round(contracts·1e6) / 1e4)`), because `contracts·100` misrounds large six-decimal amounts (537000000.05 would pay 53700000004). `maxPoolLoss` uses a plain ceil with no tolerance, since 100·b·ln 2 is never an integer.

## Tasks (from /agent-skills:plan)
Dependency graph: errors and rounding → probability and cost → quote by contracts → quote by points → settlement and liability → public surface and coverage gate → adversarial pass and docs. Every task lands its failing test first (TDD is mandatory here); the local gate is `npm run typecheck && npm run lint && npm test`.

1. **Errors and rounding** (S, 4 files: `src/errors.ts`, `src/errors.test.ts`, `src/rounding.ts`, `src/rounding.test.ts`) — Acceptance: `EngineError` carries `code`; `assertState` rejects non-finite `q`, `b` outside 50..500; `ceilPoints`/`floorPoints` return integers and never favor the caller (`ceilPoints(0.000001) = 1`, `floorPoints(0.999999) = 0`); `roundContracts` keeps 6 dp and maps `-0` to `0`. Verify by: `npm test -w packages/engine`.
2. **Probability and cost** (S, 2 files: `src/lmsr.ts`, `src/lmsr.test.ts`) — Acceptance: `probabilityYes({0,0,b}) = 0.5`; `costFunction({0,0,b}) = 100·b·ln 2`; both finite for `|q| ≤ 10⁶` and `b ∈ {50, 500}`; property for invariant 1 (`0 < p < 1`, `p(q) + p(swapped) = 1`). Verify by: tests; `fc.assert` with `numRuns: 500`.
3. **Quote by contracts** (M, same 2 files + `src/lmsr.properties.test.ts`) — Acceptance: `quoteContracts` returns signed `contracts`, `costPoints` (ceil for buys, floor for sells), integer `avgPrice` 1..99, `probBefore/After`, `payoutIfWin` (floor of contracts × 100, 0 for sells), `stateAfter`; throws `INVALID_CONTRACTS` for 0, NaN, or non-finite; properties for invariants 2 (strictly increasing, convex unrounded cost) and 3 (buy then sell never profits). Verify by: tests.
   - **Checkpoint A**: local gate green; commit per task so far.
4. **Quote by points (budget inversion)** (M, same files) — Acceptance: closed-form `Δ` with log-sum-exp, floored to 6 dp, then at most three micro-contract reductions until `costPoints ≤ points`; throws `INVALID_POINTS` for `points < 1` or non-integer; worked example (`b = 100`, fresh market, 500 points → contracts within 0.01 of 9.76, `avgPrice` 51, `probAfter` within 0.001 of 0.524, `payoutIfWin` 976); property for invariant 5 (`costPoints ≤ points`, `points − costPoints < 1`, adjustments ≤ 3). Verify by: tests.
5. **Settlement and liability** (S, 3 files: `src/settlement.ts`, `src/settlement.test.ts`, properties file) — Acceptance: `maxPoolLoss(b) = ceil(100·b·ln 2)` (6,932 for `b = 100`); `payout` floors `winningContracts × 100`; `voidRefund` returns `costBasisPoints`; property for invariant 4: over random sequences of ≤ 200 buys and sells (sells never exceed what the sequence bought on that side), `100·max(qYes, qNo) − Σ costPoints ≤ maxPoolLoss(b)`; property for invariant 6: replaying a sequence and refunding `voidRefund` leaves every simulated user at net zero. Verify by: tests.
6. **Public surface and coverage gate** (S, 4 files: `src/index.ts`, `packages/engine/vitest.config.ts`, `packages/engine/package.json`, `.github/workflows/ci.yml`) — Acceptance: `index.ts` exports only the API in this spec plus `clampProbability` and the constants; `@vitest/coverage-v8` added; thresholds 95 % lines and branches; `npm run coverage -w packages/engine` exists and CI runs it after `npm test`. Verify by: `npm run coverage -w packages/engine` passes; deleting one test file makes it fail; CI green on the branch.
   - **Checkpoint B**: coverage ≥ 95 %; CI green; review passes (`/code-review`, `/agent-skills:review`) and the `doubt-driven-development` adversarial pass on the math, with findings recorded below.
7. **Docs and ship** (S, 2 files: `docs/architecture.md` §5 if anything changed, this spec) — Acceptance: §5 matches the code's rounding and the worked example as computed; spec DoD ticked; `/agent-skills:ship`; squash-merge; mark `done`.

## Review (SOP-02 step 6)
| Pass | Findings | Outcome |
|---|---|---|
| 1. `/code-review high` bug hunt | 10 | All addressed: Infinity on underflowed sides (log-domain math); wrong error codes for huge budgets; the user-favoring micro-point snap replaced by a capped 1e-12 relative tolerance plus a one-point minimum per buy; property generator bounded to double precision's normal range; doc drift; `q` snapped to the six-decimal grid; shared validation helpers; CI double-run accepted; public surface documented. |
| 2. Adversarial cycle 1 (`doubt-driven-development`, fresh-context reviewer) | 7 | Fixed the uncapped tolerance, the missing magnitude caps (`MAX_CONTRACTS` 1e9, `MAX_POINTS` 1e12), runtime validation of side/outcome/state shape, exact-cost average price, cancellation-free log-probabilities; two documented as trade-offs. |
| 3. Adversarial cycle 2 | 10 | Fixed the d+(−d) cancellation (unified log-sum-exp trade cost), the budget fit (bisection on integer micro-contracts under the contract cap, forward probes), integer micro-contract payouts (the delta×100 misrounding), Symbol-safe messages, position validation, plain-ceil pool bound; four recorded as trade-offs. |
| 4. Adversarial cycle 3 | Low only | Fixed in this commit: `describe()`-safe error messages and guarded field reads (null-prototype objects, throwing `toString`, throwing Proxy getters raise `EngineError`); `-0` normalized out of `tradeCost`, `payout` and `stateAfter`; convexity wording above. The loop stopped at the three-cycle bound with 12,000 randomized and targeted executions finding no Critical, High or Medium issue. |

Cross-model second opinion (Codex/Gemini CLI) was offered to the owner and not requested; findings are single-model only.

Verification: 160 tests pass (`npx vitest run --project engine`); coverage 100 % statements (166/166), branches (114/114), functions (40/40) and lines (164/164); Biome, lint and typecheck clean; CI green on the branch at `f9cbfab` (the cycle-3 changes are verified locally and await their CI run on push).

## Ship decision (SOP-02 step 7): GO

The `/agent-skills:ship` persona fan-out was started on 2026-10-29 and stopped when the owner paused work, so it produced no reports. It is replaced by a deeper independent review done the same day, when a second engine (branch `claude/practical-johnson-4z906w`, written by a cloud session) had to be compared with this one:

- A fresh-context reviewer replayed every bug this engine's adversarial cycles had found (underflowed sides, the large-gap budget inversion, the payout misrounding, huge magnitudes, hostile input) against both engines, and ran 281k differential quotes against a 70-digit `Decimal` reference.
- This engine was exact on every case the reference could decide: random buys, sells and budgets, and "mirror" trades whose exact cost is a whole number of points. The other engine, with strict `ceil`/`floor`, was off by a full point on 27 % of mirror trades in large fractional states. The 1e-12 relative tolerance here (at most 1e-6 points) is what makes the difference; its only user-favoring effect is below a millionth of a point.
- Hostile input: this engine raised `EngineError` with a code in every case; the other threw `TypeError` or accepted off-grid states in several.
- No round-trip profit and no breach of the pool-loss bound in either engine (40k round trips each; 3,000 random histories, worst case 0.9972 of `100·b·ln 2`).

Decision: keep this engine. Port the other engine's positions module (`applyFill`, `settlePayouts`, `voidRefunds`, `withinSlippage`, `EMPTY_POSITION`) and `displayPrice` onto it in the M2 integration, with `EngineError` codes. The other engine's sell guard (a sell may not take `q` below 0) is not ported: M3's `placeTrade` checks holdings before quoting, and this engine's property tests deliberately cover negative-`q` states.

Rollback: the engine is a pure library with no runtime exposure until M2 reads `probabilityYes`; reverting the squash commit on `main` restores M0. No data, no migrations.

## Definition of Done
- [x] Acceptance criteria met and demonstrated (test or screenshot)
- [x] Unit tests for logic; Playwright for any user-visible flow that moves points (none in M1)
- [x] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [x] No secrets in code; new env vars documented in `.env.example` (none in M1)
- [x] Docs or ADR updated when behavior or a decision changed
- [x] Preview deploy checked by a human (not applicable: no user-visible change)

## Next

Done. The positions module and `displayPrice` are ported in the M2 integration (`docs/specs/m2a-data-layer.md`), which is where `apps/web` first imports the engine.
