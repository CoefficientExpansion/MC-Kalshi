import { describe, expect, it } from "vitest";
import { requestFingerprint } from "./trade-fingerprint";
import type { ParsedTradeInput } from "./trade-types";

const base: ParsedTradeInput = {
  marketId: "3f2b8c1e-9d4a-4b6e-8f10-2a3b4c5d6e7f",
  side: "YES",
  mode: "buy_points",
  amount: 500,
  expectedAvgPrice: 51,
  maxSlippage: 2,
  idempotencyKey: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
};

describe("requestFingerprint", () => {
  it("is a stable sha256 hex digest", () => {
    const fp = requestFingerprint(base);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint({ ...base })).toBe(fp);
  });

  it("ignores property order and the idempotency key", () => {
    const reordered: ParsedTradeInput = {
      idempotencyKey: "another-key-0000000",
      maxSlippage: 2,
      expectedAvgPrice: 51,
      amount: 500,
      mode: "buy_points",
      side: "YES",
      marketId: base.marketId,
    };
    expect(requestFingerprint(reordered)).toBe(requestFingerprint(base));
  });

  it("ignores market id case", () => {
    expect(requestFingerprint({ ...base, marketId: base.marketId.toUpperCase() })).toBe(
      requestFingerprint(base),
    );
  });

  it.each<[string, Partial<ParsedTradeInput>]>([
    ["market", { marketId: "00000000-0000-4000-8000-000000000000" }],
    ["side", { side: "NO" }],
    ["mode", { mode: "buy_contracts" }],
    ["amount", { amount: 501 }],
    ["expectedAvgPrice", { expectedAvgPrice: 52 }],
    ["maxSlippage", { maxSlippage: 5 }],
  ])("changes when %s changes", (_, patch) => {
    expect(requestFingerprint({ ...base, ...patch })).not.toBe(requestFingerprint(base));
  });

  it("treats -0 and 0 alike", () => {
    expect(requestFingerprint({ ...base, maxSlippage: -0 })).toBe(
      requestFingerprint({ ...base, maxSlippage: 0 }),
    );
  });
});
