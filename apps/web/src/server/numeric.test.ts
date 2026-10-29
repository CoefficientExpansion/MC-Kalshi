import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatNumeric, NumericBoundaryError, parseNumeric } from "./numeric";

describe("parseNumeric", () => {
  it("reads the strings Postgres returns for numeric(18,6)", () => {
    expect(parseNumeric("0.000000")).toBe(0);
    expect(parseNumeric("9.761859")).toBe(9.761859);
    expect(parseNumeric("0.000001")).toBe(1e-6);
    expect(parseNumeric("-12.500000")).toBe(-12.5);
    expect(parseNumeric("42")).toBe(42);
  });

  it("returns +0 for a negative zero", () => {
    expect(Object.is(parseNumeric("-0.000000"), 0)).toBe(true);
  });

  it("accepts the edge of the engine's micro-contract range", () => {
    expect(parseNumeric("1000000000.000000")).toBe(1e9);
    expect(parseNumeric("-1000000000.000000")).toBe(-1e9);
  });

  it("rejects values beyond the engine's range, such as 2e9", () => {
    expect(() => parseNumeric("2000000000.000000")).toThrow(NumericBoundaryError);
    expect(() => parseNumeric("1000000000.000001")).toThrow(NumericBoundaryError);
    expect(() => parseNumeric("-2000000000")).toThrow(NumericBoundaryError);
  });

  it.each([
    "",
    " ",
    " 1.0",
    "1.0 ",
    "abc",
    "1e3",
    "1E-6",
    "0x10",
    "Infinity",
    "NaN",
    "1.0000001",
    "1.",
    ".5",
    "+1",
    "--1",
    "1,5",
  ])("rejects the malformed string %j", (s) => {
    expect(() => parseNumeric(s)).toThrow(NumericBoundaryError);
  });

  it("rejects non-strings", () => {
    expect(() => parseNumeric(1 as unknown as string)).toThrow(NumericBoundaryError);
    expect(() => parseNumeric(null as unknown as string)).toThrow(NumericBoundaryError);
  });

  it("is not an EngineError (callers map it to internal_error, not invalid_input)", () => {
    let caught: unknown;
    try {
      parseNumeric("x");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("NumericBoundaryError");
    expect(caught).not.toHaveProperty("code");
  });
});

describe("formatNumeric", () => {
  it("writes six decimals", () => {
    expect(formatNumeric(0)).toBe("0.000000");
    expect(formatNumeric(1e-6)).toBe("0.000001");
    expect(formatNumeric(9.761859)).toBe("9.761859");
    expect(formatNumeric(-12.5)).toBe("-12.500000");
    expect(formatNumeric(1e9)).toBe("1000000000.000000");
    expect(formatNumeric(-0)).toBe("0.000000");
  });

  it("rejects a raw float sum that is off the grid (0.1 + 0.2)", () => {
    expect(() => formatNumeric(0.1 + 0.2)).toThrow(NumericBoundaryError);
    expect(() => formatNumeric(1e-7)).toThrow(NumericBoundaryError);
  });

  it("accepts the same sum once snapped to the grid", () => {
    const snapped = Math.round((0.1 + 0.2) * 1e6) / 1e6;
    expect(formatNumeric(snapped)).toBe("0.300000");
    expect(parseNumeric(formatNumeric(snapped))).toBe(0.3);
  });

  it("rejects out-of-range and non-finite values", () => {
    expect(() => formatNumeric(2e9)).toThrow(NumericBoundaryError);
    expect(() => formatNumeric(-2e9)).toThrow(NumericBoundaryError);
    expect(() => formatNumeric(Number.NaN)).toThrow(NumericBoundaryError);
    expect(() => formatNumeric(Number.POSITIVE_INFINITY)).toThrow(NumericBoundaryError);
    expect(() => formatNumeric("1" as unknown as number)).toThrow(NumericBoundaryError);
  });
});

describe("round trip", () => {
  it.each([1e-6, -1e-6, 0.3, 9.761859, 1e9, -1e9, 123456.789012])("%d survives", (n) => {
    expect(parseNumeric(formatNumeric(n))).toBe(n);
  });

  it("holds for every micro-contract count in range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e15, max: 1e15 }), (micros) => {
        const n = micros / 1e6;
        expect(parseNumeric(formatNumeric(n))).toBe(n === 0 ? 0 : n);
      }),
    );
  });

  it("stays on the grid after 1,000 tiny snapped additions", () => {
    let q = 0;
    for (let i = 0; i < 1000; i++) {
      q = parseNumeric(formatNumeric(Math.round((q + 0.000123) * 1e6) / 1e6));
    }
    expect(q).toBe(0.123);
    expect(formatNumeric(q)).toBe("0.123000");
  });
});
