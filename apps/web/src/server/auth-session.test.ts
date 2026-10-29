import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, getSessionMember } from "./auth";
import type { SessionMember } from "./auth-flow";

// The request-bound wrappers in auth.ts: getSessionMember keeps a suspended member (so the trade
// action can answer account_suspended), getCurrentUser still treats one as signed out.

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  configured: true,
  claims: { sub: "s", email: "e" } as unknown,
  session: null as unknown,
  throws: false,
  /** What getDbChecked does: pass the connection on, refuse it (role guard), or throw. */
  check: "pass" as "pass" | "refused" | "throws",
}));
vi.mock("@/db", () => ({
  getDb: () => mocks.db,
  getDbChecked: async () => {
    if (mocks.check === "throws") throw new Error("connect timeout postgres://secret@host");
    return mocks.check === "refused" ? undefined : mocks.db;
  },
}));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => (mocks.configured ? { url: "u", key: "k" } : undefined),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () => {
        if (mocks.throws) throw new Error("boom");
        return { data: { claims: mocks.claims } };
      },
    },
  }),
}));
vi.mock("./auth-flow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth-flow")>()),
  sessionMemberForClaims: vi.fn(async (_db: unknown, claims: unknown) =>
    claims === mocks.claims ? mocks.session : null,
  ),
}));

const PROFILE = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "jane@my.maryvillecollege.edu",
  displayName: "jane",
  role: "member" as const,
  points: 100,
};
const session = (suspended: boolean): SessionMember => ({
  userId: PROFILE.id,
  profile: PROFILE,
  suspended,
});

beforeEach(() => {
  mocks.db = { fake: true };
  mocks.configured = true;
  mocks.session = null;
  mocks.throws = false;
  mocks.check = "pass";
});

describe("getSessionMember and getCurrentUser", () => {
  it("both return the member for an active session", async () => {
    mocks.session = session(false);
    expect(await getSessionMember()).toEqual(session(false));
    expect(await getCurrentUser()).toEqual(PROFILE);
  });

  it("getSessionMember keeps a suspended member; getCurrentUser returns null", async () => {
    mocks.session = session(true);
    expect(await getSessionMember()).toEqual(session(true));
    expect(await getCurrentUser()).toBeNull();
  });

  it("both return null when the session is refused (signed out, no profile, email not allowed)", async () => {
    mocks.session = null;
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("both return null when unconfigured", async () => {
    mocks.session = session(false);
    mocks.db = undefined;
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    mocks.db = { fake: true };
    mocks.configured = false;
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("both return null, without throwing, when the lookup fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.session = session(false);
    mocks.throws = true;
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    spy.mockRestore();
  });

  it("both return null when the production role guard refuses the connection", async () => {
    mocks.session = session(false);
    mocks.check = "refused";
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it("both return null, without throwing, when the connection check fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.session = session(false);
    mocks.check = "throws";
    expect(await getSessionMember()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
    spy.mockRestore();
  });
});
