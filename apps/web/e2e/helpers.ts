import { randomBytes } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";

// Shared steps for the Playwright suite (docs/specs/m3-trading.md, "Playwright e2e"). Selectors are
// roles, labels and visible text from the real markup (order-ticket-view.tsx, position-card.tsx,
// account-control.tsx, portfolio/page.tsx), never CSS classes.

/** Seeded markets (src/db/seed.ts), one per scenario so the scenarios do not move each other's prices. */
export const MARKETS = {
  loop: {
    slug: "library-open-past-midnight-finals",
    title: "Will the library stay open past midnight during finals week?",
  },
  stale: {
    slug: "dining-hall-holiday-menu",
    title: "Will the dining hall post a special holiday menu before Thanksgiving break?",
  },
  signedOut: {
    slug: "spring-schedule-published-early",
    title: "Will the spring course schedule be published by November 15?",
  },
  screenshots: {
    slug: "snow-before-december",
    title: "Will Maryville get measurable snow before December 1?",
  },
} as const;

/** A fresh allowed address per call, so a re-run against the same database starts a new member. */
export function collegeEmail(tag: string): string {
  return `e2e-${tag}-${randomBytes(4).toString("hex")}@my.maryvillecollege.edu`;
}

/** Sign in through the CI-only test route; the cookie lands in the page's browser context. */
export async function signIn(page: Page, email: string): Promise<void> {
  const res = await page.request.post("/api/test/session", { data: { email } });
  expect(res.status(), "POST /api/test/session (is E2E_AUTH_BYPASS=1 set on the server?)").toBe(
    200,
  );
}

/** "12,345" or "569.13" as a number. */
export function parseNumber(text: string): number {
  return Number(text.replace(/,/g, ""));
}

/** The points balance in the site header ("10,000 pts"). */
export function headerBalance(page: Page): Locator {
  return page.getByRole("banner").getByText(/^[\d,]+ pts$/);
}

export async function readHeaderBalance(page: Page): Promise<number> {
  const text = (await headerBalance(page).textContent()) ?? "";
  return parseNumber(text.replace(" pts", ""));
}

/** The headline YES price on a market page ("50% chance"), as a number. */
export async function readHeadlinePrice(page: Page): Promise<number> {
  const text =
    (await page
      .getByRole("main")
      .getByText(/^\d{1,2}% chance$/)
      .textContent()) ?? "";
  return Number.parseInt(text, 10);
}

/** The order ticket form (desktop card; from 1024 px wide it is always on the page). */
export function ticket(page: Page): Locator {
  return page.getByRole("form", { name: "Trade" });
}

/** The YES contracts on the "Your position" card. */
export function positionYes(page: Page): Locator {
  return page.getByRole("region", { name: "Your position" }).getByText(/^YES [\d.,]+ contracts?$/);
}

export async function readPositionYes(page: Page): Promise<number> {
  const text = (await positionYes(page).textContent()) ?? "";
  return parseNumber(text.replace(/^YES /, "").replace(/ contracts?$/, ""));
}

const BOUGHT = /^Bought ([\d.,]+) YES contracts? for ([\d,]+) pts\.$/;
const SOLD = /^Sold ([\d.,]+) YES contracts? for ([\d,]+) pts\.$/;

/** Buy YES for `points` on the open market page; returns the contracts and cost the ticket shows. */
export async function buyYes(
  page: Page,
  points: number,
): Promise<{ contracts: number; cost: number }> {
  const form = ticket(page);
  await form.getByLabel("Amount in points", { exact: true }).fill(String(points));
  await expect(form.getByRole("region", { name: "Your order" })).toContainText("Contracts");
  await form.getByRole("button", { name: /^Buy YES/ }).click();
  const status = form.getByRole("status");
  await expect(status).toHaveText(BOUGHT);
  const [, contracts = "", cost = ""] = BOUGHT.exec((await status.textContent()) ?? "") ?? [];
  return { contracts: parseNumber(contracts), cost: parseNumber(cost) };
}

/** Sell `contracts` YES contracts; returns the proceeds the ticket shows. */
export async function sellYes(page: Page, contracts: string): Promise<{ proceeds: number }> {
  const form = ticket(page);
  await form.getByText("Sell", { exact: true }).click();
  await expect(form.getByRole("radio", { name: "Sell" })).toBeChecked();
  await form.getByLabel("Contracts to sell", { exact: true }).fill(contracts);
  await expect(form.getByRole("region", { name: "Your order" })).toContainText("You receive");
  await form.getByRole("button", { name: /^Sell YES/ }).click();
  const status = form.getByRole("status");
  await expect(status).toHaveText(SOLD);
  const [, , proceeds = ""] = SOLD.exec((await status.textContent()) ?? "") ?? [];
  return { proceeds: parseNumber(proceeds) };
}
