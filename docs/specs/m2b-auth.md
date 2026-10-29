# M2b-auth — Sign-in with a Maryville College email
Status: in-progress · Milestone: M2 (part b, auth) · ADRs: 0001, 0003
Integrated onto the M1 engine (main c311323) on 2026-10-29; see docs/specs/m1-engine.md, Ship decision.

## Problem
Nobody can use the app until they can sign in, and hard constraint 2 says only
`@maryvillecollege.edu` and `@my.maryvillecollege.edu` addresses may. The restriction must hold
at the auth layer (a request that skips our UI still fails), and a new member needs a `profiles`
row and the one-time signup bonus without ever being able to claim it twice. There are no
Supabase credentials in the build environment, so everything below the live service is built
and proven offline; the app must build and run with every Supabase variable unset.

## Scope
In (`apps/web`):
- `isAllowedEmail(email, domains?)` (`src/server/auth-email.ts`): pure; trims, case-insensitive,
  exact match on the allowed domains only. Rejects subdomain tricks, quoted local parts, more
  than one `@`, non-ASCII input (unicode lookalikes) and control characters. The allowlist comes
  from `ALLOWED_EMAIL_DOMAINS` (comma separated), default
  `maryvillecollege.edu,my.maryvillecollege.edu`.
- Auth-layer enforcement: a custom drizzle migration creating
  `public.hook_before_user_created(event jsonb) returns jsonb` (Supabase "Before User Created"
  hook, Postgres variant) that returns `{}` for an allowed address and
  `{"error": {"http_code": 403, "message": …}}` otherwise, plus the grants Supabase requires
  (execute and schema usage to `supabase_auth_admin`; execute revoked from `public`, `anon`,
  `authenticated`). Role-specific statements are guarded by `pg_roles` so the same migration
  applies to PGlite, where those roles do not exist. The owner enables the hook in the
  dashboard (see "Owner steps").
- Defense in depth, not the guard: the server action re-checks the address before calling
  Supabase, and the verify step re-checks the address Supabase reports for the session.
- Sign-in page `/sign-in`: email field, "Send code", then a 6-digit code field and "Verify";
  server actions; friendly errors; theme-compliant; "not configured" notice when Supabase env
  vars are absent.
- First sign-in: `ensureProfile` inserts the `profiles` row (id = Supabase user id, email,
  display name from the email local part) and calls `grantSignupBonus` with
  `SIGNUP_BONUS_POINTS` (default 10000) in one transaction. Repeat sign-ins change nothing. A
  profile with `suspended_at` set is refused and signed out.
- `getCurrentUser()` (`src/server/auth.ts`): the verified session (`getClaims()`) joined to the
  profile and balance, or `null`.
- `POST /auth/sign-out` route; `AccountControl` server component
  (`src/components/account-control.tsx`) for the header slot.
- `src/proxy.ts` (Next.js 16 name for middleware) refreshes the session cookie.
- Dependencies: `@supabase/supabase-js` and `@supabase/ssr`, exact-pinned. `.env.example`
  documents the variables.

Out: rate limiting (M5; Supabase's built-in OTP limit applies until then), profile editing and
leaderboard opt-out (M5), roles and admin screens (M4), SSO (architecture §11 question 2),
a magic-link or OAuth callback (the code flow needs none), custom SMTP (SOP-07, before beta).

## Acceptance criteria
- [x] `isAllowedEmail` accepts `a@maryvillecollege.edu` and `a@my.maryvillecollege.edu` in any case with surrounding whitespace (test). (`auth-email.test.ts` > accepts the two college domains; ignores case and surrounding whitespace; property: accepts any plain local part at an allowed domain, in any case, padded with whitespace)
- [x] It rejects other domains, subdomain tricks (`x@evil.maryvillecollege.edu.attacker.com`, `x@maryvillecollege.edu.evil`, `x@evil-maryvillecollege.edu`, `x@sub.my.maryvillecollege.edu`), quoted local parts containing `@`, multiple `@`, unicode lookalikes and empty or non-string input (test, plus fast-check properties). (`auth-email.test.ts` > rejects %s (41 cases); rejects anything that is not a string; properties: rejects an allowed domain with anything stuck on the end / a label stuck on the front; never throws, and anything it accepts has exactly one @ and an allowed domain; rejects every address containing a non-ASCII character)
- [x] The allowlist is read from `ALLOWED_EMAIL_DOMAINS`, defaults when unset or blank, and fails closed when set to nothing valid (test). (`auth-email.test.ts` > parseAllowedDomains)
- [x] The migration applies to a fresh PGlite database and `hook_before_user_created` returns `{}` for allowed addresses and the Supabase error object (`http_code` 403 and a `message`) for everything `isAllowedEmail` rejects, including a missing email (test). The SQL and TypeScript rules agree on a shared case table. (`auth-hook.test.ts` > allows both college domains with an empty object; rejects other domains with Supabase's error object; rejects an event with no email, a null email, a non-string email, or no user; agrees with isAllowedEmail on every case in the shared table)
- [x] The grants are in the migration: with `supabase_auth_admin`, `anon` and `authenticated` roles present, re-running the guarded statements leaves only `supabase_auth_admin` able to execute the function (test); without those roles the migration still applies (the base fresh-database test). (`auth-hook.test.ts` > hook_before_user_created grants > applies without Supabase's roles (PGlite has none) and leaves PUBLIC without execute; with Supabase's roles present, only supabase_auth_admin may execute)
- [x] `ensureProfile` creates the profile and credits the bonus once; a second call is a no-op; `checkLedgerInvariants` is clean (test). (`profiles.test.ts` > ensureProfile > creates the profile and credits the bonus on first sign-in; changes nothing on a repeat sign-in; keeps the ledger consistent)
- [x] `ensureProfile` is atomic: a failing bonus leaves no profile (test). A different user id with an existing email is refused (test). (`profiles.test.ts` > is atomic: if the bonus fails, no profile is left behind; refuses a different user id for an email that already has a profile)
- [x] A suspended profile is refused, gets no bonus, and is signed out (test). (`profiles.test.ts` > returns a suspended profile as it is and grants nothing; `auth-flow.test.ts` > signs out a suspended member and says so)
- [x] `requestEmailCode` refuses a disallowed address without calling Supabase, and reports "not configured" when Supabase is absent (test). (`auth-flow.test.ts` > requestEmailCode)
- [x] `verifyEmailCode` validates the code format, creates the profile and bonus on first success, signs out and refuses a suspended or disallowed account, and maps Supabase errors to friendly messages (test, fake Supabase client). (`auth-flow.test.ts` > verifyEmailCode: rejects a disallowed address and a malformed code; verifies, creates the profile and credits the bonus; is idempotent; maps a wrong or expired code / a rate limit; signs out and creates nothing when Supabase reports a disallowed address; signs out and reports unavailable when the database fails)
- [x] `loadMember` returns profile plus balance, and `null` for an unknown or suspended user (test). (`profiles.test.ts` > loadMember)
- [x] Sign-in and account copy never says bet, `$` or cash out (test). (`sign-in/page.test.ts`; `components/account-control.test.ts`)
- [x] With all Supabase variables unset: `npm run build` passes and `/sign-in` renders the "not configured" notice (build + screenshot). (built with `DATABASE_URL` and Supabase vars unset; `next start` served `/sign-in` with the notice, `/` 200; screenshots in the session scratchpad, not committed)
- [x] `npm run db:generate` reports no schema drift (run by hand: "No schema changes, nothing to migrate").
- [x] `npm run typecheck && npm run lint && npm test && npm run build` green locally; see branch CI.

Not covered by any test (needs live Supabase): a real code email, a real `verifyOtp`, the hook rejecting a
real sign-up, proxy cookie refresh. With a deliberately unreachable Supabase URL, the app showed the
friendly "could not send a code" message and logged only `status=0` (no address).

## Data touched
- Writes `profiles` (insert on first sign-in), `balances` and `ledger_entries` (via
  `grantSignupBonus`, reason `signup_bonus`). Reads `profiles`, `balances`.
- New migration `0002_auth_signup_hook.sql`: function `public.hook_before_user_created` and
  its grants. No table changes, so `schema.ts` and the drizzle snapshot are unchanged.
- Display name defaults to the email local part, which is visible on the leaderboard
  (SOP-09). Self-service rename arrives in M5; until then it is the only place a real name
  could leak. Recorded as a risk.

## UX
`/sign-in` follows `docs/design/theme.md`: eyebrow "Maryville College", display heading "Sign in",
garnet/orange tokens only, orange fill with dark label for the primary button, `danger` text for
errors, 2 px focus rings, no color-only meaning. Copy: "Use your Maryville College email. We will
send you a 6-digit code." and a footer line "Unofficial student project. Points have no value."
(SOP-09 sign-off item 3). Step 1 email; step 2 code with "Use a different email" and "Send a new
code". `AccountControl` sits in the garnet header: "Sign in" link, or display name, `N pts` and a
"Sign out" button.

## Sources checked (2026-10-29)
supabase.com was not reachable from the build sandbox (host not in the network allowlist), so the
pages below were read from their source in the public `supabase/supabase` repository
(`apps/docs/content/guides/auth/…`, branch `master`), which is what those pages render.
- Before User Created hook: https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook
  (source `auth-hooks/before-user-created-hook.mdx`). The Postgres function receives one `jsonb`
  argument `{"metadata": {…}, "user": {"email": …, "app_metadata": …, …}}` ("this user will not be
  found in Postgres"). It returns `{}` to allow, or `{"error": {"http_code": 4xx, "message": …}}`
  to reject; the message reaches the client.
  The domain example creates `public.hook_restrict_signup_by_email_domain(event jsonb) returns jsonb`
  and ends with `grant execute … to supabase_auth_admin; revoke execute … from authenticated, anon, public;`.
- Auth hooks overview (grants, error shape): https://supabase.com/docs/guides/auth/auth-hooks
  (source `auth-hooks.mdx`): `grant usage on schema public to supabase_auth_admin;`, errors from a
  Postgres hook are not retried, `http_code` defaults to 500, `message` is required. Enabled under
  Authentication > Hooks.
- Email OTP: https://supabase.com/docs/guides/auth/passwordless-login/email-otp (source
  `auth-email-passwordless.mdx`, "With OTP"): `signInWithOtp({ email, options: { shouldCreateUser } })`,
  then `verifyOtp({ email, token: '123456', type: 'email' })`. The email template must contain
  `{{ .Token }}` (the Magic Link template is shared); default one request per period and expiry set
  by the project; a user who does not exist is created unless `shouldCreateUser` is `false`.
- SSR for Next.js: https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs
  (source `server-side/creating-a-client.mdx`): `createServerClient(url, publishableKey, { cookies:
  { getAll, setAll } })` with a new client per request; a Proxy refreshes tokens by calling
  `supabase.auth.getClaims()`; on Next.js 16 the file is `proxy.ts`; never trust `getSession()` on
  the server; `setAll` receives cache headers that must be copied onto the response; key variable
  is now `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (SOP-07 still says `…_ANON_KEY`, so both are read).
- Next.js 16 `proxy.ts`: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.

## Owner steps (Supabase Dashboard; cannot be done offline)
1. Apply the migration (`npm run db:migrate`) to `dev` and later `prod`.
2. Authentication > Hooks > Before User Created > Postgres function >
   `public.hook_before_user_created`. Until then the domain rule is enforced only by the server
   actions (a direct call to Supabase's API could create an `auth.users` row for another domain;
   it would get no profile, balance or access here, but the hook is what closes it).
3. Authentication > Email Templates > Magic Link: replace the body with the code, for example
   `<p>Your Maryville College sign-in code is {{ .Token }}</p>`, so the email carries the 6-digit
   code and no link.
4. Keep the OTP length at 6 (the form accepts exactly six digits).
5. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or the publishable key) in
   `.env.local` and Vercel. The service-role key is not used by this slice.

## Decisions and deviations (2026-10-29)
- Files: the pure rule is `src/server/auth-email.ts`; the sign-in steps are `src/server/auth-flow.ts`
  (no Next.js or Supabase SDK imports, so tests use a fake client); `src/server/auth.ts` is the
  Next-bound wiring plus `getCurrentUser()`, `requireUser()` and `signOutCurrent()`;
  `src/server/auth-email-cases.ts` is the shared allow/reject table (test support).
- No `/auth/callback` route: the email-code flow has no redirect. Only `/auth/sign-out` exists.
- Sign-out is a `POST` route that rejects a cross-origin `Origin` (403) and ends only this
  device's session (`signOut({ scope: "local" })`; Supabase's default scope is global).
- The proxy does no gating and skips visitors without an `sb-` cookie. SOP-09 says market pages
  require sign-in in MVP; that gate is not part of this slice (`requireUser()` is ready for it).
- The SQL hook checks ASCII before `lower()`: the first version lower-cased first and the shared
  case table caught it accepting `K@maryvillecollege.edu` (Kelvin sign U+212A folds to `k`).
- The key variable: Supabase now documents `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; SOP-07 names
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Both are read, publishable first.
- The sign-in page calls `connection()` so it is never prerendered with a build-time view of the
  environment.
- Code length: the form accepts exactly six digits; verified only against Supabase's documented default.

## Risks / open questions
- Unverifiable offline: the hook against a real `supabase_auth_admin` call, the exact error text
  the client receives from a rejected hook, `verifyOtp` / `signInWithOtp` behavior, cookie
  refresh in the proxy, and the email template. The Supabase client is faked in tests.
- The allowlist exists twice: `ALLOWED_EMAIL_DOMAINS` for the app and a literal in the SQL
  function (a Postgres hook cannot read Vercel env). Changing domains means editing both; a shared
  case-table test keeps the two rules in agreement.
- Every page calls `getCurrentUser()` through the header, so once Supabase is configured the
  layout reads cookies and pages render dynamically. With Supabase unset nothing is read.
- A deleted-and-recreated Supabase user with the same email gets a new id and is refused with a
  "contact a moderator" message; resolving it is an admin task (SOP-08).

## Tasks
1. This spec; dependencies pinned — verify by: `npm ci --dry-run`.
2. `isAllowedEmail` (TDD) — verify by: unit + fast-check tests.
3. Custom migration with the hook and guarded grants — verify by: PGlite tests.
4. `ensureProfile` (TDD) — verify by: tests against PGlite.
5. Supabase clients, proxy, `auth.ts` (send / verify / current user) — verify by: fake-client tests.
6. Sign-in page, sign-out route, `AccountControl` — verify by: copy test, build, screenshot.
7. `.env.example`, owner to-dos, spec index.

## Definition of Done
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points (the signup bonus flow needs live Supabase: deferred to the first run against `dev`)
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example`
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human

## Next
- `getCurrentUser()` also treats a session whose email is no longer allowed, or differs from the profile's, as signed out (covers email changes, which the hook does not see).
- Owner: the Supabase steps above (hook on in both `dev` and `prod`, custom SMTP before real users), then sign in once with a `@my.maryvillecollege.edu` address and
  once with a gmail address (must be refused) on `dev`.
- M5: rate limiting for code requests, profile editing, leaderboard opt-out.
