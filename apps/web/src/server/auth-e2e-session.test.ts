import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, getSessionMember } from "./auth";
import { E2E_SESSION_COOKIE, signE2ESession } from "./e2e-auth";

// getSessionMember/getCurrentUser and the CI-only `e2e-session` cookie: accepted only when
// isE2EAuthEnabled() is true and the signature and expiry check out; otherwise ignored completely
// (not even read), so the normal Supabase path decides.

const SECRET = "x".repeat(40);
const USER = "00000000-0000-4000-8000-0000000000e2";
const PROFILE = {
  id: USER,
  email: "e2e@my.maryvillecollege.edu",
  displayName: "e2e",
  role: "member" as const,
  points: 10_000,
};

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  cookiesCalls: 0,
  supabaseConfigured: false,
  found: null as unknown,
  claimsSession: null as unknown,
}));
vi.mock("next/headers", () => ({
  cookies: async () => {
    mocks.cookiesCalls += 1;
    return {
      get: (name: string) =>
        name === "e2e-session" && mocks.cookie !== undefined
          ? { name, value: mocks.cookie }
          : undefined,
      getAll: () => [],
    };
  },
}));
vi.mock("@/db", () => ({ getDb: () => ({ fake: true }) }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => (mocks.supabaseConfigured ? { url: "u", key: "k" } : undefined),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: "claims" } } }) },
  }),
}));
vi.mock("./auth-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-flow")>()),
  sessionMemberForClaims: vi.fn(async () => mocks.claimsSession),
}));
vi.mock("./profiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./profiles")>()),
  loadProfileMember: vi.fn(async (_db: unknown, id: string) => (id === USER ? mocks.found : null)),
}));

const validCookie = () => signE2ESession(USER, Date.now() + 60_000, SECRET);

function enableBypass() {
  vi.stubEnv("E2E_AUTH_BYPASS", "1");
  vi.stubEnv("E2E_AUTH_SECRET", SECRET);
  vi.stubEnv("VERCEL", undefined);
}

beforeEach(() => {
  mocks.cookie = undefined;
  mocks.cookiesCalls = 0;
  mocks.supabaseConfigured = false;
  mocks.found = { member: PROFILE, suspended: false };
  mocks.claimsSession = null;
  vi.stubEnv("E2E_AUTH_BYPASS", undefined);
  vi.stubEnv("E2E_AUTH_SECRET", undefined);
  vi.stubEnv("VERCEL", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("e2e-session cookie with the guard on", () => {
  beforeEach(enableBypass);

  it("uses the cookie name the mock serves", () => {
    expect(E2E_SESSION_COOKIE).toBe("e2e-session");
  });

  it("signs the member in, even without Supabase configured", async () => {
    mocks.cookie = validCookie();
    expect(await getSessionMember()).toEqual({ userId: USER, profile: PROFILE, suspended: false });
    expect(await getCurrentUser()).toEqual(PROFILE);
  });

  it("keeps a suspended member for getSessionMember only", async () => {
    mocks.cookie = validCookie();
    mocks.found = { member: PROFILE, suspended: true };
    expect(await getSessionMember()).toEqual({ userId: USER, profile: PROFILE, suspended: true });
    expect(await getCurrentUser()).toBeNull();
  });

  it("refuses an unknown profile or one whose email is no longer allowed", async () => {
    mocks.cookie = validCookie();
    mocks.found = null;
    expect(await getSessionMember()).toBeNull();
    mocks.found = { member: { ...PROFILE, email: "e2e@gmail.com" }, suspended: false };
    expect(await getSessionMember()).toBeNull();
  });

  it("ignores an expired cookie, one signed with another secret, and garbage", async () => {
    for (const value of [
      signE2ESession(USER, Date.now() - 1000, SECRET),
      signE2ESession(USER, Date.now() + 60_000, "y".repeat(40)),
      "garbage",
    ]) {
      mocks.cookie = value;
      expect(await getSessionMember()).toBeNull();
      expect(await getCurrentUser()).toBeNull();
    }
  });

  it("falls back to the Supabase session when there is no valid cookie", async () => {
    mocks.supabaseConfigured = true;
    mocks.claimsSession = { userId: "claims", profile: PROFILE, suspended: false };
    mocks.cookie = "garbage";
    expect(await getSessionMember()).toEqual(mocks.claimsSession);
  });
});

describe("e2e-session cookie with the guard off", () => {
  it("is ignored, and cookies are not read for it, when the variables are unset", async () => {
    mocks.cookie = validCookie();
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.cookiesCalls).toBe(0);
  });

  it("is ignored on Vercel even with the flag and secret set", async () => {
    enableBypass();
    vi.stubEnv("VERCEL", "1");
    mocks.cookie = validCookie();
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    expect(mocks.cookiesCalls).toBe(0);
  });

  it("is ignored with only one of the two variables set", async () => {
    mocks.cookie = validCookie();
    vi.stubEnv("E2E_AUTH_SECRET", SECRET);
    expect(await getSessionMember()).toBeNull();
    vi.stubEnv("E2E_AUTH_SECRET", undefined);
    vi.stubEnv("E2E_AUTH_BYPASS", "1");
    expect(await getSessionMember()).toBeNull();
  });

  it("leaves the Supabase session in charge", async () => {
    vi.stubEnv("VERCEL", "1");
    mocks.supabaseConfigured = true;
    mocks.cookie = validCookie();
    mocks.claimsSession = null;
    expect(await getSessionMember()).toBeNull();
    mocks.claimsSession = { userId: "claims", profile: PROFILE, suspended: false };
    expect(await getSessionMember()).toEqual(mocks.claimsSession);
  });
});
