import "server-only";
import { createHash } from "node:crypto";
import type { ParsedTradeInput } from "./trade-types";

/**
 * `trades.request_fingerprint`: a sha256 hex digest of the normalized fields a replay must match
 * (market, side, mode, amount, expectedAvgPrice, maxSlippage, and expectedCostPoints for
 * `buy_contracts`, else null; docs/specs/m3-trading.md step 8).
 * The idempotency key itself is excluded: it is the lookup key, not part of the request. The
 * canonical form is a versioned JSON array in a fixed order, so property order cannot matter;
 * numbers use JSON's shortest round-trip form (−0 prints as 0).
 */
export function requestFingerprint(input: ParsedTradeInput): string {
  const canonical = JSON.stringify([
    "trade-v2",
    input.marketId.toLowerCase(),
    input.side,
    input.mode,
    input.amount,
    input.expectedAvgPrice,
    input.maxSlippage,
    input.expectedCostPoints ?? null,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
