import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { balances, ledgerEntries, profiles } from "@/db/schema";
import { openTestDb } from "@/db/test-db";
import type { AnyDb } from "@/db/types";
import { verifyE2ESession } from "@/server/e2e-auth";
import { POST } from "./route";

// POST /api/test/session: the CI-only sign-in (docs/specs/m3-trading.md, "Playwright e2e").
// 404 with an empty body whenever the guard is off; otherwise an allowed college email gets a
// profile, the signup bonus (through ensureProfile) and a signed `e2e-session` cookie.

const SECRET = "k".repeat(48);
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ getDb: () => mocks.db }));

let db: AnyDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await openTestDb());
});
afterAll(async () => {
  await close();
});

beforeEach(() => {
  mocks.db = db;
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("E2E_AUTH_SECRET", SECRET);
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("SIGNUP_BONUS_POINTS", undefined);
  vi.stubEnv("ALLOWED_EMAIL_DOMAINS", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost:3000/api/test/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

function sessionCookie(res: Response): { value: string; attributes: string[] } {
  const header = res.headers.get("set-cookie") ?? "";
  const [pair = "", ...attributes] = header.split(/;\s*/);
  expect(pair.startsWith("e2e-session=")).toBe(true);
  return { value: decodeURIComponent(pair.slice("e2e-session=".length)), attributes };
}

describe("POST /api/test/session with the guard off", () => {
  it.each([
    ["no variables", { E2E_AUTH_BYPASS: undefined, E2E_AUTH_SECRET: undefined }],
    ["flag only", { E2E_AUTH_SECRET: undefined }],
    ["secret only", { E2E_AUTH_BYPASS: undefined }],
    ["a short secret", { E2E_AUTH_SECRET: "short" }],
    ["on Vercel", { VERCEL: "1" }],
  ])("returns a bare 404 with %s and creates nothing", async (_name, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const res = await post({ email: "off@maryvillecollege.edu" });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(res.headers.get("set-cookie")).toBeNull();
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, "off@maryvillecollege.edu"));
    expect(rows).toHaveLength(0);
  });
});

describe("POST /api/test/session with the guard on", () => {
  it("creates the profile and the signup bonus and sets a signed, short-lived cookie", async () => {
    const before = Date.now();
    const res = await post({ email: "  Alice@My.MaryvilleCollege.edu " });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string };
    expect(body.ok).toBe(true);

    const { value, attributes } = sessionCookie(res);
    expect(verifyE2ESession(value, SECRET, before)).toBe(body.userId);
    expect(verifyE2ESession(value, "z".repeat(48), before)).toBeNull();
    const lower = attributes.map((a) => a.toLowerCase());
    expect(lower).toContain("httponly");
    expect(lower).toContain("samesite=lax");
    expect(lower).toContain("path=/");
    const maxAge = Number(lower.find((a) => a.startsWith("max-age="))?.split("=")[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(60 * 60);
    expect(verifyE2ESession(value, SECRET, before + (maxAge + 60) * 1000)).toBeNull();

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, body.userId));
    expect(profile?.email).toBe("alice@my.maryvillecollege.edu");
    const [balance] = await db.select().from(balances).where(eq(balances.userId, body.userId));
    expect(balance?.points).toBe(10_000);
    const bonus = (
      await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, body.userId))
    ).filter((r) => r.reason === "signup_bonus");
    expect(bonus).toHaveLength(1);
  });

  it("is idempotent: the same email gets the same user and no second bonus", async () => {
    const first = (await (await post({ email: "bob@maryvillecollege.edu" })).json()) as {
      userId: string;
    };
    const second = (await (await post({ email: "BOB@maryvillecollege.edu" })).json()) as {
      userId: string;
    };
    expect(second.userId).toBe(first.userId);
    const [balance] = await db.select().from(balances).where(eq(balances.userId, first.userId));
    expect(balance?.points).toBe(10_000);
  });

  it("refuses an address outside the college domains", async () => {
    for (const email of ["eve@gmail.com", "eve@maryvillecollege.edu.evil.com", "", 42]) {
      const res = await post({ email });
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await db.select().from(profiles).where(eq(profiles.email, "eve@gmail.com"))).toEqual([]);
  });

  it("refuses a malformed body", async () => {
    for (const body of ["not json", "[]", "null"]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("answers 503 without a database", async () => {
    mocks.db = undefined;
    const res = await post({ email: "carol@maryvillecollege.edu" });
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
