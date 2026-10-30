import "server-only";
import { ANY_DOMAIN, type DomainPolicy, getAllowedDomains } from "./auth-email";

// Which sign-in the server offers (ADR-0007, docs/specs/open-signup.md). Pure parsing; the
// environment is read only by the `get*` helpers, on the server (never a NEXT_PUBLIC_ variable).
//
//   college  the emailed 6-digit code, college addresses only (hard constraint 2). The default.
//   open     email and password, any address, no email sent. Temporary; production only by choice.

export type SignInMode = "college" | "open";

/** Exactly `open` (surrounding spaces ignored) is open; unset, blank or anything else is college. */
export function parseSignInMode(raw: string | undefined): SignInMode {
  return raw?.trim() === "open" ? "open" : "college";
}

/** `SIGN_IN_MODE` from the environment. Fails closed to college mode. */
export function getSignInMode(env: Record<string, string | undefined> = process.env): SignInMode {
  return parseSignInMode(env.SIGN_IN_MODE);
}

/**
 * The domain policy every sign-in and session check uses: {@link ANY_DOMAIN} in open mode, else
 * the college allowlist (`ALLOWED_EMAIL_DOMAINS`, defaulting to the two college domains).
 */
export function getEmailDomainPolicy(
  env: Record<string, string | undefined> = process.env,
): DomainPolicy {
  return getSignInMode(env) === "open" ? ANY_DOMAIN : getAllowedDomains(env);
}
