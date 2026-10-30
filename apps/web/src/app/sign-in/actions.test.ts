import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANY_DOMAIN, DEFAULT_ALLOWED_DOMAINS } from "@/server/auth-email";
import { passwordAction, signInAction } from "./actions";
import { INITIAL_PASSWORD_FORM_STATE, INITIAL_SIGN_IN_STATE } from "./state";

// Server actions can be called directly whatever the page shows, so each refuses the other mode
// (ADR-0007). The flows themselves are tested in src/server/auth-flow.test.ts and
// auth-password.test.ts.

const calls = vi.hoisted(() => ({ otp: 0, signUp: [] as unknown[], signIn: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ open: false }));

const client = {
  signInWithOtp: async () => {
    calls.otp += 1;
    return { error: null };
  },
  verifyOtp: async () => ({ user: null, error: null }),
  signUp: async (args: unknown) => {
    calls.signUp.push(args);
    return { user: null, hasSession: false, error: { status: 500 } };
  },
  signInWithPassword: async (args: unknown) => {
    calls.signIn.push(args);
    return { user: null, error: { status: 400, code: "invalid_credentials" } };
  },
  signOut: async () => ({ error: null }),
};

vi.mock("@/server/auth", () => ({
  getAuthDeps: async () => ({
    client,
    db: {},
    domains: mocks.open ? ANY_DOMAIN : DEFAULT_ALLOWED_DOMAINS,
    bonusPoints: 100,
    open: mocks.open,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirected");
  },
}));

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

beforeEach(() => {
  calls.otp = 0;
  calls.signUp = [];
  calls.signIn = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signInAction (code)", () => {
  it("refuses in open mode without sending a code", async () => {
    mocks.open = true;
    const state = await signInAction(
      INITIAL_SIGN_IN_STATE,
      form({ intent: "send", email: "a@gmail.com" }),
    );
    expect(state).toMatchObject({ step: "email", email: "a@gmail.com" });
    expect(state.error).toMatch(/turned off/);
    expect(calls.otp).toBe(0);
  });

  it("sends a code in college mode as before", async () => {
    mocks.open = false;
    const state = await signInAction(
      INITIAL_SIGN_IN_STATE,
      form({ intent: "send", email: "a@maryvillecollege.edu" }),
    );
    expect(state).toMatchObject({ step: "code", email: "a@maryvillecollege.edu" });
    expect(calls.otp).toBe(1);
  });
});

describe("passwordAction", () => {
  it("refuses in college mode without calling Supabase", async () => {
    mocks.open = false;
    for (const intent of ["sign-up", "sign-in"]) {
      const state = await passwordAction(
        INITIAL_PASSWORD_FORM_STATE,
        form({ intent, email: "a@maryvillecollege.edu", password: "long enough pw" }),
      );
      expect(state.error).toMatch(/not available/);
    }
    expect(calls.signUp).toEqual([]);
    expect(calls.signIn).toEqual([]);
  });

  it("routes by intent in open mode and never returns the password", async () => {
    mocks.open = true;
    const password = "long enough pw";
    const up = await passwordAction(
      INITIAL_PASSWORD_FORM_STATE,
      form({ intent: "sign-up", email: "a@gmail.com", password }),
    );
    expect(calls.signUp).toEqual([{ email: "a@gmail.com", password }]);
    const inn = await passwordAction(
      INITIAL_PASSWORD_FORM_STATE,
      form({ intent: "sign-in", email: "a@gmail.com", password }),
    );
    expect(calls.signIn).toEqual([{ email: "a@gmail.com", password }]);
    expect(inn).toEqual({ email: "a@gmail.com", error: "Email or password is wrong." });
    expect(JSON.stringify([up, inn])).not.toContain(password);
  });
});
