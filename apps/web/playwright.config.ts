import { defineConfig, devices } from "@playwright/test";

// End-to-end suite (docs/specs/m3-trading.md, "Playwright e2e"). It does not start the app: CI's
// `e2e` job runs `next start` with E2E_AUTH_BYPASS=1 on a migrated, seeded database and points
// E2E_BASE_URL here (default http://localhost:3000). Chromium only. One worker, in file order,
// because the scenarios share one database; no retries, because a retry would meet prices the
// first attempt already moved.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e-artifacts/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e-artifacts/playwright-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
