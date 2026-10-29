import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  E2E_SESSION_MAX_AGE_SEC,
  isE2EAuthEnabled,
  readE2ESession,
  signE2ESession,
  verifyE2ESession,
} from "./e2e-auth";

// The CI-only sign-in bypass (docs/specs/m3-trading.md, "Playwright e2e"). Security critical: the
// guard must be false everywhere except a GitHub Actions job that sets both variables and is not
// on Vercel.

const SECRET = "s".repeat(32);
const OTHER_SECRET = "t".repeat(32);
const USER = "00000000-0000-4000-8000-000000000001";
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const ON = { E2E_AUTH_BYPASS: "1", E2E_AUTH_SECRET: SECRET, GITHUB_ACTIONS: "true" };

describe("isE2EAuthEnabled", () => {
  it("is true only with the flag, a long secret, GITHUB_ACTIONS and no VERCEL", () => {
    expect(isE2EAuthEnabled(ON)).toBe(true);
  });

  it("is false outside GitHub Actions even with every other condition met", () => {
    const { GITHUB_ACTIONS: _unset, ...local } = ON;
    expect(isE2EAuthEnabled(local)).toBe(false);
    for (const value of ["", "1", "TRUE", "True", " true", "false"]) {
      expect(isE2EAuthEnabled({ ...ON, GITHUB_ACTIONS: value })).toBe(false);
    }
  });

  it("is false on Vercel even with the flag and the secret set", () => {
    expect(isE2EAuthEnabled({ ...ON, VERCEL: "1" })).toBe(false);
    expect(isE2EAuthEnabled({ ...ON, VERCEL: "" })).toBe(false);
  });

  it("is false for every partial combination", () => {
    expect(isE2EAuthEnabled({})).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_BYPASS: "1" })).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_SECRET: SECRET })).toBe(false);
    expect(isE2EAuthEnabled({ VERCEL: "1" })).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_BYPASS: "1", VERCEL: "1" })).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_SECRET: SECRET, VERCEL: "1" })).toBe(false);
    expect(isE2EAuthEnabled({ GITHUB_ACTIONS: "true" })).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_BYPASS: "1", GITHUB_ACTIONS: "true" })).toBe(false);
    expect(isE2EAuthEnabled({ E2E_AUTH_SECRET: SECRET, GITHUB_ACTIONS: "true" })).toBe(false);
  });

  it("needs the flag to be exactly 1", () => {
    for (const flag of ["true", "yes", " 1", "1 ", "01", ""]) {
      expect(isE2EAuthEnabled({ ...ON, E2E_AUTH_BYPASS: flag })).toBe(false);
    }
  });

  it("needs a secret of at least 32 characters", () => {
    expect(isE2EAuthEnabled({ ...ON, E2E_AUTH_SECRET: "" })).toBe(false);
    expect(isE2EAuthEnabled({ ...ON, E2E_AUTH_SECRET: "s".repeat(31) })).toBe(false);
    expect(isE2EAuthEnabled({ ...ON, E2E_AUTH_SECRET: ` ${"s".repeat(30)} ` })).toBe(false);
  });

  it("ignores NODE_ENV", () => {
    expect(isE2EAuthEnabled({ ...ON, NODE_ENV: "production" })).toBe(true);
    expect(isE2EAuthEnabled({ NODE_ENV: "test", GITHUB_ACTIONS: "true" })).toBe(false);
  });

  it("reads process.env by default", () => {
    expect(isE2EAuthEnabled()).toBe(isE2EAuthEnabled(process.env));
  });
});

describe("signE2ESession and verifyE2ESession", () => {
  const exp = NOW + E2E_SESSION_MAX_AGE_SEC * 1000;

  it("round-trips the user id until the expiry", () => {
    const value = signE2ESession(USER, exp, SECRET);
    expect(verifyE2ESession(value, SECRET, NOW)).toBe(USER);
    expect(verifyE2ESession(value, SECRET, exp - 1000)).toBe(USER);
  });

  it("rejects an expired cookie", () => {
    const value = signE2ESession(USER, exp, SECRET);
    expect(verifyE2ESession(value, SECRET, exp)).toBeNull();
    expect(verifyE2ESession(value, SECRET, exp + 1)).toBeNull();
  });

  it("rejects a cookie signed with another secret", () => {
    expect(verifyE2ESession(signE2ESession(USER, exp, OTHER_SECRET), SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered user id, expiry or signature", () => {
    const value = signE2ESession(USER, exp, SECRET);
    const [v, , e, sig] = value.split(".");
    const otherUser = "00000000-0000-4000-8000-000000000002";
    expect(verifyE2ESession(`${v}.${otherUser}.${e}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyE2ESession(`${v}.${USER}.${Number(e) + 1}.${sig}`, SECRET, NOW)).toBeNull();
    const flipped = `${sig?.slice(0, -2)}${sig?.endsWith("AA") ? "BB" : "AA"}`;
    expect(verifyE2ESession(`${v}.${USER}.${e}.${flipped}`, SECRET, NOW)).toBeNull();
    expect(verifyE2ESession(`${v}.${USER}.${e}.${sig?.slice(0, 10)}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a forged signature over a well-formed payload with the wrong key", () => {
    const payload = `v1.${USER}.${Math.floor(exp / 1000)}`;
    const forged = createHmac("sha256", OTHER_SECRET).update(payload).digest("base64url");
    expect(verifyE2ESession(`${payload}.${forged}`, SECRET, NOW)).toBeNull();
  });

  it("rejects malformed values without throwing", () => {
    for (const value of [
      "",
      "garbage",
      "v1..1.x",
      `v2.${USER}.9999999999.x`,
      `v1.not-a-uuid.9999999999.x`,
      `v1.${USER}.soon.x`,
      `v1.${USER}.9999999999`,
      `v1.${USER}.9999999999.x.y`,
    ]) {
      expect(verifyE2ESession(value, SECRET, NOW)).toBeNull();
    }
  });

  it("refuses to sign a non-uuid user id or with a short secret", () => {
    expect(() => signE2ESession("bob", exp, SECRET)).toThrow();
    expect(() => signE2ESession(USER, exp, "short")).toThrow();
  });
});

describe("readE2ESession", () => {
  const exp = NOW + 60_000;
  const value = signE2ESession(USER, exp, SECRET);

  it("returns the user id for a valid cookie when the guard is on", () => {
    expect(readE2ESession(value, ON, NOW)).toBe(USER);
  });

  it("ignores a valid cookie when the guard is off", () => {
    expect(readE2ESession(value, {}, NOW)).toBeNull();
    expect(readE2ESession(value, { ...ON, GITHUB_ACTIONS: undefined }, NOW)).toBeNull();
    expect(readE2ESession(value, { E2E_AUTH_SECRET: SECRET }, NOW)).toBeNull();
    expect(readE2ESession(value, { E2E_AUTH_BYPASS: "1" }, NOW)).toBeNull();
  });

  it("ignores a valid cookie on Vercel", () => {
    expect(readE2ESession(value, { ...ON, VERCEL: "1" }, NOW)).toBeNull();
  });

  it("returns null for a missing, expired or wrongly signed cookie", () => {
    expect(readE2ESession(undefined, ON, NOW)).toBeNull();
    expect(readE2ESession(value, ON, exp)).toBeNull();
    expect(readE2ESession(value, { ...ON, E2E_AUTH_SECRET: OTHER_SECRET }, NOW)).toBeNull();
  });
});
