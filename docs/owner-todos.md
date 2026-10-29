# Owner to-dos

Things only the owner can do: dashboard logins, secrets, and decisions. Tick them off here
and delete a line once it is done. Last updated 2026-10-29 (after the engine decision and the M2 integration).

## Decisions
- [x] **M1 engine picked (2026-10-29): keep `feat/m1-engine-r2`.** In a 70-digit reference comparison over
  281k quotes it was exact wherever the reference could decide, while strict `ceil`/`floor` was off by a full
  point on 27% of mirror trades, and it raised `EngineError` on every hostile input. See
  `docs/specs/m1-engine.md`, "Ship decision".
- [x] **M1 + M2 merged to `main`:** M1 as c311323; M2 with this integration (`feat/m2-integrate`).
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
- [ ] **App database role** (ADR-0006, after migration `0005_app_role`): Supabase -> SQL Editor, run
  `ALTER ROLE mc_app WITH LOGIN PASSWORD '<a new generated password>';` (never paste it into chat).
  Then copy your current owner string into `MIGRATION_DATABASE_URL` in `apps/web/.env.local`, and
  point `DATABASE_URL` (Vercel Preview + Production and `.env.local`) at `mc_app`: same host, user
  `mc_app.<project-ref>` on the pooler, the new password, `?sslmode=require`. Check `/api/health`
  still reports `db: "ok"` and a new sign-in still gets its points. Run `npm run db:seed` with
  `DATABASE_URL` set to the owner string (`mc_app` may not insert categories). Until this step is
  done the app keeps working as the owner.
- [ ] Table Editor: RLS enabled on all 11 tables.
- [ ] **Enable the before-user-created hook** (after migration `0002_auth_signup_hook`): Authentication
  -> Hooks -> Before User Created -> Postgres function -> `hook_before_user_created` (schema
  `public`) -> enable. Until it is on, non-college addresses can create `auth.users` rows and
  trigger code emails through the public anon key (they still cannot get a profile or points).
- [ ] Set the email code expiry to 10 minutes or less (Authentication -> Providers -> Email), at the same
  time as the hook.
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
- [ ] **App database role on `prod`**, same steps as `dev` with a different password:
  `ALTER ROLE mc_app WITH LOGIN PASSWORD '...'` in the SQL Editor, Production `DATABASE_URL` ->
  `mc_app`, and the owner string only where you run migrations (`MIGRATION_DATABASE_URL`, never Vercel).
- [ ] **Enable the before-user-created hook on `prod` too**, same steps as `dev`.
- [ ] Do not set the Supabase env vars in Production until this hook is enabled on `prod`. At the same
  time set the email code expiry to 10 minutes or less (Authentication -> Providers -> Email).
- [ ] Magic Link email template and custom SMTP, same as `dev`.
- [ ] Set Site URL and redirect URLs to `https://mc-kalshi.vercel.app`.

## Vercel
- Deployment Protection does not block students: `https://mc-kalshi.vercel.app` answered HTTP 200 without
  login (curl, 2026-10-29); only preview URLs answer 302 to Vercel Authentication.
- [ ] Decide whether previews should stay protected.
- [ ] Hobby cron limits: see the Decisions item. M3's `apps/web/vercel.json` schedules only the
  daily ledger invariant check (09:00 UTC), which Hobby allows.
- [ ] Set `CRON_SECRET` in Vercel (Production and Preview): generate it with `openssl rand -hex 32`,
  a different value per environment. Vercel Cron sends it as the bearer token; without it the
  invariant route answers 401 and the cron run shows as failed.
- [ ] Look once at the production page in a browser after the next deploy (human preview check).

## GitHub
- `git push origin` now updates both repositories (`M4-on-Github/MC-Kalshi` and the fork
  `CoefficientExpansion/MC-Kalshi`, which Vercel builds from); the fork accepted it on 2026-10-29, so
  "Sync fork" is no longer needed.
- [ ] Delete the stale branches on `M4-on-Github/MC-Kalshi` (merged or superseded): `feat/m0-scaffold`,
  `feat/theme`, `fix/vercel-typescript`, `fix/vercel-vitest`, `feat/m1-engine`, `feat/m1-engine-r2`,
  `claude/practical-johnson-4z906w`.

## Before beta
- [ ] Public product name and favicon (Decisions).
- [ ] Custom SMTP live on `prod`; hook enabled on `prod`; `DATABASE_CA_CERT` set in Production.
- [x] Students can reach production (Deployment Protection covers previews only; verified 2026-10-29).
- [ ] Market-page sign-in decision applied.
- [ ] Architecture §11 answered (compliance sign-off first), two moderators named.
- [ ] Supabase free tier pauses idle projects: keep the invariant cron hitting `prod`, or upgrade.
- [ ] Human preview check of the full sign-in and trade loop on `prod`.

## Claude can do these once...
A cloud session has no access to your browser logins. Claude can do the Vercel and Supabase
dashboard steps if you either:
- run Claude Code in the desktop app with the Claude in Chrome extension connected, or
- attach your computer to a cloud session through Remote Control.
