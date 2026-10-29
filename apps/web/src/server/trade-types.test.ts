import { describe, expect, expectTypeOf, it } from "vitest";
import {
  parseTradeInput,
  TRADE_ERROR_CODES,
  TRADE_MODES,
  type TradeErrorCode,
  type TradeFailure,
  type TradeResult,
} from "./trade-types";

const MARKET = "3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f";
const KEY = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const valid = {
  marketId: MARKET,
  side: "YES",
  mode: "buy_points",
  amount: 500,
  expectedAvgPrice: 51,
  maxSlippage: 2,
  idempotencyKey: KEY,
};

const parse = (patch: Record<string, unknown>) => parseTradeInput({ ...valid, ...patch });
const rejected = { ok: false, code: "invalid_input" };

describe("parseTradeInput", () => {
  it("accepts the worked example", () => {
    expect(parseTradeInput(valid)).toEqual({ ok: true, input: valid });
  });

  it("defaults maxSlippage to 2", () => {
    const { maxSlippage: _, ...rest } = valid;
    expect(parseTradeInput(rest)).toEqual({ ok: true, input: { ...valid, maxSlippage: 2 } });
  });

  it("lowercases the market id and drops unknown fields", () => {
    const result = parse({ marketId: MARKET.toUpperCase(), extra: "ignored" });
    expect(result).toEqual({ ok: true, input: valid });
  });

  it.each([null, undefined, 1, "x", [], [valid]])("rejects the non-object %j", (raw) => {
    expect(parseTradeInput(raw)).toEqual(rejected);
  });

  it("rejects an object whose getters throw", () => {
    const hostile = new Proxy(valid, {
      get() {
        throw new Error("boom");
      },
    });
    expect(parseTradeInput(hostile)).toEqual(rejected);
  });

  it.each([
    undefined,
    "",
    "not-a-uuid",
    "3f2b8c1e9d4a4b6e8f102a3b4c5d6e7f",
    `${MARKET}0`,
    ` ${MARKET}`,
    42,
  ])("rejects the market id %j", (marketId) => {
    expect(parse({ marketId })).toEqual(rejected);
  });

  it.each(["yes", "No", "", "MAYBE", undefined, 1])("rejects the side %j", (side) => {
    expect(parse({ side })).toEqual(rejected);
  });

  it("accepts each mode and nothing else", () => {
    for (const mode of TRADE_MODES) {
      expect(parse({ mode, amount: 1, expectedCostPoints: 60 }).ok).toBe(true);
    }
    for (const mode of ["buy", "sell", "sell_points", "", undefined]) {
      expect(parse({ mode })).toEqual(rejected);
    }
  });

  describe("amount, buy_points", () => {
    it.each([1, 500, 1e9])("accepts %d whole points", (amount) => {
      expect(parse({ amount }).ok).toBe(true);
    });

    it.each([0, -1, 0.5, 1.000001, 1e9 + 1, Number.NaN, Number.POSITIVE_INFINITY, "500", null])(
      "rejects %j",
      (amount) => {
        expect(parse({ amount })).toEqual(rejected);
      },
    );
  });

  describe.each(["buy_contracts", "sell_contracts"])("amount, %s", (mode) => {
    it.each([0.000001, 0.009, 0.01, 9.761859, 1e6])("accepts %d contracts", (amount) => {
      expect(parse({ mode, amount, expectedCostPoints: 1 }).ok).toBe(true);
    });

    it.each([0, -0, -1, 1e-7, 1.0000001, 1e6 + 0.000001, Number.NaN, "1", undefined])(
      "rejects %j",
      (amount) => {
        expect(parse({ mode, amount, expectedCostPoints: 1 })).toEqual(rejected);
      },
    );
  });

  describe("expectedCostPoints", () => {
    const contracts = { mode: "buy_contracts", amount: 9.761859 };

    it.each([1, 500, 1e9])("is kept for buy_contracts: %d", (expectedCostPoints) => {
      expect(parse({ ...contracts, expectedCostPoints })).toEqual({
        ok: true,
        input: { ...valid, ...contracts, expectedCostPoints },
      });
    });

    it.each([undefined, 0, -1, 0.5, 1e9 + 1, Number.NaN, Number.POSITIVE_INFINITY, "500", null])(
      "is required for buy_contracts as a whole number >= 1: rejects %j",
      (expectedCostPoints) => {
        expect(parse({ ...contracts, expectedCostPoints })).toEqual(rejected);
      },
    );

    it.each(["buy_points", "sell_contracts"])("is ignored and dropped for %s", (mode) => {
      const result = parse({ mode, amount: 1, expectedCostPoints: "garbage" });
      expect(result).toEqual({ ok: true, input: { ...valid, mode, amount: 1 } });
      expect(result.ok && "expectedCostPoints" in result.input).toBe(false);
    });
  });

  it.each([0, 0.5, 51, 100])("accepts expectedAvgPrice %d", (expectedAvgPrice) => {
    expect(parse({ expectedAvgPrice }).ok).toBe(true);
  });

  it.each([-0.01, 100.01, Number.NaN, Number.POSITIVE_INFINITY, "51", undefined, null])(
    "rejects expectedAvgPrice %j",
    (expectedAvgPrice) => {
      expect(parse({ expectedAvgPrice })).toEqual(rejected);
    },
  );

  it.each([0, 1, 2, 5, 10, 2.5])("accepts maxSlippage %d", (maxSlippage) => {
    expect(parse({ maxSlippage })).toEqual({ ok: true, input: { ...valid, maxSlippage } });
  });

  it.each([-1, 10.01, Number.NaN, "2", null])("rejects maxSlippage %j", (maxSlippage) => {
    expect(parse({ maxSlippage })).toEqual(rejected);
  });

  it.each(["a".repeat(16), "Z".repeat(64), "abc_DEF-123456789", KEY])(
    "accepts the key %j",
    (idempotencyKey) => {
      expect(parse({ idempotencyKey }).ok).toBe(true);
    },
  );

  it.each([
    "a".repeat(15),
    "a".repeat(65),
    "has space 1234567",
    "semicolon;1234567",
    "é".repeat(20),
    1,
  ])("rejects the key %j", (idempotencyKey) => {
    expect(parse({ idempotencyKey })).toEqual(rejected);
  });
});

describe("TradeErrorCode", () => {
  it("is exactly the spec's taxonomy", () => {
    expect([...TRADE_ERROR_CODES].sort()).toEqual(
      [
        "trading_paused",
        "unauthenticated",
        "account_suspended",
        "invalid_input",
        "market_not_found",
        "market_not_open",
        "market_closed",
        "slippage_exceeded",
        "trade_too_small",
        "trade_too_large",
        "insufficient_balance",
        "insufficient_position",
        "rate_limited",
        "idempotency_key_reused",
        "internal_error",
      ].sort(),
    );
    expectTypeOf<TradeErrorCode>().toEqualTypeOf<(typeof TRADE_ERROR_CODES)[number]>();
  });

  it("carries the extra fields per code", () => {
    expectTypeOf<Extract<TradeFailure, { code: "slippage_exceeded" }>["requote"]>().toEqualTypeOf<{
      readonly avgPrice: number;
      readonly contracts: number;
      readonly costPoints: number;
      readonly probAfter: number;
      readonly payoutIfWin: number;
    }>();
    expectTypeOf<
      Extract<TradeFailure, { code: "trade_too_large" }>["maxPoints"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<TradeFailure, { code: "rate_limited" }>["retryAfterSec"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<TradeFailure, { code: "insufficient_balance" }>["needed"]
    >().toEqualTypeOf<number>();
    expectTypeOf<
      Extract<TradeFailure, { code: "insufficient_position" }>["held"]
    >().toEqualTypeOf<number>();
    expectTypeOf<Extract<TradeResult, { ok: true }>["replayed"]>().toEqualTypeOf<boolean>();
  });
});
