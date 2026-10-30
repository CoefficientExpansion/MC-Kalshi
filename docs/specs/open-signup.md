# Open sign-up (temporary): email and password, any domain
Status: done in code; Supabase and Vercel settings pending · Milestone: go-live · ADRs: 0007 (relaxes hard constraint 2 in production)

## Problem
The owner does not want to set up custom SMTP on any email account, and Supabase's built-in sender
only delivers to members of the Supabase team, so the emailed 6-digit code (docs/specs/m2b-auth.md)
cannot reach anyone. This is a just-for-fun project: the owner decided on 2026-10-29 to let anyone
sign up for now and to record the college-only rule as not done (`docs/owner-todos.md`).

## Scope
In:
- `SIGN_IN_MODE` (server only). Exactly `open` (surrounding spaces ignored) turns on open mode;
  unset, blank or any other value (`OPEN`, `true`, `1`) means college mode, which is today's code
  flow unchanged (fail closed). One pure parser: `parseSignInMode` in `src/server/sign-in-mode.ts`.
- Open mode `/sign-in`: one form with email and password and two buttons, "Create account" and
  "Sign in", plus a line saying this is an open test and points are play money.
- Server actions call Supabase `signUp` and `signInWithPassword` through `adaptSupabaseAuth`, then
  the same post-sign-in step as the code flow (`completeSignIn`: allowed-address check, profile,
  signup bonus once through the ledger, suspension check).
- Domain policy: `"any"` in open mode (a syntactically valid address with a plain host name),
  the college allowlist otherwise. One function, `getEmailDomainPolicy()`, feeds the sign-in flow,
  `getSessionMember` and the CI-only `/api/test/session` route.
- Password: 10 to 72 characters, and at most 72 UTF-8 bytes (bcrypt's limit), checked before
  Supabase is called.
- The password actions refuse to run in college mode; the code actions refuse to run in open mode.

Out: password reset, email change, email confirmation, our own rate limit (Supabase's applies),
any change to the database hook, migrations or e2e specs.

## Acceptance criteria
- [x] `parseSignInMode`: `open` and ` open ` are open; `undefined`, blank, `OPEN`, `true`, `1`,
      `college` are college.
- [x] College mode: every existing auth test passes unchanged; `/sign-in` shows the code form.
- [x] Open mode `/sign-in` renders email and password fields with labels, `autocomplete`
      `email` and `current-password`, both buttons, and the open-test line; copy has no "bet", "$",
      "cash out".
- [x] Sign-up with a new address and a valid password creates the profile and grants the bonus;
      signing in afterwards grants nothing more.
- [x] Wrong password, unknown account, or a password outside 10–72 on sign-in: "Email or password
      is wrong." (no account enumeration). Short or long password on sign-up: a length message,
      Supabase not called. Invalid email: a syntax message, Supabase not called.
- [x] Sign-up for an existing account: "Could not create that account. If you already have one,
      sign in." Rate limit and unknown errors: the existing generic copy.
- [x] `signUp` without a session (Confirm email still on): the confirmation message, no profile.
- [x] `getSessionMember` and `/api/test/session` accept any domain in open mode and only the
      college domains in college mode.
- [x] No password or email address is logged.

## Data touched
`profiles`, `balances`, `ledger_entries` (reason `signup_bonus`) through `ensureProfile`. No
migration.

## UX
Same card as the code form, theme tokens only (docs/design/theme.md). The "Sign in" button is the
primary action; "Create account" is secondary but a full-size button. Password field uses
`autocomplete="current-password"` (it serves both buttons; password managers offer to save on
success either way) with a hint "10 to 72 characters".

## Risks / open questions
See ADR-0007: anyone on the internet can join, unlimited accounts can farm the signup bonus,
unverified emails let someone register an address they do not own, and display names default from
the email. Supabase "Confirm email" must be off for open mode to work; if it is on, sign-up says so.

## Tasks
1. Parser and domain policy (tests first) — verify by: `auth-email.test.ts`, `sign-in-mode.test.ts`.
2. Adapter and password flow (tests first) — verify by: `auth-adapter.test.ts`, `auth-password.test.ts`.
3. Session lookup and e2e route use the policy — verify by: `auth-session.test.ts`, `route.test.ts`.
4. Page and form per mode — verify by: `page.open.test.ts`.
5. Docs: `.env.example`, SOP-07, `owner-todos.md`, CLAUDE.md clause.

## Definition of Done
(docs/development-model.md) biome, lint, typecheck, test and build green with no warnings; spec
criteria ticked; docs updated.

## Next
Orchestrator: disable the Before User Created hook on `prod`, turn off Confirm email, set the
minimum password length to 10, set `SIGN_IN_MODE=open` in Vercel Production, redeploy.
