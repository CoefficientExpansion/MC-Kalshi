// The sign-in domain rule (CLAUDE.md hard constraint 2). Pure: no I/O, no framework imports.
//
// This is the application-side check. The guard is the Postgres hook
// `public.hook_before_user_created` (drizzle/0002_auth_signup_hook.sql), which runs inside
// Supabase Auth; keep the two in step (`auth-email-cases.ts` is tested against both).

export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = [
  "maryvillecollege.edu",
  "my.maryvillecollege.edu",
];

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

// A deliberately narrow local part: ASCII letters, digits and `._+-'`, with no leading, trailing
// or doubled dot. No quotes, spaces, `@`, `%` or `!`, so there is no quoted-string or source-route
// syntax to hide a second address in. College usernames fit comfortably.
const LOCAL_PART = /^[a-z0-9_+'-]+(?:\.[a-z0-9_+'-]+)*$/;

// A plain host name: lower-case ASCII labels of letters, digits and inner hyphens, at least two
// labels. No `xn--` check is needed because the domain must equal an allowlist entry exactly.
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Parse `ALLOWED_EMAIL_DOMAINS` (comma separated). Unset or blank means the default pair.
 * Entries that are not plain host names are dropped, and if nothing valid is left the result is
 * empty, which allows nobody (fail closed) rather than falling back to something wider.
 */
export function parseAllowedDomains(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_ALLOWED_DOMAINS;
  }
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => HOST_NAME.test(d));
}

/** The allowlist from the environment (`ALLOWED_EMAIL_DOMAINS`), defaulting to the two college domains. */
export function getAllowedDomains(
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  return parseAllowedDomains(env.ALLOWED_EMAIL_DOMAINS);
}

/** Trim and lower-case an address for storage and comparison. Does not validate. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True only for `local@domain` where `domain` is exactly one of the allowed domains. Case and
 * surrounding whitespace are ignored. Anything non-ASCII is refused before it is lower-cased, so
 * lookalikes (Cyrillic `а`, the Kelvin sign, fullwidth `@`) cannot fold into an allowed address.
 * Never throws; non-strings are not allowed.
 */
export function isAllowedEmail(
  email: unknown,
  domains: readonly string[] = getAllowedDomains(),
): boolean {
  if (typeof email !== "string") {
    return false;
  }
  const trimmed = email.trim();
  // Only printable ASCII from here on (also refuses NUL, newlines, tabs inside the address).
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_EMAIL_LENGTH ||
    !/^[\x21-\x7e]+$/.test(trimmed)
  ) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0 || at !== normalized.lastIndexOf("@")) {
    return false;
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length > MAX_LOCAL_LENGTH || !LOCAL_PART.test(local)) {
    return false;
  }
  return domains.includes(domain);
}
