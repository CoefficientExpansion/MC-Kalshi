import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { balances, ledgerEntries, profiles } from "@/db/schema";
import { createTestDb, type TestDb } from "@/db/test-db";
import { ANY_DOMAIN, type DomainPolicy } from "./auth-email";
import type { AuthApiError } from "./auth-flow";
import {
  type PasswordAuthDeps,
  type PasswordClient,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from "./auth-password";

// Open-mode sign-up and sign-in (ADR-0007, docs/specs/open-signup.md). These write the signup
// bonus into ledger_entries through ensureProfile, so they run against a real (PGlite) database.

const PASSWORD = "correct horse battery";

/** A stand-in for Supabase Auth that remembers accounts, so sign-up then sign-in is real. */
function fakeSupabase(
  opts: {
    signUpError?: AuthApiError;
    signInError?: AuthApiError;
    /** Confirm email still on: sign-up returns the user but no session. */
    noSession?: boolean;
    /** A success response without a user (should not happen). */
    noUser?: boolean;
  } = {},
) {
  const accounts = new Map<string, { id: string; password: string }>();
  let next = 1;
  const calls = { signUp: [] as unknown[], signIn: [] as unknown[], signOut: 0 };
  const client: PasswordClient = {
    async signUp(args) {
      calls.signUp.push(args);
      if (opts.signUpError) return { user: null, hasSession: false, error: opts.signUpError };
      if (accounts.has(args.email)) {
        return {
          user: null,
          hasSession: false,
          error: { status: 422, code: "user_already_exists" },
        };
      }
      const id = `40000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
      accounts.set(args.email, { id, password: args.password });
      if (opts.noUser) return { user: null, hasSession: false, error: null };
      return { user: { id, email: args.email }, hasSession: !opts.noSession, error: null };
    },
    async signInWithPassword(args) {
      calls.signIn.push(args);
      if (opts.signInError) return { user: null, error: opts.signInError };
      const account = accounts.get(args.email);
      if (!account || account.password !== args.password) {
        return { user: null, error: { status: 400, code: "invalid_credentials" } };
      }
      return { user: { id: account.id, email: args.email }, error: null };
    },
    async signOut() {
      calls.signOut += 1;
      return { error: null };
    },
  };
  return { client, calls, accounts };
}

describe("open-mode password sign-up and sign-in", () => {
  let db: TestDb;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => {
    await close();
  });

  const deps = (
    client: PasswordClient | undefined,
    over: { open?: boolean; withDb?: boolean; domains?: DomainPolicy } = {},
  ): PasswordAuthDeps => ({
    client,
    db: over.withDb === false ? undefined : db,
    domains: over.domains ?? ANY_DOMAIN,
    bonusPoints: 10_000,
    open: over.open ?? true,
  });
  const points = async (id: string) =>
    (await db.select().from(balances).where(eq(balances.userId, id)))[0]?.points;
  const bonusEntries = async (id: string) =>
    (await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, id))).filter(
      (e) => e.reason === "signup_bonus",
    );
  const profileByEmail = async (email: string) =>
    (await db.select().from(profiles).where(eq(profiles.email, email)))[0];

  describe("guards before Supabase is called", () => {
    it("reports not configured without Supabase or without a database", async () => {
      const { client } = fakeSupabase();
      for (const d of [deps(undefined), deps(client, { withDb: false })]) {
        expect(await signUpWithEmailPassword(d, "a@gmail.com", PASSWORD)).toMatchObject({
          ok: false,
          code: "not_configured",
        });
        expect(await signInWithEmailPassword(d, "a@gmail.com", PASSWORD)).toMatchObject({
          ok: false,
          code: "not_configured",
        });
      }
    });

    it("refuses both actions in college mode", async () => {
      const { client, calls } = fakeSupabase();
      const college = deps(client, { open: false, domains: ["maryvillecollege.edu"] });
      for (const action of [signUpWithEmailPassword, signInWithEmailPassword]) {
        expect(await action(college, "a@maryvillecollege.edu", PASSWORD)).toMatchObject({
          ok: false,
          code: "password_off",
        });
      }
      expect(calls.signUp).toEqual([]);
      expect(calls.signIn).toEqual([]);
    });

    it("asks for a valid email address for empty, non-text or malformed input", async () => {
      const { client, calls } = fakeSupabase();
      for (const raw of ["", "  ", null, undefined, 5, "jane", "a@b@gmail.com", "jane@localhost"]) {
        for (const action of [signUpWithEmailPassword, signInWithEmailPassword]) {
          const result = await action(deps(client), raw, PASSWORD);
          expect(result, String(raw)).toMatchObject({ ok: false, code: "email_format" });
          expect(result.ok === false && result.message).toBe("Enter a valid email address.");
        }
      }
      expect(calls.signUp).toEqual([]);
      expect(calls.signIn).toEqual([]);
    });

    it("refuses a sign-up password shorter than 10 or longer than 72 (characters or bytes)", async () => {
      const { client, calls } = fakeSupabase();
      for (const pw of [
        "",
        "123456789",
        "a".repeat(73),
        "é".repeat(40), // 40 characters but 80 UTF-8 bytes: bcrypt's limit is bytes
        null,
        12345678901,
      ]) {
        const result = await signUpWithEmailPassword(deps(client), "a@gmail.com", pw);
        expect(result).toMatchObject({ ok: false, code: "password_length" });
        expect(result.ok === false && result.message).toMatch(/10 to 72 characters/);
      }
      expect(calls.signUp).toEqual([]);
    });

    it("answers an out-of-range sign-in password with the same wrong-credentials message", async () => {
      const { client, calls } = fakeSupabase();
      for (const pw of ["", "short", "a".repeat(73), undefined]) {
        expect(await signInWithEmailPassword(deps(client), "a@gmail.com", pw)).toMatchObject({
          ok: false,
          code: "wrong_credentials",
          message: "Email or password is wrong.",
        });
      }
      expect(calls.signIn).toEqual([]);
    });
  });

  describe("sign-up", () => {
    it("creates the account, the profile and the bonus; signing in later grants nothing more", async () => {
      const { client, calls } = fakeSupabase();
      const pw = `  ${"x".repeat(68)}  `; // 72 characters: spaces are part of a password
      const up = await signUpWithEmailPassword(deps(client), " Pat.Smith@Gmail.com ", pw);
      expect(up).toEqual({ ok: true });
      expect(calls.signUp).toEqual([{ email: "pat.smith@gmail.com", password: pw }]);

      const profile = await profileByEmail("pat.smith@gmail.com");
      expect(profile).toMatchObject({ displayName: "pat.smith" });
      const id = profile?.id as string;
      expect(await points(id)).toBe(10_000);

      const inAgain = await signInWithEmailPassword(deps(client), "pat.smith@gmail.com", pw);
      expect(inAgain).toEqual({ ok: true });
      expect(await signInWithEmailPassword(deps(client), "PAT.SMITH@gmail.com", pw)).toEqual({
        ok: true,
      });
      expect(await points(id)).toBe(10_000);
      expect(await bonusEntries(id)).toHaveLength(1);
      expect(calls.signOut).toBe(0);
    });

    it("says an existing account cannot be created, pointing to sign-in", async () => {
      const { client } = fakeSupabase();
      expect(await signUpWithEmailPassword(deps(client), "dup@gmail.com", PASSWORD)).toEqual({
        ok: true,
      });
      for (const c of [
        client,
        fakeSupabase({ signUpError: { status: 422, code: "email_exists" } }).client,
      ]) {
        const again = await signUpWithEmailPassword(deps(c), "dup@gmail.com", PASSWORD);
        expect(again).toMatchObject({ ok: false, code: "signup_failed" });
        expect(again.ok === false && again.message).toBe(
          "Could not create that account. If you already have one, sign in.",
        );
      }
    });

    it("explains that confirmation is off, and creates no profile, when sign-up returns no session", async () => {
      const { client } = fakeSupabase({ noSession: true });
      const result = await signUpWithEmailPassword(deps(client), "confirm@gmail.com", PASSWORD);
      expect(result).toMatchObject({ ok: false, code: "confirmation_required" });
      expect(result.ok === false && result.message).toBe(
        "Sign-up needs email confirmation, which is turned off for now. Ask the site owner.",
      );
      expect(await profileByEmail("confirm@gmail.com")).toBeUndefined();
    });

    it("treats a success response without a user as unavailable and creates nothing", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { client } = fakeSupabase({ noUser: true });
      expect(
        await signUpWithEmailPassword(deps(client), "nouser@gmail.com", PASSWORD),
      ).toMatchObject({ ok: false, code: "unavailable" });
      expect(await profileByEmail("nouser@gmail.com")).toBeUndefined();
      error.mockRestore();
    });

    it("maps rate limits, a weak password and unknown errors without leaking provider text", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const cases: [AuthApiError, string][] = [
        [{ status: 429, code: "over_request_rate_limit" }, "rate_limited"],
        [{ status: 422, code: "weak_password" }, "weak_password"],
        [{ status: 500 }, "unavailable"],
        [{ status: 422, code: "signup_disabled" }, "unavailable"],
      ];
      for (const [err, code] of cases) {
        const { client } = fakeSupabase({ signUpError: err });
        const result = await signUpWithEmailPassword(deps(client), "err@gmail.com", PASSWORD);
        expect(result).toMatchObject({ ok: false, code });
        expect(result.ok === false && result.message).not.toMatch(/status|422|429|500|supabase/i);
      }
      error.mockRestore();
    });

    it("signs out and says so when the profile belongs to a suspended member", async () => {
      const { client, calls, accounts } = fakeSupabase();
      // The Supabase account exists but the profile was suspended (e.g. after an earlier sign-up).
      const id = "40000000-0000-4000-8000-0000000000ff";
      const email = "sus@gmail.com";
      accounts.set(email, { id, password: PASSWORD });
      await db.insert(profiles).values({ id, email, displayName: "sus", suspendedAt: new Date() });
      const result = await signInWithEmailPassword(deps(client), email, PASSWORD);
      expect(result).toMatchObject({ ok: false, code: "suspended" });
      expect(calls.signOut).toBe(1);
      expect(await points(id)).toBeUndefined();
    });
  });

  describe("sign-in", () => {
    it("never tells a wrong password from an unknown account", async () => {
      const { client } = fakeSupabase();
      await signUpWithEmailPassword(deps(client), "known@gmail.com", PASSWORD);
      const wrong = await signInWithEmailPassword(
        deps(client),
        "known@gmail.com",
        "wrong password!",
      );
      const unknown = await signInWithEmailPassword(deps(client), "nobody@gmail.com", PASSWORD);
      const unconfirmed = await signInWithEmailPassword(
        deps(fakeSupabase({ signInError: { status: 400, code: "email_not_confirmed" } }).client),
        "known@gmail.com",
        PASSWORD,
      );
      for (const r of [wrong, unknown, unconfirmed]) {
        expect(r).toEqual({
          ok: false,
          code: "wrong_credentials",
          message: "Email or password is wrong.",
        });
      }
    });

    it("creates the profile and bonus on a first sign-in if sign-up did not finish it", async () => {
      const { client, accounts } = fakeSupabase();
      const id = "40000000-0000-4000-8000-0000000000aa";
      accounts.set("late@gmail.com", { id, password: PASSWORD });
      expect(await signInWithEmailPassword(deps(client), "late@gmail.com", PASSWORD)).toEqual({
        ok: true,
      });
      expect(await points(id)).toBe(10_000);
    });

    it("maps a rate limit and unknown errors to the generic copy", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const limited = fakeSupabase({
        signInError: { status: 429, code: "over_request_rate_limit" },
      });
      expect(
        await signInWithEmailPassword(deps(limited.client), "a@gmail.com", PASSWORD),
      ).toMatchObject({ ok: false, code: "rate_limited" });
      const broken = fakeSupabase({ signInError: { status: 500 } });
      expect(
        await signInWithEmailPassword(deps(broken.client), "a@gmail.com", PASSWORD),
      ).toMatchObject({ ok: false, code: "unavailable" });
      error.mockRestore();
    });
  });

  it("never logs the email address or the password", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "my secret passphrase";
    await signUpWithEmailPassword(
      deps(fakeSupabase({ signUpError: { status: 500 } }).client),
      "logme@gmail.com",
      secret,
    );
    await signInWithEmailPassword(
      deps(fakeSupabase({ signInError: { status: 400, code: "invalid_credentials" } }).client),
      "logme@gmail.com",
      secret,
    );
    const broken = {
      transaction: async () => {
        throw new Error("connection refused");
      },
    } as unknown as TestDb;
    await signUpWithEmailPassword(
      { ...deps(fakeSupabase().client), db: broken },
      "logme@gmail.com",
      secret,
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(error).toHaveBeenCalled();
    expect(logged).not.toContain("logme");
    expect(logged).not.toContain(secret);
    error.mockRestore();
  });
});
