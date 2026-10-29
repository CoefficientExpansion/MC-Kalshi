import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { balances, profiles } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { DEFAULT_ALLOWED_DOMAINS } from "./auth-email";
import {
  type AuthDeps,
  type OtpClient,
  requestEmailCode,
  signOutOf,
  verifyEmailCode,
} from "./auth-flow";

const USER_ID = "20000000-0000-4000-8000-000000000001";

/** A scripted stand-in for the Supabase auth client. */
function fakeClient(opts: {
  sendError?: { status?: number; code?: string } | null;
  verify?: { id: string; email: string | null } | "error" | "no-user";
  verifyError?: { status?: number; code?: string };
}) {
  const calls = { send: [] as unknown[], verify: [] as unknown[], signOut: 0 };
  const client: OtpClient = {
    async signInWithOtp(args) {
      calls.send.push(args);
      return { error: opts.sendError ?? null };
    },
    async verifyOtp(args) {
      calls.verify.push(args);
      if (opts.verify === "error") {
        return { user: null, error: opts.verifyError ?? { status: 403, code: "otp_expired" } };
      }
      if (opts.verify === "no-user" || opts.verify === undefined) {
        return { user: null, error: null };
      }
      return { user: opts.verify, error: null };
    },
    async signOut() {
      calls.signOut += 1;
      return { error: null };
    },
  };
  return { client, calls };
}

describe("requestEmailCode", () => {
  const deps = (client: OtpClient | undefined): AuthDeps => ({
    client,
    db: undefined,
    domains: DEFAULT_ALLOWED_DOMAINS,
    bonusPoints: 100,
  });

  it("reports not configured when Supabase is absent", async () => {
    const result = await requestEmailCode(deps(undefined), "a@maryvillecollege.edu");
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("refuses a disallowed address without calling Supabase", async () => {
    const { client, calls } = fakeClient({});
    for (const email of [
      "a@gmail.com",
      "x@evil.maryvillecollege.edu.attacker.com",
      '"a@b"@c.com',
    ]) {
      expect(await requestEmailCode(deps(client), email)).toMatchObject({
        ok: false,
        code: "not_allowed",
      });
    }
    expect(calls.send).toEqual([]);
  });

  it("asks for an email when the field is empty or not text", async () => {
    const { client, calls } = fakeClient({});
    for (const raw of ["", "   ", null, undefined, 5]) {
      expect(await requestEmailCode(deps(client), raw)).toMatchObject({
        ok: false,
        code: "invalid_email",
      });
    }
    expect(calls.send).toEqual([]);
  });

  it("sends a code to the normalised address", async () => {
    const { client, calls } = fakeClient({});
    const result = await requestEmailCode(deps(client), "  Jane@My.MaryvilleCollege.edu ");
    expect(result).toEqual({ ok: true, email: "jane@my.maryvillecollege.edu" });
    expect(calls.send).toEqual([
      { email: "jane@my.maryvillecollege.edu", options: { shouldCreateUser: true } },
    ]);
  });

  it("maps Supabase failures to friendly messages", async () => {
    const limited = await requestEmailCode(
      deps(fakeClient({ sendError: { status: 429, code: "over_email_send_rate_limit" } }).client),
      "a@maryvillecollege.edu",
    );
    expect(limited).toMatchObject({ ok: false, code: "rate_limited" });

    const rejected = await requestEmailCode(
      deps(fakeClient({ sendError: { status: 403 } }).client),
      "a@maryvillecollege.edu",
    );
    expect(rejected).toMatchObject({ ok: false, code: "not_allowed" });

    const other = await requestEmailCode(
      deps(fakeClient({ sendError: { status: 500 } }).client),
      "a@maryvillecollege.edu",
    );
    expect(other).toMatchObject({ ok: false, code: "send_failed" });
    for (const r of [limited, rejected, other]) {
      expect(r.ok === false && r.message).not.toMatch(/status|500|429|supabase|undefined/i);
    }
  });

  it("honours a custom allowlist", async () => {
    const { client } = fakeClient({});
    const custom = { ...deps(client), domains: ["example.edu"] };
    expect(await requestEmailCode(custom, "a@example.edu")).toMatchObject({ ok: true });
    expect(await requestEmailCode(custom, "a@maryvillecollege.edu")).toMatchObject({
      ok: false,
      code: "not_allowed",
    });
  });
});

describe("verifyEmailCode", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  const deps = (client: OtpClient | undefined, withDb = true): AuthDeps => ({
    client,
    db: withDb ? db : undefined,
    domains: DEFAULT_ALLOWED_DOMAINS,
    bonusPoints: 10_000,
  });
  const points = async (id: string) =>
    (await db.select().from(balances).where(eq(balances.userId, id)))[0]?.points;

  it("reports not configured without Supabase or without a database", async () => {
    expect(
      await verifyEmailCode(deps(undefined), "a@maryvillecollege.edu", "123456"),
    ).toMatchObject({
      ok: false,
      code: "not_configured",
    });
    const { client } = fakeClient({});
    expect(
      await verifyEmailCode(deps(client, false), "a@maryvillecollege.edu", "123456"),
    ).toMatchObject({ ok: false, code: "not_configured" });
  });

  it("rejects a disallowed address and a malformed code before calling Supabase", async () => {
    const { client, calls } = fakeClient({});
    expect(await verifyEmailCode(deps(client), "a@gmail.com", "123456")).toMatchObject({
      code: "not_allowed",
    });
    for (const code of ["", "12345", "1234567", "abcdef", "12 34 5", "١٢٣٤٥٦", null, undefined]) {
      expect(await verifyEmailCode(deps(client), "a@maryvillecollege.edu", code)).toMatchObject({
        ok: false,
        code: "invalid_code",
      });
    }
    expect(calls.verify).toEqual([]);
  });

  it("verifies, creates the profile and credits the bonus on first sign-in", async () => {
    const { client, calls } = fakeClient({
      verify: { id: USER_ID, email: "Jane@my.maryvillecollege.edu" },
    });
    const result = await verifyEmailCode(deps(client), " Jane@my.maryvillecollege.edu ", "123 456");
    expect(result).toEqual({ ok: true });
    expect(calls.verify).toEqual([
      { email: "jane@my.maryvillecollege.edu", token: "123456", type: "email" },
    ]);
    expect(await points(USER_ID)).toBe(10_000);
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, USER_ID));
    expect(profile).toMatchObject({ email: "jane@my.maryvillecollege.edu", displayName: "jane" });
    expect(calls.signOut).toBe(0);
  });

  it("is idempotent: signing in again does not credit again", async () => {
    const { client } = fakeClient({
      verify: { id: USER_ID, email: "jane@my.maryvillecollege.edu" },
    });
    expect(await verifyEmailCode(deps(client), "jane@my.maryvillecollege.edu", "654321")).toEqual({
      ok: true,
    });
    expect(await points(USER_ID)).toBe(10_000);
  });

  it("maps a wrong or expired code to a friendly message", async () => {
    const { client } = fakeClient({ verify: "error" });
    const result = await verifyEmailCode(deps(client), "a@maryvillecollege.edu", "000000");
    expect(result).toMatchObject({ ok: false, code: "invalid_code" });
    expect(result.ok === false && result.message).toMatch(/code/i);
    expect(result.ok === false && result.message).not.toMatch(/otp_expired|403/);
  });

  it("maps a rate limit", async () => {
    const { client } = fakeClient({ verify: "error", verifyError: { status: 429 } });
    expect(await verifyEmailCode(deps(client), "a@maryvillecollege.edu", "000000")).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });

  it("treats a missing user in a success response as a failed code", async () => {
    const { client } = fakeClient({ verify: "no-user" });
    expect(await verifyEmailCode(deps(client), "a@maryvillecollege.edu", "000000")).toMatchObject({
      ok: false,
      code: "invalid_code",
    });
  });

  it("signs out and creates nothing when Supabase reports a disallowed address (hook not enabled)", async () => {
    const id = "20000000-0000-4000-8000-000000000002";
    const { client, calls } = fakeClient({ verify: { id, email: "intruder@gmail.com" } });
    const result = await verifyEmailCode(deps(client), "intruder@maryvillecollege.edu", "123456");
    expect(result).toMatchObject({ ok: false, code: "not_allowed" });
    expect(calls.signOut).toBe(1);
    expect(await db.select().from(profiles).where(eq(profiles.id, id))).toEqual([]);
    expect(await points(id)).toBeUndefined();
  });

  it("signs out and refuses when the account has no email", async () => {
    const id = "20000000-0000-4000-8000-000000000003";
    const { client, calls } = fakeClient({ verify: { id, email: null } });
    expect(await verifyEmailCode(deps(client), "a@maryvillecollege.edu", "123456")).toMatchObject({
      ok: false,
      code: "not_allowed",
    });
    expect(calls.signOut).toBe(1);
  });

  it("signs out a suspended member and says so", async () => {
    const id = "20000000-0000-4000-8000-000000000004";
    const email = "sus@maryvillecollege.edu";
    await db.insert(profiles).values({ id, email, displayName: "sus", suspendedAt: new Date() });
    const { client, calls } = fakeClient({ verify: { id, email } });
    const result = await verifyEmailCode(deps(client), email, "123456");
    expect(result).toMatchObject({ ok: false, code: "suspended" });
    expect(calls.signOut).toBe(1);
    expect(await points(id)).toBeUndefined();
  });

  it("signs out when another account already owns the email", async () => {
    const { client, calls } = fakeClient({
      verify: { id: "20000000-0000-4000-8000-000000000005", email: "jane@my.maryvillecollege.edu" },
    });
    const result = await verifyEmailCode(deps(client), "jane@my.maryvillecollege.edu", "123456");
    expect(result).toMatchObject({ ok: false, code: "account_conflict" });
    expect(calls.signOut).toBe(1);
  });

  it("signs out and reports unavailable when the database fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      transaction: async () => {
        throw new Error("connection refused");
      },
    } as unknown as TestDb;
    const { client, calls } = fakeClient({
      verify: { id: "20000000-0000-4000-8000-000000000006", email: "z@maryvillecollege.edu" },
    });
    const result = await verifyEmailCode(
      { ...deps(client), db: broken },
      "z@maryvillecollege.edu",
      "123456",
    );
    expect(result).toMatchObject({ ok: false, code: "unavailable" });
    expect(calls.signOut).toBe(1);
    // No email addresses in logs (SOP-09).
    expect(JSON.stringify(error.mock.calls)).not.toContain("z@maryvillecollege.edu");
    error.mockRestore();
  });
});

describe("signOutOf", () => {
  it("ends only this session", async () => {
    const seen: unknown[] = [];
    const client: OtpClient = {
      signInWithOtp: async () => ({ error: null }),
      verifyOtp: async () => ({ user: null, error: null }),
      signOut: async (scope) => {
        seen.push(scope);
        return { error: null };
      },
    };
    await signOutOf(client);
    expect(seen).toEqual(["local"]);
  });

  it("does nothing without a client", async () => {
    await expect(signOutOf(undefined)).resolves.toBeUndefined();
  });
});
