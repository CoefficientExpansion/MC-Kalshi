import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TICKET_BANNED, visibleText } from "@/lib/copy-guard";
import { buildTicketQuote } from "@/lib/ticket-quote";
import { requoteRows } from "@/lib/trade-copy";
import type { MarketStateDto } from "@/server/trade-types";
import { OrderTicket, type OrderTicketProps } from "./order-ticket";
import { OrderTicketView, type TicketViewProps } from "./order-ticket-view";

const MARKET_ID = "6f1c2a1e-1111-4222-8333-444455556666";
const NOW = Date.parse("2026-10-29T16:00:00Z");
const market: MarketStateDto = {
  status: "open",
  closeAt: "2026-11-12T04:59:00.000Z",
  b: 100,
  qYes: 0,
  qNo: 0,
  probabilityYes: 0.5,
};
const account = {
  balance: 10_000,
  position: { contractsYes: 4.2, contractsNo: 0, costBasisPoints: 200 },
};

function ticket(overrides: Partial<OrderTicketProps> = {}) {
  return renderToStaticMarkup(
    createElement(OrderTicket, {
      marketId: MARKET_ID,
      market,
      account,
      submit: vi.fn(),
      now: NOW,
      ...overrides,
    }),
  );
}

const noop = () => {};
function view(overrides: Partial<TicketViewProps> = {}) {
  const base: TicketViewProps = {
    tab: "buy",
    side: "YES",
    unit: "points",
    amountText: "500",
    tolerance: 2,
    yesPrice: 50,
    gate: "open",
    balance: 10_000,
    held: 4.2,
    result: buildTicketQuote({ ...market, balance: 10_000 }, "buy", "YES", "points", "500"),
    requoteRows: null,
    status: { kind: "idle" },
    canMax: true,
    signInHref: "/sign-in",
    onTab: noop,
    onSide: noop,
    onUnit: noop,
    onAmount: noop,
    onMax: noop,
    onTolerance: noop,
    onSubmit: noop,
  };
  return renderToStaticMarkup(createElement(OrderTicketView, { ...base, ...overrides }));
}

/** Visible text with the entities React escapes turned back into characters. */
const text = (html: string) =>
  visibleText(html)
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

describe("OrderTicket layout", () => {
  it("renders the desktop card from 1024 px and the mobile YES/NO buttons below it", () => {
    const html = ticket();
    expect(html).toMatch(/<section aria-label="Trade" class="hidden [^"]*lg:block/);
    expect(html).toMatch(/class="grid grid-cols-2 gap-2 lg:hidden"/);
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*>.*Buy YES.*50 pts/);
    expect(html).toMatch(/<dialog aria-label="Trade"/);
  });

  it("has Buy | Sell, the YES/NO segments with prices, and the unit toggle as radio groups", () => {
    const html = ticket();
    expect(html.match(/type="radio"/g)).toHaveLength(6);
    expect(text(html)).toContain("Order type");
    expect(text(html)).toContain("YES 50 pts");
    expect(text(html)).toContain("NO 50 pts");
    expect(text(html)).toContain("Points");
    expect(text(html)).toContain("Contracts");
    expect(html).toMatch(/<legend[^>]*>Outcome<\/legend>/);
  });

  it("labels the one amount input and offers Max", () => {
    const html = ticket();
    const id = html.match(/<label for="([^"]+)"[^>]*>Amount in points<\/label>/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/aria-label="Fill the most you can use"[^>]*>Max</);
    expect(text(html)).toContain("Balance 10,000 pts");
  });

  it("shows the quote rows in a polite live region", () => {
    const html = ticket({ initial: { amountText: "500" } });
    expect(html).toMatch(/aria-live="polite"/);
    const t = text(html);
    expect(t).toContain("Avg price 51 pts (51% to break even)");
    expect(t).toContain("Contracts 9.76");
    expect(t).toContain("Payout if YES 976 pts");
    expect(t).toContain("New price 52%");
    expect(html).toMatch(/<button type="submit"[^>]*>Buy YES<\/button>/);
  });

  it("drops the unit toggle on the Sell tab and shows the holding", () => {
    const html = ticket({ initial: { tab: "sell", amountText: "2" } });
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    const t = text(html);
    expect(t).toContain("Contracts to sell");
    expect(t).toContain("You hold 4.2 YES contracts");
    expect(t).toContain("You receive");
    expect(t).toContain("Left in position 2.2 YES contracts");
    expect(html).toMatch(/>Sell YES<\/button>/);
  });
});

describe("OrderTicket states", () => {
  it("signed out: the quote still works and the CTA is Sign in to trade", () => {
    const html = ticket({ account: null, initial: { amountText: "500" }, signInHref: "/sign-in" });
    expect(html).toMatch(/<a [^>]*href="\/sign-in"[^>]*>Sign in to trade<\/a>/);
    expect(text(html)).toContain("Contracts 9.76");
    expect(html).not.toMatch(/type="submit"/);
    expect(text(html)).not.toContain("Balance");
  });

  it("suspended: says the account can't trade and has no submit", () => {
    const html = ticket({ suspended: true, initial: { amountText: "500" } });
    expect(text(html)).toContain("Your account can't trade right now");
    expect(html).not.toMatch(/type="submit"/);
  });

  it.each<[string, Partial<MarketStateDto>]>([
    ["closed", { status: "closed" }],
    ["resolved", { status: "resolved" }],
    ["past its close time", { closeAt: "2026-10-29T15:59:00.000Z" }],
  ])("%s: Trading is closed and the inputs are disabled", (_, change) => {
    const html = ticket({ market: { ...market, ...change } });
    expect(text(html)).toContain("Trading is closed");
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).not.toMatch(/type="submit"/);
  });

  it("uses the fresh balance and position from polled state when present", () => {
    const html = ticket({
      market: {
        ...market,
        balance: 320,
        position: { contractsYes: 0, contractsNo: 1, costBasisPoints: 40 },
      },
      initial: { amountText: "500" },
    });
    expect(text(html)).toContain("Balance 320 pts");
    expect(text(html)).toContain("Not enough points: you have 320 and need 500");
  });
});

describe("OrderTicketView states", () => {
  it("pending: busy form, disabled button, spinner", () => {
    const html = view({ status: { kind: "pending" } });
    expect(html).toMatch(/<form [^>]*aria-busy="true"/);
    expect(html).toMatch(
      /<button type="submit" disabled=""[^>]*>.*animate-spin.*Placing order…<\/button>/,
    );
  });

  it("idle is not busy", () => {
    expect(view()).toMatch(/<form [^>]*aria-busy="false"/);
  });

  it("success: a status line with what was traded", () => {
    const html = view({
      amountText: "",
      result: { ok: false, reason: "empty" },
      status: { kind: "success", message: "Bought 9.76 YES contracts for 500 pts." },
    });
    expect(html).toMatch(/role="status"[^>]*>Bought 9.76 YES contracts for 500 pts.</);
  });

  it("error: inline with role=alert and fixed copy", () => {
    const html = view({
      status: { kind: "error", message: "Slow down a little and try again in 12 s" },
    });
    expect(html).toMatch(/role="alert"[^>]*>Slow down a little and try again in 12 s</);
  });

  it("input problems: aria-invalid, described by the message, and no submit", () => {
    const html = view({
      amountText: "10.5",
      result: { ok: false, reason: "too_many_decimals", maxDecimals: 0 },
    });
    expect(html).toMatch(/aria-invalid="true"/);
    const problemId = html.match(
      /<p id="([^"]+)" class="[^"]*text-danger[^"]*">Use whole points.<\/p>/,
    )?.[1];
    expect(problemId).toBeTruthy();
    expect(html).toMatch(new RegExp(`aria-describedby="[^"]*${problemId}"`));
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });

  it("a big price move shows the warning chip and Buy YES anyway", () => {
    const result = buildTicketQuote({ ...market, balance: 10_000 }, "buy", "YES", "points", "2000");
    const html = view({ amountText: "2000", result });
    expect(text(html)).toMatch(/Big price move: YES goes from 50% to \d+%/);
    expect(html).toMatch(/>Buy YES anyway<\/button>/);
  });

  it("slippage: swaps in the requote, shows the message and Buy at 54 pts", () => {
    const requote = {
      avgPrice: 54,
      contracts: 9.2,
      costPoints: 500,
      probAfter: 0.56,
      payoutIfWin: 920,
    };
    const html = view({
      requoteRows: requoteRows({ mode: "buy_points", side: "YES" }, requote),
      status: {
        kind: "requote",
        message: "The price moved from 51 to 54 pts. Review the new price.",
        avgPrice: 54,
      },
    });
    expect(html).toMatch(
      /role="alert"[^>]*>The price moved from 51 to 54 pts. Review the new price.</,
    );
    expect(text(html)).toContain("Avg price 54 pts (54% to break even)");
    expect(text(html)).toContain("Payout if YES 920 pts");
    expect(html).toMatch(/<button type="submit"[^>]*>Buy at 54 pts<\/button>/);
  });

  it("offers the 1 / 2 / 5 point tolerance with 2 selected", () => {
    const html = view();
    expect(html).toMatch(/<summary[^>]*>Advanced<\/summary>/);
    expect(html).toMatch(/<option value="1">1 pts per contract<\/option>/);
    expect(html).toMatch(/<option value="2" selected="">2 pts per contract<\/option>/);
    expect(html).toMatch(/<option value="5">5 pts per contract<\/option>/);
  });

  it("colors the NO segment and button with NO tokens, never the brand pair", () => {
    const result = buildTicketQuote({ ...market, balance: 10_000 }, "buy", "NO", "points", "500");
    const html = view({ side: "NO", result });
    expect(html).toMatch(
      /<button type="submit"[^>]*class="[^"]*bg-no text-on-no[^"]*"[^>]*>Buy NO</,
    );
    expect(html).not.toMatch(/bg-(brand|accent)[^"]*text-on-(yes|no)/);
  });
});

describe("ticket copy guard", () => {
  it.each<[string, string]>([
    ["signed in, quoted", ticket({ initial: { amountText: "500" } })],
    ["signed out", ticket({ account: null, initial: { amountText: "500" } })],
    ["sell", ticket({ initial: { tab: "sell", amountText: "1" } })],
    ["closed", ticket({ market: { ...market, status: "closed" } })],
    ["pending", view({ status: { kind: "pending" } })],
  ])("%s has no banned words in its visible text", (_, html) => {
    expect(text(html)).not.toMatch(TICKET_BANNED);
  });
});
