# Owner to-dos

Things only the owner can do: dashboard logins, secrets, and decisions. Tick them off here
and delete a line once it is done. Last updated 2026-10-29 (after the independent progress review).

## Decisions
- [ ] **Pick the M1 engine** and tell Claude which. Two finished implementations, neither merged:
  - `feat/m1-engine-r2`: earlier session; a bug hunt plus three adversarial cycles, architecture §5
    updated to match. Paused before the ship review. It has 160 tests in this container (its spec
    claims 169).
  - `claude/practical-johnson-4z906w`: this session; engine plus the M2a data layer. Already has
    `applyFill`, `settlePayouts`, `voidRefunds` and `withinSlippage`, which M3 needs. Rounding is
    strict `ceil`/`floor`.
  - A Sonnet comparison favored r2 (more tests, docs match). The Fable review favored this branch:
    r2 rounds through a tolerance of up to 1e-6, which paid 7 of 50k sells one extra point, and r2
    has no positions module. Fable recommends keeping this engine and porting from r2 its typed
    `EngineError` codes (so `placeTrade` can tell `invalid_input` from `internal_error` without
    matching `RangeError` text) and its edge/underflow tests. The two engines agree to the point on
    170k random quotes. M2a uses only `probYes`, `displayPrice` and `LIQUIDITY_MIN/MAX`, so it can
    move onto either.
- [ ] **Merge M1 + M2 to `main`** once the engine is chosen (you said not yet). Claude squash-merges,
  then you push both remotes (`origin`, `deploy`) and sync the fork (GitHub section).
- [ ] **Market pages: require sign-in?** SOP-09 says yes for MVP; today they are public
  (`requireUser()` exists and is ready). Decide before beta.
- [ ] **Balance floor and void-debit policy** (architecture §6 "Balance floor", proposed):
  - [ ] Add `CHECK (points >= 0)` on `balances` in the M3 migration, next to `placeTrade`'s balance check?
  - [ ] M4 void where a user's `void_refund` is a debit larger than their balance: let the house absorb
    the shortfall via a separate house -> user entry (recommended), or something else?
- [ ] **Public product name.** The working name carries Kalshi's trademark (hard constraint 5).
  Choose before any user sees the site; replace the default favicon at the same time.
- [ ] **Open questions in architecture §11:** compliance sign-off, Google or Microsoft SSO, stipend
  size, a second moderator.
- [ ] **Vercel cron plan before M4.** Hobby is believed to allow daily crons only, so the
  every-minute close cron (architecture §6) needs Pro or a GitHub Actions `schedule`. Confirm the
  limit in Vercel docs first, then decide. (`placeTrade` checks `close_at` itself, so this is not urgent.)

## Supabase `dev`
- [ ] Copy the `dev` connection string and append `?sslmode=require`:
  - [ ] Vercel -> Project -> Settings -> Environment Variables -> `DATABASE_URL`, Preview and
    Production. Use the pooled "Transaction" string (port 6543).
  - [ ] `apps/web/.env.local` on your machine.
- [ ] Supabase -> Project Settings -> API: put `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works) in
  Vercel and `.env.local`. Keep them out of chat.
- [ ] Download the Supabase CA certificate (Project Settings -> Database -> SSL Configuration) and
  set `DATABASE_CA_CERT` (the PEM text) in Vercel and `.env.local`. Without it the connection is
  TLS but the certificate is not verified.
- [ ] After the merge: `npm run db:migrate`, then `npm run db:seed`, against `dev` from your machine.
- [ ] Check `https://mc-kalshi.vercel.app/api/health` reports `db: "ok"`.
- [ ] Table Editor: RLS enabled on all 11 tables.
- [ ] **Enable the before-user-created hook** (after migration `0002_auth_signup_hook`): Authentication
  -> Hooks -> Before User Created -> Postgres function -> `hook_before_user_created` (schema
  `public`) -> enable. Until it is on, non-college addresses can create `auth.users` rows and
  trigger code emails through the public anon key (they still cannot get a profile or points).
- [ ] Authentication -> Email Templates -> Magic Link: body
  `<p>Your Maryville College sign-in code is {{ .Token }}</p>`. Keep OTP length 6.
- [ ] Custom SMTP: Authentication -> SMTP Settings (Resend free tier). The built-in sender allows only
  a few emails per hour; needed before real users.
- [ ] Check it: sign in once with an `@my.maryvillecollege.edu` address (profile and 10,000 points
  appear) and once with a gmail address (must be refused).

## Supabase `prod`
- [ ] `DATABASE_URL` (pooled), the three `NEXT_PUBLIC_SUPABASE_*` values and `DATABASE_CA_CERT` in
  Vercel -> Production only.
- [ ] Run `npm run db:migrate` against `prod` at the first release (SOP-05).
- [ ] **Enable the before-user-created hook on `prod` too**, same steps as `dev`.
- [ ] Magic Link email template and custom SMTP, same as `dev`.
- [ ] Set Site URL and redirect URLs to `https://mc-kalshi.vercel.app`.

## Vercel
- [ ] **Deployment Protection:** Settings -> Deployment Protection. It is believed to be on (Vercel
  Authentication, Standard), which would block students from production. Decide what previews and
  production should be, and set it.
- [ ] Hobby cron limits: see the Decisions item. Nothing to configure until M3 adds `vercel.json`.
- [ ] Look once at the production page in a browser after the next deploy (human preview check).

## GitHub
- [ ] Push `main` to both remotes: `origin` (source of truth) and `deploy`.
- [ ] After each merge to `main`, sync the fork `CoefficientExpansion/MC-Kalshi` with GitHub's "Sync
  fork" button. Vercel builds from the fork. Easy to forget; no automation yet.
- [ ] Delete the stale branches on `M4-on-Github/MC-Kalshi`: `feat/m0-scaffold`, `feat/theme`,
  `fix/vercel-typescript`, `fix/vercel-vitest`, and, once the engine is chosen, the losing engine
  branch (`feat/m1-engine-r2` or `claude/practical-johnson-4z906w`) and `feat/m1-engine`.

## Before beta
- [ ] Public product name and favicon (Decisions).
- [ ] Custom SMTP live on `prod`; hook enabled on `prod`; `DATABASE_CA_CERT` set in Production.
- [ ] Deployment Protection set so students can reach production.
- [ ] Market-page sign-in decision applied.
- [ ] Architecture §11 answered (compliance sign-off first), two moderators named.
- [ ] Supabase free tier pauses idle projects: keep the invariant cron hitting `prod`, or upgrade.
- [ ] Human preview check of the full sign-in and trade loop on `prod`.

## Claude can do these once...
A cloud session has no access to your browser logins. Claude can do the Vercel and Supabase
dashboard steps if you either:
- run Claude Code in the desktop app with the Claude in Chrome extension connected, or
- attach your computer to a cloud session through Remote Control.
