import { describe, expect, it } from "vitest";
import {
  assertContracts,
  assertFiniteContracts,
  assertOutcome,
  assertPoints,
  assertPosition,
  assertSide,
  assertState,
  B_MAX,
  B_MIN,
  EngineError,
  MAX_CONTRACTS,
  MAX_POINTS,
} from "./errors";

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof EngineError ? e.code : "not-an-EngineError";
  }
}

describe("EngineError", () => {
  it("is a RangeError carrying a machine-readable code", () => {
    const err = new EngineError("INVALID_POINTS", "points must be a positive integer");
    expect(err).toBeInstanceOf(RangeError);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.code).toBe("INVALID_POINTS");
    expect(err.name).toBe("EngineError");
    expect(err.message).toContain("positive integer");
  });
});

describe("assertState", () => {
  it("accepts finite q and b within the liquidity range", () => {
    expect(() => assertState({ qYes: 0, qNo: 0, b: B_MIN })).not.toThrow();
    expect(() => assertState({ qYes: -12.5, qNo: 1e6, b: B_MAX })).not.toThrow();
  });

  it.each([
    ["NaN qYes", { qYes: Number.NaN, qNo: 0, b: 100 }],
    ["infinite qNo", { qYes: 0, qNo: Number.POSITIVE_INFINITY, b: 100 }],
    ["b below range", { qYes: 0, qNo: 0, b: B_MIN - 1 }],
    ["b above range", { qYes: 0, qNo: 0, b: B_MAX + 1 }],
    ["NaN b", { qYes: 0, qNo: 0, b: Number.NaN }],
    ["qYes beyond MAX_CONTRACTS", { qYes: MAX_CONTRACTS + 1, qNo: 0, b: 100 }],
    ["qNo beyond -MAX_CONTRACTS", { qYes: 0, qNo: -MAX_CONTRACTS - 1, b: 100 }],
    ["qYes off the six-decimal grid", { qYes: 0.0000001, qNo: 0, b: 100 }],
    ["qNo off the six-decimal grid", { qYes: 0, qNo: 1.2345678, b: 100 }],
    ["string qYes", { qYes: "1", qNo: 0, b: 100 }],
    ["missing b", { qYes: 0, qNo: 0 }],
    ["null", null],
    ["undefined", undefined],
    ["a number", 42],
  ])("rejects %s with INVALID_STATE", (_label, state) => {
    expect(codeOf(() => assertState(state as never))).toBe("INVALID_STATE");
  });

  it("accepts q exactly at ±MAX_CONTRACTS", () => {
    expect(MAX_CONTRACTS).toBe(1e9);
    expect(() => assertState({ qYes: MAX_CONTRACTS, qNo: -MAX_CONTRACTS, b: 100 })).not.toThrow();
  });
});

describe("assertContracts", () => {
  it("accepts any finite non-zero amount, including sells and micro-contracts", () => {
    expect(() => assertContracts(1)).not.toThrow();
    expect(() => assertContracts(-1)).not.toThrow();
    expect(() => assertContracts(0.000001)).not.toThrow();
  });

  it.each([0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects %s with INVALID_CONTRACTS",
    (value) => {
      expect(codeOf(() => assertContracts(value))).toBe("INVALID_CONTRACTS");
    },
  );

  it("caps the size of a trade at MAX_CONTRACTS either way", () => {
    expect(() => assertContracts(MAX_CONTRACTS)).not.toThrow();
    expect(() => assertContracts(-MAX_CONTRACTS)).not.toThrow();
    expect(codeOf(() => assertContracts(MAX_CONTRACTS + 1))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => assertContracts(-MAX_CONTRACTS - 1))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => assertFiniteContracts(MAX_CONTRACTS + 1))).toBe("INVALID_CONTRACTS");
    expect(() => assertFiniteContracts(0)).not.toThrow();
  });
});

describe("assertPoints", () => {
  it("accepts positive integers", () => {
    expect(() => assertPoints(1)).not.toThrow();
    expect(() => assertPoints(1_000_000)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects %s with INVALID_POINTS",
    (value) => {
      expect(codeOf(() => assertPoints(value))).toBe("INVALID_POINTS");
    },
  );

  it("caps a budget at MAX_POINTS", () => {
    expect(MAX_POINTS).toBe(1e12);
    expect(() => assertPoints(MAX_POINTS)).not.toThrow();
    expect(codeOf(() => assertPoints(MAX_POINTS + 1))).toBe("INVALID_POINTS");
  });
});

describe("assertSide and assertOutcome", () => {
  it("accept exactly YES and NO", () => {
    for (const value of ["YES", "NO"]) {
      expect(() => assertSide(value)).not.toThrow();
      expect(() => assertOutcome(value)).not.toThrow();
    }
  });

  it.each(["yes", "no", "VOID", "", " YES", undefined, null, 1])(
    "reject %s with INVALID_SIDE",
    (value) => {
      expect(codeOf(() => assertSide(value))).toBe("INVALID_SIDE");
      expect(codeOf(() => assertOutcome(value))).toBe("INVALID_SIDE");
    },
  );
});

describe("messages never throw a TypeError on hostile values", () => {
  it("every assertion reports a Symbol as an EngineError", () => {
    const sym = Symbol("x") as never;
    expect(codeOf(() => assertState(sym))).toBe("INVALID_STATE");
    expect(codeOf(() => assertState({ qYes: 0, qNo: 0, b: sym }))).toBe("INVALID_STATE");
    expect(codeOf(() => assertContracts(sym))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => assertFiniteContracts(sym))).toBe("INVALID_CONTRACTS");
    expect(codeOf(() => assertPoints(sym))).toBe("INVALID_POINTS");
    expect(codeOf(() => assertSide(sym))).toBe("INVALID_SIDE");
    expect(codeOf(() => assertPosition(sym))).toBe("INVALID_STATE");
  });
});

describe("assertPosition", () => {
  it("accepts holdings in 0..MAX_CONTRACTS and an integer cost basis within ±MAX_POINTS", () => {
    expect(() =>
      assertPosition({ contractsYes: 0, contractsNo: MAX_CONTRACTS, costBasisPoints: -MAX_POINTS }),
    ).not.toThrow();
    expect(() =>
      assertPosition({ contractsYes: 1.5, contractsNo: 0, costBasisPoints: MAX_POINTS }),
    ).not.toThrow();
  });

  it.each([
    ["null", null, "INVALID_STATE"],
    ["undefined", undefined, "INVALID_STATE"],
    ["a string", "position", "INVALID_STATE"],
    ["negative YES", { contractsYes: -1, contractsNo: 0, costBasisPoints: 0 }, "INVALID_CONTRACTS"],
    [
      "NaN NO",
      { contractsYes: 0, contractsNo: Number.NaN, costBasisPoints: 0 },
      "INVALID_CONTRACTS",
    ],
    ["string YES", { contractsYes: "1", contractsNo: 0, costBasisPoints: 0 }, "INVALID_CONTRACTS"],
    [
      "YES beyond MAX_CONTRACTS",
      { contractsYes: MAX_CONTRACTS + 1, contractsNo: 0, costBasisPoints: 0 },
      "INVALID_CONTRACTS",
    ],
    ["missing basis", { contractsYes: 0, contractsNo: 0 }, "INVALID_POINTS"],
    [
      "fractional basis",
      { contractsYes: 0, contractsNo: 0, costBasisPoints: 1.5 },
      "INVALID_POINTS",
    ],
    [
      "basis beyond MAX_POINTS",
      { contractsYes: 0, contractsNo: 0, costBasisPoints: -MAX_POINTS - 1 },
      "INVALID_POINTS",
    ],
  ])("rejects %s", (_label, position, code) => {
    expect(codeOf(() => assertPosition(position as never))).toBe(code);
  });
});
