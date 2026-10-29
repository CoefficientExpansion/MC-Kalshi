import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { B_MAX, B_MIN } from "./errors";
import { costFunction, quoteContracts, quotePoints } from "./lmsr";
import { roundContracts } from "./rounding";
import { maxPoolLoss, payout, voidRefund } from "./settlement";
import type { MarketState, Side } from "./types";

// A random market history: users buy with a points budget or sell a fraction of what they hold.
// Sells never exceed holdings, so q on each side is the aggregate of open positions.
interface Step {
  readonly user: number;
  readonly side: Side;
  readonly kind: "buy" | "sell";
  readonly points: number; // used by buys
  readonly fraction: number; // used by sells
}

interface Position {
  contractsYes: number;
  contractsNo: number;
  costBasisPoints: number;
}

const stepArb: fc.Arbitrary<Step> = fc.record({
  user: fc.integer({ min: 0, max: 4 }),
  side: fc.constantFrom("YES", "NO"),
  kind: fc.constantFrom("buy", "sell"),
  points: fc.integer({ min: 1, max: 5000 }),
  fraction: fc.double({ min: 0, max: 1, noNaN: true }),
});

const historyArb = fc.record({
  b: fc.double({ min: B_MIN, max: B_MAX, noNaN: true }),
  steps: fc.array(stepArb, { minLength: 1, maxLength: 200 }),
});

interface Simulation {
  readonly state: MarketState;
  readonly collected: number;
  readonly positions: readonly Position[];
  readonly trades: number;
}

function simulate(b: number, steps: readonly Step[]): Simulation {
  let state: MarketState = { qYes: 0, qNo: 0, b };
  let collected = 0;
  let trades = 0;
  const positions: Position[] = Array.from({ length: 5 }, () => ({
    contractsYes: 0,
    contractsNo: 0,
    costBasisPoints: 0,
  }));
  for (const step of steps) {
    const position = positions[step.user];
    if (!position) {
      continue;
    }
    let quote: ReturnType<typeof quoteContracts>;
    if (step.kind === "buy") {
      quote = quotePoints(state, step.side, step.points);
    } else {
      const held = step.side === "YES" ? position.contractsYes : position.contractsNo;
      const contracts = roundContracts(-held * step.fraction);
      if (contracts === 0) {
        continue;
      }
      quote = quoteContracts(state, step.side, contracts);
    }
    state = quote.stateAfter;
    collected += quote.costPoints;
    position.costBasisPoints += quote.costPoints;
    if (step.side === "YES") {
      position.contractsYes = roundContracts(position.contractsYes + quote.contracts);
    } else {
      position.contractsNo = roundContracts(position.contractsNo + quote.contracts);
    }
    trades += 1;
  }
  return { state, collected, positions, trades };
}

describe("invariant 4: the pool never owes more than 100·b·ln 2", () => {
  it("holds for random histories of up to 200 buys and sells", () => {
    fc.assert(
      fc.property(historyArb, ({ b, steps }) => {
        const sim = simulate(b, steps);
        const worstPayout = 100 * Math.max(sim.state.qYes, sim.state.qNo, 0);
        expect(worstPayout - sim.collected).toBeLessThanOrEqual(maxPoolLoss(b));
        // Rounding favors the pool: points collected never fall below the exact cost of the path.
        const exact = costFunction(sim.state) - costFunction({ qYes: 0, qNo: 0, b });
        expect(sim.collected).toBeGreaterThanOrEqual(Math.floor(exact) - 1);
      }),
      { numRuns: 300 },
    );
  });

  it("settlement payouts to the positions never exceed the worst-case bound either", () => {
    fc.assert(
      fc.property(historyArb, fc.constantFrom("YES", "NO"), ({ b, steps }, outcome) => {
        const sim = simulate(b, steps);
        const paid = sim.positions.reduce((sum, p) => sum + payout(p, outcome), 0);
        expect(paid - sim.collected).toBeLessThanOrEqual(maxPoolLoss(b));
      }),
      { numRuns: 300 },
    );
  });
});

describe("invariant 6: voiding returns every user exactly to their pre-market balance", () => {
  it("refunds equal what each user paid in, and the pool pays out exactly what it collected", () => {
    fc.assert(
      fc.property(historyArb, ({ b, steps }) => {
        const sim = simulate(b, steps);
        let refunded = 0;
        for (const position of sim.positions) {
          const refund = voidRefund(position);
          expect(refund).toBe(position.costBasisPoints);
          expect(position.costBasisPoints - refund).toBe(0);
          refunded += refund;
        }
        expect(refunded).toBe(sim.collected);
      }),
      { numRuns: 300 },
    );
  });
});
