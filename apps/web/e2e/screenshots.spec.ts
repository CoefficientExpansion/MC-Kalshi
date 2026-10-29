import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { buyYes, collegeEmail, MARKETS, positionYes, signIn } from "./helpers";

// Full-page screenshots for design review (docs/design/theme.md): home, a market after a trade
// (signed in) and the portfolio, at phone and laptop sizes, light and dark. Saved under
// apps/web/e2e-artifacts/screenshots (gitignored; CI uploads the folder). Not visual assertions.

const SHOTS = join(__dirname, "..", "e2e-artifacts", "screenshots");
const EMAIL = collegeEmail("shots");
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
] as const;
const SCHEMES = ["light", "dark"] as const;

test.describe.configure({ mode: "serial" });

async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(SHOTS, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test("setup: the member holds a position to show", async ({ page }) => {
  await signIn(page, EMAIL);
  await page.goto(`/markets/${MARKETS.screenshots.slug}`);
  await buyYes(page, 200);
  await expect(positionYes(page)).toBeVisible();
});

for (const vp of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test.describe(`${vp.name} ${scheme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });

      test(`screenshots at ${vp.width}x${vp.height}, ${scheme}`, async ({ page }) => {
        const suffix = `${vp.width}x${vp.height}-${scheme}`;
        await signIn(page, EMAIL);

        await page.goto("/");
        await expect(
          page.getByRole("banner").getByRole("link", { name: "MC-Kalshi", exact: true }),
        ).toBeVisible();
        await shoot(page, `home-${suffix}`);

        await page.goto(`/markets/${MARKETS.screenshots.slug}`);
        await expect(
          page.getByRole("heading", { level: 1, name: MARKETS.screenshots.title }),
        ).toBeVisible();
        await expect(positionYes(page)).toBeVisible();
        await shoot(page, `market-${suffix}`);

        await page.goto("/portfolio");
        await expect(page.getByRole("heading", { level: 1, name: "Portfolio" })).toBeVisible();
        await shoot(page, `portfolio-${suffix}`);
      });
    });
  }
}
