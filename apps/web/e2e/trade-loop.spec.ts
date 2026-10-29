import { expect, test } from "@playwright/test";
import {
  buyYes,
  collegeEmail,
  headerBalance,
  MARKETS,
  parseNumber,
  positionYes,
  readHeaderBalance,
  readHeadlinePrice,
  readPositionYes,
  sellYes,
  signIn,
  ticket,
} from "./helpers";

// docs/specs/m3-trading.md, "Playwright e2e": the trade loop, a stale quote, and signed out.
// Runs against `next start` with E2E_AUTH_BYPASS=1 on a freshly migrated and seeded database (the
// CI `e2e` job). Each scenario has its own seeded market and its own members.

const formatPoints = (n: number) => `${n.toLocaleString("en-US")} pts`;

test("trade loop: buy, see it everywhere, sell half, ledger still balances", async ({ page }) => {
  const { slug, title } = MARKETS.loop;
  await signIn(page, collegeEmail("loop"));
  await page.goto(`/markets/${slug}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  const startBalance = await readHeaderBalance(page);
  const startPrice = await readHeadlinePrice(page);
  expect(startBalance).toBeGreaterThan(500);

  // Buy 500 points of YES.
  const bought = await buyYes(page, 500);
  expect(bought.cost).toBeGreaterThan(0);
  expect(bought.cost).toBeLessThanOrEqual(500);

  // The page refreshes itself: header balance, position card, headline price, chart.
  await expect(headerBalance(page)).toHaveText(formatPoints(startBalance - bought.cost));
  await expect(positionYes(page)).toBeVisible();
  expect(await readPositionYes(page)).toBeCloseTo(bought.contracts, 2);
  await expect.poll(() => readHeadlinePrice(page)).toBeGreaterThan(startPrice);
  await expect(
    page.getByRole("region", { name: "Price history" }).getByRole("img").first(),
  ).toBeVisible();

  // The portfolio lists the position.
  await page.goto("/portfolio");
  await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Positions" }).getByRole("link", { name: title, exact: true }),
  ).toBeVisible();

  // Sell half of the YES contracts.
  await page.goto(`/markets/${slug}`);
  await expect(positionYes(page)).toBeVisible();
  const held = await readPositionYes(page);
  const afterBuyBalance = await readHeaderBalance(page);
  const half = (Math.floor((held / 2) * 100) / 100).toFixed(2);
  const sold = await sellYes(page, half);
  expect(sold.proceeds).toBeGreaterThan(0);
  await expect(headerBalance(page)).toHaveText(formatPoints(afterBuyBalance + sold.proceeds));
  await expect
    .poll(async () => Math.abs((await readPositionYes(page)) - held / 2))
    .toBeLessThanOrEqual(0.02);

  // The daily invariant job agrees the books balance.
  const secret = process.env.CRON_SECRET;
  expect(secret, "CRON_SECRET must be set for the e2e run").toBeTruthy();
  const res = await page.request.get("/api/cron/ledger-invariants", {
    headers: { authorization: `Bearer ${secret}` },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true });
});

test("stale quote: another member moves the price, the ticket asks to confirm the new one", async ({
  page,
  browser,
  baseURL,
}) => {
  const { slug } = MARKETS.stale;
  await signIn(page, collegeEmail("stale-a"));
  await page.goto(`/markets/${slug}`);
  const form = ticket(page);
  await form.getByLabel("Amount in points", { exact: true }).fill("100");
  await expect(form.getByRole("region", { name: "Your order" })).toContainText("Contracts");

  // Freeze this page's view of the market: no more 3 s polls, so its quote goes stale.
  await page.route("**/api/markets/*/state", (route) => route.abort());

  // A second member moves the price with a big YES buy.
  const other = await browser.newContext({ baseURL });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, collegeEmail("stale-b"));
    await otherPage.goto(`/markets/${slug}`);
    await buyYes(otherPage, 300);
  } finally {
    await other.close();
  }

  // Submitting the stale order is refused with the new price, and nothing is traded yet.
  await form.getByRole("button", { name: /^Buy YES/ }).click();
  await expect(form.getByRole("alert")).toHaveText(
    /^The price moved from \d+ to \d+ pts\. Review the new price\.$/,
  );
  const confirm = form.getByRole("button", { name: /^Buy at \d+ pts$/ });
  await expect(confirm).toBeVisible();
  const quoteText = (await form.getByRole("region", { name: "Your order" }).textContent()) ?? "";
  const newContracts = /Contracts([\d.,]+)/.exec(quoteText)?.[1];
  expect(newContracts, "requote shows the contracts at the new price").toBeTruthy();

  // Confirming trades at the new price.
  await confirm.click();
  await expect(form.getByRole("status")).toHaveText(
    new RegExp(
      `^Bought ${(newContracts ?? "").replace(/\./g, "\\.")} YES contracts? for [\\d,]+ pts\\.$`,
    ),
  );
  expect(parseNumber(newContracts ?? "0")).toBeGreaterThan(0);
});

test("signed out: the ticket asks to sign in and the portfolio redirects", async ({ page }) => {
  await page.goto(`/markets/${MARKETS.signedOut.slug}`);
  await expect(ticket(page).getByRole("link", { name: "Sign in to trade" })).toBeVisible();
  await expect(ticket(page).getByRole("button", { name: /^Buy YES/ })).toHaveCount(0);

  await page.goto("/portfolio");
  await expect(page).toHaveURL(/\/sign-in$/);
});
