import { describe, expect, it } from "vitest";
import { assertPosition, EngineError } from "./errors";
import { applyFill, EMPTY_POSITION, type Position, settlePayouts, voidRefunds } from "./positions";
import { payout, voidRefund } from "./settlement";

// Cloud review (M2): hostile getters, non-iterable inputs, off-grid amounts.

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

const pos = (contractsYes: number, contractsNo: number, costBasisPoints: number): Position => ({
  contractsYes,
  contractsNo,
  costBasisPoints,
});

/** An object whose `key` returns `first` on the first read and `then()` on every later read. */
function twoFaced<T extends object>(base: T, key: string, first: unknown, then: () => unknown): T {
  let reads = 0;
  const out = { ...base };
  Object.defineProperty(out, key, {
    enumerable: true,
    get: () => (reads++ === 0 ? first : then()),
  });
  return out;
}

const changesTo = (value: unknown) => () => value;
const throwsLater = () => {
  throw new Error("second read");
};

/** Either a consistent result built from first reads, or an EngineError; never a raw Error. */
function expectSafe(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    return undefined;
  }
}

function expectCleanPosition(p: unknown): void {
  if (p === undefined) return;
  const q = p as Position;
  for (const v of [q.contractsYes, q.contractsNo, q.costBasisPoints]) {
    expect(typeof v).toBe("number");
    expect(Number.isFinite(v)).toBe(true);
  }
}

describe("finding 1: a position or fill is read once", () => {
  const fields = ["contractsYes", "contractsNo", "costBasisPoints"] as const;
  const base = pos(1, 2, 100);

  it("applyFill uses the first value of each position field", () => {
    const sellYes = { side: "YES" as const, contracts: -1, costPoints: -40 };
    expect(applyFill(twoFaced(base, "contractsYes", 1, changesTo(1e9)), sellYes)).toEqual(
      pos(0, 2, 60),
    );
    expect(applyFill(twoFaced(base, "contractsNo", 2, changesTo(1e9)), sellYes)).toEqual(
      pos(0, 2, 60),
    );
    const basis = applyFill(twoFaced(base, "costBasisPoints", 100, changesTo("7")), sellYes);
    expect(basis).toEqual(pos(0, 2, 60));
    const buyNo = { side: "NO" as const, contracts: 1, costPoints: 50 };
    expect(applyFill(twoFaced(base, "contractsYes", 1, changesTo(1e9)), buyNo)).toEqual(
      pos(1, 3, 150),
    );
  });

  it("applyFill never leaks a raw Error from a position getter that throws later", () => {
    const fill = { side: "YES" as const, contracts: 1, costPoints: 50 };
    for (const key of fields) {
      const out = expectSafe(() => applyFill(twoFaced(base, key, base[key], throwsLater), fill));
      expectCleanPosition(out);
      expect(out).toEqual(pos(2, 2, 150));
    }
  });

  it("applyFill reads each fill field once", () => {
    const fill = { side: "YES" as const, contracts: 1, costPoints: 50 };
    expect(applyFill(base, twoFaced(fill, "contracts", 1, changesTo(1e9)))).toEqual(pos(2, 2, 150));
    expect(applyFill(base, twoFaced(fill, "costPoints", 50, changesTo("7")))).toEqual(
      pos(2, 2, 150),
    );
    expect(applyFill(base, twoFaced(fill, "side", "YES", changesTo("NO")))).toEqual(pos(2, 2, 150));
    for (const key of ["side", "contracts", "costPoints"]) {
      expect(
        applyFill(base, twoFaced(fill, key, fill[key as keyof typeof fill], throwsLater)),
      ).toEqual(pos(2, 2, 150));
    }
    const always = Object.defineProperty({ side: "YES", costPoints: 1 }, "contracts", {
      get: throwsLater,
    });
    expect(codeOf(() => applyFill(base, always as never))).toBe("INVALID_STATE");
  });

  it("payout and settlePayouts pay on the first value", () => {
    const flip = twoFaced(pos(0, 0, 0), "contractsYes", 0, changesTo(1e9));
    expect(payout(flip, "YES")).toBe(0);
    const flip2 = twoFaced(pos(0, 0, 0), "contractsYes", 0, changesTo(1e9));
    expect(settlePayouts([["a", flip2]], "YES").get("a")).toBe(0);
    for (const key of fields) {
      const p = twoFaced(base, key, base[key], throwsLater);
      expect(expectSafe(() => payout(p, "YES"))).toBe(100);
      const q = twoFaced(base, key, base[key], throwsLater);
      expect(expectSafe(() => settlePayouts([["a", q]], "NO").get("a"))).toBe(200);
    }
  });

  it("voidRefund and voidRefunds refund the first basis, always a number", () => {
    const flip = twoFaced(pos(0, 0, 0), "costBasisPoints", 0, changesTo("7"));
    expect(voidRefund(flip)).toBe(0);
    const flip2 = twoFaced(pos(0, 0, 0), "costBasisPoints", 0, changesTo("7"));
    expect(voidRefunds([["a", flip2]]).get("a")).toBe(0);
    for (const key of fields) {
      const p = twoFaced(base, key, base[key], throwsLater);
      expect(expectSafe(() => voidRefund(p))).toBe(100);
      const q = twoFaced(base, key, base[key], throwsLater);
      expect(expectSafe(() => voidRefunds([["a", q]]).get("a"))).toBe(100);
    }
  });
});

describe("finding 2: settlePayouts and voidRefunds validate their iterable", () => {
  const run = (positions: unknown) => [
    codeOf(() => settlePayouts(positions as never, "YES")),
    codeOf(() => voidRefunds(positions as never)),
  ];

  it("rejects null, undefined and non-iterables with INVALID_STATE", () => {
    for (const bad of [null, undefined, 5, "ab", {}, { [Symbol.iterator]: 1 }]) {
      expect(run(bad)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    }
  });

  it("rejects elements that are not [user, position] pairs", () => {
    for (const bad of [[null], [5], [["a"]], [["a", EMPTY_POSITION, 1]], [{ 0: "a", 1: {} }]]) {
      expect(run(bad)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    }
  });

  it("converts an error thrown by the iterator into INVALID_STATE", () => {
    const failing = {
      *[Symbol.iterator]() {
        yield ["a", EMPTY_POSITION] as const;
        throw new Error("iterator broke");
      },
    };
    expect(run(failing)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    const hostileIterator = Object.defineProperty({}, Symbol.iterator, { get: throwsLater });
    expect(run(hostileIterator)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
    const hostileEntry = [new Proxy(["a", EMPTY_POSITION], { get: throwsLater })];
    expect(run(hostileEntry)).toEqual(["INVALID_STATE", "INVALID_STATE"]);
  });

  it("still accepts a Map and plain entry arrays", () => {
    expect(settlePayouts(new Map([["a", pos(1, 0, 0)]]), "YES").get("a")).toBe(100);
    expect(voidRefunds([["a", pos(0, 0, 5)]]).get("a")).toBe(5);
  });
});

describe("finding 3: fill contracts must be on the six-decimal grid", () => {
  const fill = (contracts: number) => ({ side: "YES" as const, contracts, costPoints: 1 });
  const sell = (contracts: number) => ({ side: "YES" as const, contracts, costPoints: 0 });

  it("rejects sub-micro and off-grid fills", () => {
    expect(codeOf(() => applyFill(EMPTY_POSITION, fill(5e-7)))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => applyFill(pos(1, 0, 0), sell(-5e-7)))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => applyFill(EMPTY_POSITION, fill(1.0000004)))).toBe("INVALID_CONTRACTS");
  });

  it("accepts one micro-contract either way", () => {
    const held = applyFill(EMPTY_POSITION, fill(0.000001));
    expect(held.contractsYes).toBe(0.000001);
    expect(applyFill(held, sell(-0.000001)).contractsYes).toBe(0);
  });
});

describe("finding 4: holdings must be on the six-decimal grid", () => {
  it("rejects off-grid holdings on either side", () => {
    expect(codeOf(() => assertPosition(pos(1.4999995, 0, 0)))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => assertPosition(pos(0, 0.0000001, 0)))).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() =>
        applyFill(pos(1.4999995, 0, 0), { side: "YES", contracts: -1.5, costPoints: -1 }),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => applyFill(pos(0, 2.0000001, 0), { side: "YES", contracts: 1, costPoints: 1 })),
    ).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => payout(pos(1.0000001, 0, 0), "YES"))).toBe("INVALID_CONTRACTS");
  });

  it("accepts grid holdings, including −0", () => {
    expect(() => assertPosition(pos(1.499999, -0, 0))).not.toThrow();
  });
});
