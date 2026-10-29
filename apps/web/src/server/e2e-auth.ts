import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// CI-only sign-in for the Playwright suite (docs/specs/m3-trading.md, "Playwright e2e", the
// fallback; Execution plan assumption 3). CI has no Supabase project, so `POST /api/test/session`
// mints an HMAC-signed `e2e-session` cookie that `getSessionMember` accepts. Everything is gated
// by `isE2EAuthEnabled()`: the flag AND a long secret AND not on Vercel. `NODE_ENV` cannot be the
// gate because `next start` forces `production`; Vercel always sets `VERCEL`, so the bypass is
// off on production and previews even if the flag leaks there. Only `auth.ts` and that route
// import this module.

export const E2E_SESSION_COOKIE = "e2e-session";
/** One hour: long enough for the suite, short enough that a stray cookie dies quickly. */
export const E2E_SESSION_MAX_AGE_SEC = 60 * 60;
const MIN_SECRET_LENGTH = 32;
const VERSION = "v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_BYTES = 32;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * True only when `E2E_AUTH_BYPASS` is exactly "1", `E2E_AUTH_SECRET` has at least 32 characters
 * (not counting surrounding spaces)
 * and `VERCEL` is unset (an empty `VERCEL` counts as set). CI only; never set either on Vercel.
 */
export function isE2EAuthEnabled(env: Env = process.env): boolean {
  return (
    env.E2E_AUTH_BYPASS === "1" &&
    (env.E2E_AUTH_SECRET?.trim().length ?? 0) >= MIN_SECRET_LENGTH &&
    env.VERCEL === undefined
  );
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload, "utf8").digest();
}

/** `v1.<userId>.<expiry seconds>.<base64url HMAC-SHA256 of the first three parts>`. */
export function signE2ESession(userId: string, expiresAtMs: number, secret: string): string {
  if (!UUID.test(userId)) throw new Error("e2e session: user id must be a uuid");
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("e2e session: secret too short");
  const payload = `${VERSION}.${userId.toLowerCase()}.${Math.floor(expiresAtMs / 1000)}`;
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

/** The user id of a correctly signed, unexpired value, else null. Never throws. */
export function verifyE2ESession(value: string, secret: string, nowMs: number): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, exp, sig] = parts as [string, string, string, string];
  if (version !== VERSION || !UUID.test(userId) || !/^\d{1,12}$/.test(exp)) return null;
  const given = Buffer.from(sig, "base64url");
  if (given.length !== SIGNATURE_BYTES) return null;
  const expected = sign(`${version}.${userId}.${exp}`, secret);
  if (!timingSafeEqual(given, expected)) return null;
  // Base64url decoding ignores stray characters; insist on the canonical text too.
  if (given.toString("base64url") !== sig) return null;
  return Number(exp) * 1000 > nowMs ? userId : null;
}

/**
 * The user id carried by an `e2e-session` cookie value, or null. Null without looking at the value
 * whenever the guard is off, so the cookie means nothing outside CI.
 */
export function readE2ESession(
  value: string | undefined,
  env: Env = process.env,
  nowMs: number = Date.now(),
): string | null {
  if (!isE2EAuthEnabled(env) || value === undefined) return null;
  return verifyE2ESession(value, env.E2E_AUTH_SECRET as string, nowMs);
}
