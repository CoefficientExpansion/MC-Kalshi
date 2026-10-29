import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TRADE_ERROR_CODES,
  type TradeErrorCode,
  type TradeFailure,
  type TradeView,
} from "@/server/trade-types";
import { sourceCopy, TICKET_BANNED } from "./copy-guard";
import { buildTicketQuote, type TicketQuoteFailure } from "./ticket-quote";
import {
  formatContracts,
  formatPoints,
  impactWarning,
  inputProblem,
  quoteRows,
  requoteMessage,
  requoteRows,
  requoteSubmitLabel,
  sideSegmentLabel,
  submitLabel,
  successMessage,
  TICKET_COPY,
  tradeErrorMessage,
} from "./trade-copy";

/** The user-visible text of a source file (string literals and JSX text; see `sourceCopy`). */
function scannable(path: string): string {
  return sourceCopy(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")).join("\n");
}

function failure<C extends TradeErrorCode>(code: C, extra: object = {}): TradeFailure {
  return { ok: false, code, message: "raw server text", ...extra } as TradeFailure;
}

describe("number formats", () => {
  it("shows points with a separator and pts, never a currency sign", () => {
    expect(formatPoints(500)).toBe("500 pts");
    expect(formatPoints(5000)).toBe("5,000 pts");
    expect(formatPoints(0)).toBe("0 pts");
  });

  it("shows contracts to two decimals, and dust to six", () => {
    expect(formatContracts(9.761859)).toBe("9.76");
    expect(formatContracts(4.2)).toBe("4.2");
    expect(formatContracts(10)).toBe("10");
    expect(formatContracts(1234.5)).toBe("1,234.5");
    expect(formatContracts(0.004)).toBe("0.004");
    expect(formatContracts(-3)).toBe("3");
  });
});

describe("ticket labels", () => {
  it("puts the word and the price in each side segment", () => {
    expect(sideSegmentLabel("YES", 62)).toBe("YES 62 pts");
    expect(sideSegmentLabel("NO", 38)).toBe("NO 38 pts");
  });

  it("names the action, and says anyway for a big price move", () => {
    expect(submitLabel("buy", "YES", false)).toBe("Buy YES");
    expect(submitLabel("buy", "YES", true)).toBe("Buy YES anyway");
    expect(submitLabel("sell", "NO", false)).toBe("Sell NO");
    expect(submitLabel("sell", "NO", true)).toBe("Sell NO anyway");
  });

  it("offers the new price after a slippage reject", () => {
    expect(requoteMessage(51, 54)).toBe("The price moved from 51 to 54 pts. Review the new price.");
    expect(requoteSubmitLabel("buy", 54)).toBe("Buy at 54 pts");
    expect(requoteSubmitLabel("sell", 47)).toBe("Sell at 47 pts");
  });

  it("builds the buy rows from the spec", () => {
    const r = buildTicketQuote({ b: 100, qYes: 0, qNo: 0 }, "buy", "YES", "points", "500");
    if (!r.ok) throw new Error("unreachable");
    expect(quoteRows(r.quote)).toEqual([
      { label: "Avg price", value: "51 pts (51% to break even)" },
      { label: "Contracts", value: "9.76" },
      { label: "Payout if YES", value: "976 pts" },
      { label: "New price", value: "52%" },
    ]);
    const c = buildTicketQuote({ b: 100, qYes: 0, qNo: 0 }, "buy", "NO", "contracts", "10");
    if (!c.ok) throw new Error("unreachable");
    expect(quoteRows(c.quote).map((row) => row.label)).toEqual([
      "Avg price",
      "You pay",
      "Payout if NO",
      "New price",
    ]);
    expect(quoteRows(c.quote)[1]?.value).toBe(formatPoints(c.quote.costPoints));
  });

  it("builds the sell rows from the spec", () => {
    const r = buildTicketQuote(
      {
        b: 100,
        qYes: 10,
        qNo: 0,
        position: { contractsYes: 10, contractsNo: 0, costBasisPoints: 0 },
      },
      "sell",
      "YES",
      "contracts",
      "4",
    );
    if (!r.ok) throw new Error("unreachable");
    expect(quoteRows(r.quote).map((row) => row.label)).toEqual([
      "Avg price",
      "You receive",
      "New price",
      "Left in position",
    ]);
    expect(quoteRows(r.quote)[3]?.value).toBe("6 YES contracts");
  });

  it("builds the requote rows from the server's fresh quote", () => {
    const r = { avgPrice: 54, contracts: 9.2, costPoints: 500, probAfter: 0.56, payoutIfWin: 920 };
    expect(requoteRows({ mode: "buy_points", side: "YES" }, r)).toEqual([
      { label: "Avg price", value: "54 pts (54% to break even)" },
      { label: "Contracts", value: "9.2" },
      { label: "Payout if YES", value: "920 pts" },
      { label: "New price", value: "56%" },
    ]);
    expect(requoteRows({ mode: "buy_contracts", side: "NO" }, r)[1]).toEqual({
      label: "You pay",
      value: "500 pts",
    });
    expect(requoteRows({ mode: "buy_contracts", side: "NO" }, r)[3]?.value).toBe("44%");
    expect(
      requoteRows({ mode: "sell_contracts", side: "YES" }, { ...r, costPoints: -230 }),
    ).toEqual([
      { label: "Avg price", value: "54 pts" },
      { label: "You receive", value: "230 pts" },
      { label: "New price", value: "56%" },
    ]);
  });

  it("adds Left in position to a sell's requote rows when the holding is known", () => {
    const r = { avgPrice: 47, contracts: -4, costPoints: -188, probAfter: 0.46, payoutIfWin: 0 };
    const order = { mode: "sell_contracts", side: "YES", amount: 4 } as const;
    expect(requoteRows(order, r, 10)).toEqual([
      { label: "Avg price", value: "47 pts" },
      { label: "You receive", value: "188 pts" },
      { label: "New price", value: "46%" },
      { label: "Left in position", value: "6 YES contracts" },
    ]);
    expect(requoteRows(order, r, 4)[3]).toEqual({
      label: "Left in position",
      value: "0 YES contracts",
    });
    expect(requoteRows({ mode: "buy_points", side: "YES", amount: 4 }, r, 10)).toHaveLength(4);
    expect(requoteRows({ mode: "buy_points", side: "YES", amount: 4 }, r, 10)[3]?.label).toBe(
      "New price",
    );
  });

  it("describes a big price move", () => {
    const r = buildTicketQuote({ b: 100, qYes: 0, qNo: 0 }, "buy", "YES", "points", "2000");
    if (!r.ok) throw new Error("unreachable");
    expect(impactWarning(r.quote)).toBe(
      `Big price move: YES goes from 50% to ${r.quote.newPricePct}%`,
    );
  });

  it("says what was traded on success", () => {
    const trade: TradeView = {
      id: "t",
      side: "YES",
      contracts: 9.761859,
      costPoints: 500,
      avgPrice: 51,
      probBefore: 0.5,
      probAfter: 0.524,
      createdAt: "2026-10-29T16:00:00Z",
    };
    expect(successMessage(trade)).toBe("Bought 9.76 YES contracts for 500 pts.");
    expect(successMessage({ ...trade, side: "NO", contracts: -4.2, costPoints: -230 })).toBe(
      "Sold 4.2 NO contracts for 230 pts.",
    );
    expect(successMessage({ ...trade, contracts: 1, costPoints: 60 })).toBe(
      "Bought 1 YES contract for 60 pts.",
    );
  });
});

describe("input problems", () => {
  const cases: [TicketQuoteFailure, string | null][] = [
    [{ ok: false, reason: "empty" }, null],
    [{ ok: false, reason: "not_a_number" }, "Enter a number, like 500."],
    [{ ok: false, reason: "too_many_decimals", maxDecimals: 0 }, "Use whole points."],
    [{ ok: false, reason: "too_many_decimals", maxDecimals: 6 }, "Use at most 6 decimal places."],
    [
      { ok: false, reason: "below_minimum", minContracts: 0.01 },
      "Too small: the smallest trade is 0.01 contracts",
    ],
    [
      { ok: false, reason: "above_maximum", maxPoints: 5000 },
      "Too big: the most you can buy at once here is 5,000 pts",
    ],
    [{ ok: false, reason: "above_maximum", maxPoints: null }, "That amount is too large."],
    [{ ok: false, reason: "exceeds_holdings", held: 4.2 }, "You only hold 4.2 YES contracts"],
    [{ ok: false, reason: "exceeds_holdings", held: 0 }, "You hold no YES contracts to sell"],
  ];
  it.each(cases)("maps %o to fixed copy", (f, text) => {
    expect(inputProblem(f, "YES")).toBe(text);
  });

  it("maps exceeds_balance to the spec line", () => {
    const r = buildTicketQuote(
      { b: 100, qYes: 0, qNo: 0, balance: 320 },
      "buy",
      "YES",
      "points",
      "500",
    );
    if (r.ok) throw new Error("unreachable");
    expect(inputProblem(r, "YES")).toBe("Not enough points: you have 320 and need 500");
  });
});

describe("tradeErrorMessage", () => {
  it("has fixed copy for every code and never shows the raw message", () => {
    for (const code of TRADE_ERROR_CODES) {
      const text = tradeErrorMessage(
        failure(code, {
          requote: {
            avgPrice: 54,
            contracts: 9,
            costPoints: 500,
            probAfter: 0.55,
            payoutIfWin: 900,
          },
          maxPoints: 5000,
          balance: 320,
          needed: 500,
          held: 4.2,
          retryAfterSec: 12,
        }),
        { side: "YES", expectedAvgPrice: 51 },
      );
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("raw server text");
      expect(text).not.toMatch(TICKET_BANNED);
    }
  });

  it.each<[TradeFailure, string]>([
    [
      failure("insufficient_balance", { balance: 320, needed: 500 }),
      "Not enough points: you have 320 and need 500",
    ],
    [failure("insufficient_position", { held: 4.2 }), "You only hold 4.2 YES contracts"],
    [failure("trade_too_small"), "Too small: the smallest trade is 0.01 contracts"],
    [
      failure("trade_too_large", { maxPoints: 5000 }),
      "Too big: the most you can buy at once here is 5,000 pts",
    ],
    [failure("rate_limited", { retryAfterSec: 12 }), "Slow down a little and try again in 12 s"],
    [failure("trading_paused"), "Trading is paused"],
    [failure("account_suspended"), "Your account can't trade right now"],
    [failure("market_closed"), "Trading is closed"],
    [failure("market_not_open"), "Trading is closed"],
    [
      failure("slippage_exceeded", {
        requote: { avgPrice: 54, contracts: 9, costPoints: 500, probAfter: 0.55, payoutIfWin: 900 },
      }),
      "The price moved from 51 to 54 pts. Review the new price.",
    ],
  ])("maps %o", (f, text) => {
    expect(tradeErrorMessage(f, { side: "YES", expectedAvgPrice: 51 })).toBe(text);
  });
});

describe("copy guard", () => {
  it("finds the pattern it is meant to find", () => {
    for (const bad of ["Place a bet", "wager", "Win a prize", "cash out", "cashout", "$5", "5¢"]) {
      expect(bad).toMatch(TICKET_BANNED);
    }
    // The scan reads real copy out of a file: the ticket's title is in it.
    expect(scannable("./trade-copy.ts")).toContain("Trade");
  });

  it.each([
    "./trade-copy.ts",
    "./ticket-quote.ts",
    "./ticket-order.ts",
    "./use-market-state.ts",
    "../components/market/order-ticket.tsx",
    "../components/market/order-ticket-view.tsx",
  ])("%s contains no banned copy", (path) => {
    expect(scannable(path)).not.toMatch(TICKET_BANNED);
  });

  it("every exported string in TICKET_COPY is clean", () => {
    for (const text of Object.values(TICKET_COPY)) expect(text).not.toMatch(TICKET_BANNED);
  });
});
