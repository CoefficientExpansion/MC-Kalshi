import "server-only";
import type { AnyDb } from "@/db/types";
import { isAllowedEmail, normalizeEmail } from "./auth-email";
import { ensureProfile, loadProfileMember, type Member, ProfileError } from "./profiles";

// The sign-in steps, free of Next.js and of the Supabase SDK so they run against fakes in tests.
// `auth.ts` wires them to the real client, cookies and database.
//
// Order of defence (CLAUDE.md hard constraint 2): the guard is the Postgres hook in Supabase Auth;
// the checks here are the second layer and give a readable message instead of a raw API error.

/** The slice of Supabase's auth API this flow uses (see `adaptSupabaseAuth` in `auth.ts`). */
export interface OtpClient {
  signInWithOtp(args: {
    email: string;
    options: { shouldCreateUser: boolean };
  }): Promise<{ error: AuthApiError | null }>;
  verifyOtp(args: { email: string; token: string; type: "email" }): Promise<{
    user: { id: string; email?: string | null } | null;
    error: AuthApiError | null;
  }>;
  signOut(scope?: "local"): Promise<{ error: AuthApiError | null }>;
}

export interface AuthApiError {
  readonly status?: number;
  readonly code?: string;
}

export interface AuthDeps {
  /** `undefined` when the Supabase env vars are not set. */
  readonly client: OtpClient | undefined;
  /** `undefined` when `DATABASE_URL` is not set. */
  readonly db: AnyDb | undefined;
  readonly domains: readonly string[];
  readonly bonusPoints: number;
}

export type AuthErrorCode =
  | "not_configured"
  | "invalid_email"
  | "not_allowed"
  | "invalid_code"
  | "rate_limited"
  | "send_failed"
  | "suspended"
  | "account_conflict"
  | "unavailable";

export type AuthFailure = {
  readonly ok: false;
  readonly code: AuthErrorCode;
  readonly message: string;
};

// What people read. Plain, short, no jargon, never the provider's raw error text.
const MESSAGES: Record<AuthErrorCode, string> = {
  not_configured: "Sign-in is not set up on this server yet.",
  invalid_email: "Enter your Maryville College email address.",
  not_allowed:
    "Use your Maryville College email (it ends in @maryvillecollege.edu or @my.maryvillecollege.edu).",
  invalid_code: "That code did not work. Check the 6 digits, or send a new code.",
  rate_limited: "Too many tries. Wait a minute, then try again.",
  send_failed: "We could not send a code. Try again in a minute.",
  suspended: "This account is suspended. Ask a moderator for help.",
  account_conflict:
    "This email is already linked to a different account. Ask a moderator for help.",
  unavailable: "Something went wrong on our side. Try again in a minute.",
};

const fail = (code: AuthErrorCode): AuthFailure => ({ ok: false, code, message: MESSAGES[code] });

const isRateLimit = (e: AuthApiError) =>
  e.status === 429 || (e.code?.startsWith("over_") && e.code.endsWith("_rate_limit")) === true;

/** Log the kind of failure only: never an email address or a code (SOP-09). */
function logFailure(where: string, e: AuthApiError | Error) {
  const detail = e instanceof Error ? e.name : `status=${e.status ?? "?"} code=${e.code ?? "?"}`;
  console.error(`[auth] ${where} failed: ${detail}`);
}

/**
 * Step 1: email a one-time code. `shouldCreateUser` stays true because first sign-in creates the
 * account; the Supabase hook (not this check) is what stops other domains from being created.
 */
export async function requestEmailCode(
  deps: AuthDeps,
  rawEmail: unknown,
): Promise<{ readonly ok: true; readonly email: string } | AuthFailure> {
  if (!deps.client) {
    return fail("not_configured");
  }
  if (typeof rawEmail !== "string" || rawEmail.trim() === "") {
    return fail("invalid_email");
  }
  if (!isAllowedEmail(rawEmail, deps.domains)) {
    return fail("not_allowed");
  }
  const email = normalizeEmail(rawEmail);
  // TODO(M5): our own per-email and per-IP rate limit; until then Supabase's built-in OTP limit applies.
  const { error } = await deps.client.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    logFailure("send code", error);
    if (isRateLimit(error)) {
      return fail("rate_limited");
    }
    // The Before User Created hook answers a disallowed address with HTTP 403.
    return fail(error.status === 403 ? "not_allowed" : "send_failed");
  }
  return { ok: true, email };
}

/**
 * Step 2: check the code, then create the profile and signup bonus (idempotent). The session
 * cookie exists once `verifyOtp` succeeds, so every refusal after that signs the session out.
 */
export async function verifyEmailCode(
  deps: AuthDeps,
  rawEmail: unknown,
  rawCode: unknown,
): Promise<{ readonly ok: true } | AuthFailure> {
  const { client, db } = deps;
  if (!client || !db) {
    return fail("not_configured");
  }
  if (typeof rawEmail !== "string" || rawEmail.trim() === "") {
    return fail("invalid_email");
  }
  if (!isAllowedEmail(rawEmail, deps.domains)) {
    return fail("not_allowed");
  }
  const token = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : "";
  if (!/^[0-9]{6}$/.test(token)) {
    return fail("invalid_code");
  }

  const { user, error } = await client.verifyOtp({
    email: normalizeEmail(rawEmail),
    token,
    type: "email",
  });
  if (error) {
    logFailure("verify code", error);
    return fail(isRateLimit(error) ? "rate_limited" : "invalid_code");
  }
  if (!user) {
    return fail("invalid_code");
  }

  const refuse = async (code: AuthErrorCode): Promise<AuthFailure> => {
    await signOutOf(client);
    return fail(code);
  };

  // Trust the address Supabase attached to the verified account, not the form field.
  if (!isAllowedEmail(user.email, deps.domains)) {
    return refuse("not_allowed");
  }
  try {
    const { profile } = await ensureProfile(
      db,
      { id: user.id, email: user.email as string },
      deps.bonusPoints,
    );
    if (profile.suspendedAt) {
      return refuse("suspended");
    }
  } catch (e) {
    if (e instanceof ProfileError) {
      return refuse("account_conflict");
    }
    logFailure("create profile", e instanceof Error ? e : { code: "unknown" });
    return refuse("unavailable");
  }
  return { ok: true };
}

/** End this browser's session only (not the member's other devices). Never throws. */
export async function signOutOf(client: OtpClient | undefined): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.signOut("local");
  } catch (e) {
    logFailure("sign out", e instanceof Error ? e : { code: "unknown" });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A verified, allowed session and its profile, suspended or not. */
export interface SessionMember {
  readonly userId: string;
  readonly profile: Member;
  /** The profile is suspended: it may not trade, and `memberForClaims` treats it as signed out. */
  readonly suspended: boolean;
}

/**
 * The profile a verified session belongs to, or `null`. Runs on every request, so a session that
 * outlives its sign-in checks stops working: the email in the token must still be an allowed
 * address (a member can change it through Supabase's `updateUser`, which the sign-up hook does
 * not see) and must still be the one on the profile. A suspended profile is returned with
 * `suspended: true`. Never throws on bad claims; logs no address.
 */
export async function sessionMemberForClaims(
  db: AnyDb,
  claims: { readonly sub?: unknown; readonly email?: unknown } | undefined,
  domains: readonly string[],
): Promise<SessionMember | null> {
  const sub = claims?.sub;
  if (typeof sub !== "string" || !UUID.test(sub)) {
    return null;
  }
  const email = claims?.email;
  if (typeof email !== "string" || !isAllowedEmail(email, domains)) {
    console.error("[auth] session refused: email claim is missing or not allowed");
    return null;
  }
  const found = await loadProfileMember(db, sub);
  if (!found) {
    return null;
  }
  if (normalizeEmail(email) !== normalizeEmail(found.member.email)) {
    console.error("[auth] session refused: email claim differs from the profile");
    return null;
  }
  return { userId: found.member.id, profile: found.member, suspended: found.suspended };
}

/**
 * The member a verified session belongs to, or `null`: {@link sessionMemberForClaims}, with a
 * suspended member treated as signed out.
 */
export async function memberForClaims(
  db: AnyDb,
  claims: { readonly sub?: unknown; readonly email?: unknown } | undefined,
  domains: readonly string[],
): Promise<Member | null> {
  const session = await sessionMemberForClaims(db, claims, domains);
  return session && !session.suspended ? session.profile : null;
}
