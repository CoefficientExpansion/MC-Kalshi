import "server-only";
import { isAllowedEmail, normalizeEmail } from "./auth-email";
import {
  type AuthApiError,
  type AuthDeps,
  type AuthFailure,
  completeSignIn,
  fail,
  isRateLimit,
  logFailure,
  type SignOutClient,
} from "./auth-flow";

// Open-mode sign-up and sign-in with email and password (ADR-0007, docs/specs/open-signup.md).
// Free of Next.js and the Supabase SDK, like `auth-flow.ts`; `auth.ts` wires the real client.
// After Supabase returns a session, `completeSignIn` (shared with the code flow) creates the
// profile and grants the signup bonus once through the ledger. Never logs an email or a password.

/** The slice of Supabase's password auth this flow uses (see `adaptSupabaseAuth` in `auth.ts`). */
export interface PasswordClient extends SignOutClient {
  signUp(args: { email: string; password: string }): Promise<{
    user: { id: string; email?: string | null } | null;
    /** False when Supabase still requires email confirmation (no session cookie was set). */
    hasSession: boolean;
    error: AuthApiError | null;
  }>;
  signInWithPassword(args: { email: string; password: string }): Promise<{
    user: { id: string; email?: string | null } | null;
    error: AuthApiError | null;
  }>;
}

export interface PasswordAuthDeps extends AuthDeps<PasswordClient> {
  /** True only when `SIGN_IN_MODE=open`; otherwise both actions refuse. */
  readonly open: boolean;
}

type Result = { readonly ok: true } | AuthFailure;

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt, which Supabase Auth uses, reads at most 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

/** 10 to 72 characters and at most 72 UTF-8 bytes. Spaces count; nothing is trimmed. */
function passwordInRange(raw: unknown): raw is string {
  if (typeof raw !== "string") {
    return false;
  }
  const chars = Array.from(raw).length;
  return (
    chars >= MIN_PASSWORD_LENGTH &&
    chars <= MAX_PASSWORD_LENGTH &&
    new TextEncoder().encode(raw).length <= MAX_PASSWORD_LENGTH
  );
}

/** The checks both actions share; returns the ready deps and normalised email, or a failure. */
function precheck(
  deps: PasswordAuthDeps,
  rawEmail: unknown,
): { readonly ok: true; readonly client: PasswordClient; readonly email: string } | AuthFailure {
  if (!deps.open) {
    return fail("password_off");
  }
  if (!deps.client || !deps.db) {
    return fail("not_configured");
  }
  if (typeof rawEmail !== "string" || !isAllowedEmail(rawEmail, deps.domains)) {
    return fail("email_format");
  }
  return { ok: true, client: deps.client, email: normalizeEmail(rawEmail) };
}

/** A session exists: the post-sign-in step shared with the code flow. */
function finish(
  deps: PasswordAuthDeps,
  client: PasswordClient,
  user: { readonly id: string; readonly email?: string | null },
): Promise<Result> {
  const { db, domains, bonusPoints } = deps;
  if (!db) {
    return Promise.resolve(fail("not_configured")); // `precheck` already refused this
  }
  return completeSignIn({ client, db, domains, bonusPoints }, user);
}

/** Create an account. With Confirm email off, Supabase signs the new member straight in. */
export async function signUpWithEmailPassword(
  deps: PasswordAuthDeps,
  rawEmail: unknown,
  rawPassword: unknown,
): Promise<Result> {
  const checked = precheck(deps, rawEmail);
  if (!checked.ok) {
    return checked;
  }
  if (!passwordInRange(rawPassword)) {
    return fail("password_length");
  }
  const { client, email } = checked;
  // TODO(M5): our own per-IP rate limit; until then Supabase's sign-up limit applies.
  const { user, hasSession, error } = await client.signUp({ email, password: rawPassword });
  if (error) {
    logFailure("sign up", error);
    if (isRateLimit(error)) {
      return fail("rate_limited");
    }
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return fail("signup_failed");
    }
    if (error.code === "weak_password") {
      return fail("weak_password");
    }
    return fail("unavailable");
  }
  if (!user) {
    logFailure("sign up", { code: "no_user" });
    return fail("unavailable");
  }
  if (!hasSession) {
    // Confirm email is still on in Supabase: there is no session, so create nothing.
    return fail("confirmation_required");
  }
  return finish(deps, client, user);
}

/**
 * Sign in to an existing account. A wrong password, an unknown account, an unconfirmed one and an
 * out-of-range password all get the same answer, so the form cannot be used to probe accounts.
 */
export async function signInWithEmailPassword(
  deps: PasswordAuthDeps,
  rawEmail: unknown,
  rawPassword: unknown,
): Promise<Result> {
  const checked = precheck(deps, rawEmail);
  if (!checked.ok) {
    return checked;
  }
  if (!passwordInRange(rawPassword)) {
    return fail("wrong_credentials");
  }
  const { client, email } = checked;
  const { user, error } = await client.signInWithPassword({ email, password: rawPassword });
  if (error) {
    logFailure("password sign-in", error);
    if (isRateLimit(error)) {
      return fail("rate_limited");
    }
    const clientError = error.status !== undefined && error.status >= 400 && error.status < 500;
    return fail(clientError ? "wrong_credentials" : "unavailable");
  }
  if (!user) {
    return fail("wrong_credentials");
  }
  return finish(deps, client, user);
}
