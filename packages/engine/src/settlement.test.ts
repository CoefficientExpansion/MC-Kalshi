import { describe, expect, it } from "vitest";
import { EngineError } from "./errors";
import { maxPoolLoss, payout, voidRefund } from "./settlement";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("maxPoolLoss", () => {
  it("is 100·b·ln 2 rounded up to whole points", () => {
    expect(maxPoolLoss(100)).toBe(6932);
    expect(maxPoolLoss(50)).toBe(3466);
    expect(maxPoolLoss(500)).toBe(34658);
    // 100·b·ln 2 is about 6932.000000001 here: a real fraction, so no tolerance may swallow it.
    expect(maxPoolLoss(100.00762023443737)).toBe(6933);
  });

  it("rejects b outside the liquidity range", () => {
    expect(codeOf(() => maxPoolLoss(10))).toBe("INVALID_STATE");
    expect(codeOf(() => maxPoolLoss(Number.NaN))).toBe("INVALID_STATE");
  });
});

describe("payout", () => {
  it("computes the payout in micro-contract integers so large amounts do not misround", () => {
    const position = { contractsYes: 537000000.05, contractsNo: 0, costBasisPoints: 0 };
    expect(payout(position, "YES")).toBe(53700000005);
  });

  it("rejects a missing or malformed position with EngineError, never a TypeError", () => {
    expect(codeOf(() => payout(null as never, "YES"))).toBe("INVALID_STATE");
    expect(codeOf(() => payout(Symbol() as never, "YES"))).toBe("INVALID_STATE");
    expect(
      codeOf(() =>
        payout({ contractsYes: Symbol(), contractsNo: 0, costBasisPoints: 0 } as never, "YES"),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => payout({ contractsYes: 1e9 + 1, contractsNo: 0, costBasisPoints: 0 }, "YES")),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => payout({ contractsYes: 1, contractsNo: 0, costBasisPoints: 0.5 }, "YES")),
    ).toBe("INVALID_POINTS");
  });

  it("pays 100 points per winning contract, rounded down", () => {
    const position = { contractsYes: 9.761835, contractsNo: 0, costBasisPoints: 500 };
    expect(payout(position, "YES")).toBe(976);
    expect(payout(position, "NO")).toBe(0);
  });

  it("pays only the winning side of a mixed position", () => {
    const position = { contractsYes: 1.5, contractsNo: 2.25, costBasisPoints: 300 };
    expect(payout(position, "YES")).toBe(150);
    expect(payout(position, "NO")).toBe(225);
  });

  it("rejects an outcome that is not exactly YES or NO", () => {
    const position = { contractsYes: 1, contractsNo: 0, costBasisPoints: 50 };
    for (const outcome of ["VOID", "yes", undefined]) {
      expect(codeOf(() => payout(position, outcome as never))).toBe("INVALID_SIDE");
    }
  });

  it("rejects negative or non-finite holdings", () => {
    expect(
      codeOf(() => payout({ contractsYes: -1, contractsNo: 0, costBasisPoints: 0 }, "YES")),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => payout({ contractsYes: 0, contractsNo: Number.NaN, costBasisPoints: 0 }, "NO")),
    ).toBe("INVALID_CONTRACTS");
  });
});

describe("voidRefund", () => {
  it("returns 0, not -0, for a -0 cost basis", () => {
    expect(Object.is(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: -0 }), 0)).toBe(
      true,
    );
  });

  it("rejects a missing or malformed position with EngineError", () => {
    expect(codeOf(() => voidRefund(undefined as never))).toBe("INVALID_STATE");
    expect(codeOf(() => voidRefund(Symbol() as never))).toBe("INVALID_STATE");
    expect(codeOf(() => voidRefund({ contractsYes: -1, contractsNo: 0, costBasisPoints: 0 }))).toBe(
      "INVALID_CONTRACTS",
    );
  });

  it("returns exactly the net points the user paid in, which may be negative", () => {
    expect(voidRefund({ contractsYes: 3, contractsNo: 0, costBasisPoints: 150 })).toBe(150);
    expect(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: -40 })).toBe(-40);
    expect(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: 0 })).toBe(0);
  });

  it("rejects a non-integer cost basis", () => {
    expect(
      codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: 1.5 })),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: Number.NaN })),
    ).toBe("INVALID_POINTS");
  });

  it("caps the cost basis at ±MAX_POINTS", () => {
    expect(voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: -1e12 })).toBe(-1e12);
    for (const costBasisPoints of [1e12 + 1, -1e12 - 1]) {
      expect(codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints }))).toBe(
        "INVALID_POINTS",
      );
    }
  });
});

describe("settlement edge values (cycle 3)", () => {
  it("a −0 holding pays +0", () => {
    expect(
      Object.is(payout({ contractsYes: -0, contractsNo: 0, costBasisPoints: 0 }, "YES"), 0),
    ).toBe(true);
  });

  it("rejects null-prototype positions and fields with EngineError", () => {
    const odd = Object.create(null);
    expect(codeOf(() => payout(odd as never, "YES"))).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() =>
        payout({ contractsYes: odd, contractsNo: 0, costBasisPoints: 0 } as never, "YES"),
      ),
    ).toBe("INVALID_CONTRACTS");
    expect(
      codeOf(() => voidRefund({ contractsYes: 0, contractsNo: 0, costBasisPoints: odd } as never)),
    ).toBe("INVALID_POINTS");
    expect(
      codeOf(() => payout({ contractsYes: 0, contractsNo: 0, costBasisPoints: 0 }, odd as never)),
    ).toBe("INVALID_SIDE");
  });

  it("rejects a position whose getter throws with INVALID_STATE", () => {
    const hostile = {
      get contractsYes(): number {
        throw new Error("boom");
      },
      contractsNo: 0,
      costBasisPoints: 0,
    };
    expect(codeOf(() => payout(hostile as never, "YES"))).toBe("INVALID_STATE");
  });

  it("rejects a null-prototype liquidity with INVALID_STATE", () => {
    expect(codeOf(() => maxPoolLoss(Object.create(null) as never))).toBe("INVALID_STATE");
  });
});
