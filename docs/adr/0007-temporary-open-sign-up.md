# ADR-0007: Temporary open sign-up with email and password
Date: 2026-10-29 · Status: Accepted by the owner 2026-10-29

## Context
Hard constraint 2 limits sign-in to Maryville College addresses, enforced by the Supabase Before
User Created hook and re-checked by the app; the address is proved by a 6-digit code emailed at
every sign-in (docs/specs/m2b-auth.md). Supabase's built-in sender only delivers to members of the
Supabase team, so the code flow needs custom SMTP. The owner does not want to set up SMTP on any of
their email accounts, and this is a just-for-fun project. Without email, no address can be proved,
so the college rule cannot be enforced.

## Decision
Production runs in an **open mode** while `SIGN_IN_MODE=open` (server-only variable): anyone can
create an account with any email address and a password (10 to 72 characters), with Supabase
"Confirm email" off, so no email is ever sent. The Before User Created hook is disabled on `prod`.
Hard constraint 2 is therefore temporarily relaxed in production. Any other value of
`SIGN_IN_MODE`, or none, keeps the college code flow exactly as before (fail closed), and that
remains the default in code, in development and in CI. The college-only rule is recorded as
**NOT DONE** in `docs/owner-todos.md`.

## Consequences
- Anyone on the internet can join, not only the college community.
- Unlimited accounts can be created, each receiving the signup bonus. Points are play money with
  no value (ADR-0001), so bonus farming is accepted; it can distort any future leaderboard.
- Emails are not verified: someone can register an address they do not own (including a college
  address) and block its real owner from signing up with it.
- Display names default from the email's local part, so an account can appear to be someone else.
  No leaderboard or public profile exists yet, so nothing shows names to other members today;
  build one only after college mode is restored or display names are moderated.
- The session check (`getSessionMember`) accepts any domain in open mode, so accounts created in
  open mode keep working until the mode is switched back.
- Supabase's own sign-up and password rate limits are the only abuse limits.
- **Restoring college mode re-proves ownership.** The code flow proves the mailbox at every
  sign-in, and in college mode `getSessionMember` refuses any session whose email is not a college
  address. So after the switch, non-college accounts are signed out for good, and a college-address
  account created by someone who does not own that mailbox can no longer sign in, because they
  never receive its codes. Its profile and points remain; a moderator can suspend it if needed.

## Revert (restore college mode)
1. Supabase `prod`: Authentication -> Emails -> SMTP Settings: configure custom SMTP.
2. Edit the "Confirm sign up" and "Magic Link" templates to show `{{ .Token }}`.
3. Authentication -> Sign In / Providers -> Email: turn **Confirm email** back on.
4. Authentication -> Hooks: re-enable Before User Created (`public.hook_before_user_created`).
5. Vercel Production: delete `SIGN_IN_MODE`, then redeploy.
6. Sign in with a college address (code arrives) and with a Gmail address (refused); then supersede
   this ADR and remove the clause from CLAUDE.md hard constraint 2.

## Alternatives considered
- Custom SMTP with the code flow: the right answer, but the owner declined to set up SMTP.
- Magic links or OAuth (Google/Microsoft): links also need email; SSO needs a college or cloud app
  registration the owner does not have. Rejected for now.
- Keep college mode with password sign-up and no email: still lets anyone claim a college address,
  so it gives a false sense of restriction. Rejected in favour of being honest that it is open.
