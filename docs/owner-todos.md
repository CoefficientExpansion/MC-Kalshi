# Owner to-dos

Things only the owner can do: secrets, accounts, and decisions. Tick them off here and delete a line
once it is done. Last updated 2026-10-29 (open sign-up decision, ADR-0007).

Project refs (public, they appear in every Supabase URL): `dev` = `rikpavorxtcdptclhruh`,
`prod` = `opefsnkjgmbahwakcegw`.

## NOT DONE: college-only sign-in (hard constraint 2) and code emails
- [ ] **College-only sign-in (hard constraint 2) and code emails: production runs
  `SIGN_IN_MODE=open` (ADR-0007).** The owner chose not to set up SMTP (2026-10-29), so anyone can
  create an account with any email and a password, emails are not verified, and each account gets
  the signup bonus. To restore college mode (ADR-0007, "Revert"):
  1. Supabase `prod` -> Authentication -> Emails -> SMTP Settings: configure custom SMTP (for
     example Gmail with an App Password: host `smtp.gmail.com`, port `465`, sender name = the
     product name, not "Kalshi").
  2. Edit the "Confirm sign up" and "Magic Link" templates to show the code, `{{ .Token }}`.
  3. Authentication -> Sign In / Providers -> Email: turn **Confirm email** back on.
  4. Authentication -> Hooks: re-enable Before User Created (`public.hook_before_user_created`).
  5. Vercel -> Production: delete `SIGN_IN_MODE`, then redeploy.
  6. Sign in with a college address (the code arrives) and with a Gmail address (refused).
     Open-mode accounts at other domains are then signed out for good (the session check requires
     a college address again); supersede ADR-0007 and drop its clause from CLAUDE.md.

## Go live: the steps left (about 15 minutes, in this order)
Sign-in on `https://mc-kalshi.vercel.app` works once 1–4 are done. Each step keeps secrets out of
chat; none needs a terminal except to generate random values.

Progress (2026-10-29):
- Done: steps 1–2 (`mc_app` can log in on `prod`: not superuser, no BYPASSRLS).
- Done in Vercel Production: `DATABASE_URL`, `CRON_SECRET`, `DATABASE_CA_CERT` (Supabase Root 2021
  CA, checked against the `prod` pooler's chain and host name), `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `/api/health` reports `db: "ok"` through the `mc_app` guard.
- Decided: no SMTP for now; open sign-up instead (ADR-0007, NOT DONE item above).
- Left (the orchestrator does these): step 4 below on `prod` (disable the Before User Created hook,
  turn off Confirm email, set the minimum password length to 10), set `SIGN_IN_MODE=open` in Vercel
  Production, then step 5.
- A push to `main` redeploys Production without Vercel's re-authentication code.
- Vercel refuses a `NEXT_PUBLIC_` variable of type Secret (it reaches the browser anyway): use Config.

1. **Generate two random values** (PowerShell; each command copies a 64-character hex string to the
   clipboard and prints nothing). Paste each one straight where it goes, then clear the clipboard.
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); (($b | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Clipboard
   ```
   One is the `mc_app` database password (step 2), the other is `CRON_SECRET` (step 3). Hex needs no
   URL-encoding inside a connection string.
2. **Let the app's role log in** (ADR-0006). Supabase `prod` -> SQL Editor, run
   `ALTER ROLE mc_app WITH LOGIN PASSWORD '<paste the first value>';`.
   Then Supabase `prod` -> **Connect** -> Transaction pooler (port 6543): copy the URI, change the
   user `postgres.opefsnkjgmbahwakcegw` to `mc_app.opefsnkjgmbahwakcegw`, put the password in, and
   append `?sslmode=require`. Never use the `postgres` owner string in Vercel: in Production the app
   checks `select current_user` on its first connection and refuses any role but `mc_app`.
3. **Vercel -> mc-kalshi -> Settings -> Environment Variables, Production only, type Sensitive:**
   - `DATABASE_URL`: the `mc_app` string from step 2.
   - `DATABASE_CA_CERT`: the PEM text of Supabase `prod` -> Database -> Settings -> SSL Configuration
     -> Download certificate (without it the app refuses the database in Production).
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase `prod` -> Project Settings -> API Keys ->
     publishable key (public by design, but keep it out of chat anyway).
   - `CRON_SECRET`: the second value from step 1 (the daily ledger check answers 401 without it).
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://opefsnkjgmbahwakcegw.supabase.co` (Claude can set this one).
   Do not install the Supabase Vercel integration: it copies the owner password and the service-role
   key into Vercel.
4. **Open sign-up on `prod`, no SMTP** (ADR-0007; replaces the custom-SMTP step). Supabase `prod`:
   - Authentication -> Hooks: disable Before User Created (otherwise non-college sign-ups get 403).
   - Authentication -> Sign In / Providers -> Email: turn **Confirm email** off (otherwise sign-up
     returns no session and the page says confirmation is needed) and set the minimum password
     length to 10.
   - Vercel -> mc-kalshi -> Settings -> Environment Variables, **Production** only:
     `SIGN_IN_MODE` = `open` (not secret; never a `NEXT_PUBLIC_` variable).
5. **Redeploy** (Vercel -> Deployments -> latest Production -> Redeploy), then check
   `https://mc-kalshi.vercel.app/api/health` reports `db: "ok"`, create an account with any email
   and a 10+ character password (10,000 points appear), sign out, sign in again (no second bonus),
   and try a wrong password ("Email or password is wrong.").

## Done (2026-10-29)
- [x] M1, M2 and M3 merged to `main`.
- [x] Both Supabase projects: migrations `0000`–`0007` applied (SQL editor, recorded in
  `drizzle.__drizzle_migrations`, so `npm run db:migrate` skips them), 4 categories and 6 sample
  markets seeded, RLS on all 11 tables, append-only triggers present, no Data API grants, `mc_app`
  created without login and without UPDATE on `role`/`suspended_at` or any ledger UPDATE/DELETE.
- [x] Before User Created hook enabled on `dev` and `prod` (`public.hook_before_user_created`): only
  `@maryvillecollege.edu` and `@my.maryvillecollege.edu` addresses can create accounts. On `prod`
  it is to be disabled for open sign-up (ADR-0007); re-enable it to restore college mode.
- [x] Email code: 6 digits, 10-minute expiry, on `dev` and `prod`.
- [x] Auth URLs: `prod` Site URL `https://mc-kalshi.vercel.app`; `dev` Site URL
  `http://localhost:3000` plus the preview URL pattern.
- [x] Balance floor: points never go negative (`CHECK (points >= 0)` ships in M3); in M4 a void debit
  larger than a balance is covered by a separate house -> user entry.
- [x] Per-trade cap `min(5000, 50·b)` points and slippage choices 1 / 2 / 5 points.

## Decisions
- [ ] **Public product name.** The working name carries Kalshi's trademark (hard constraint 5).
  Choose before any user sees the site; replace the default favicon at the same time.
- [ ] **Market pages: require sign-in?** SOP-09 says yes for MVP; today they are public
  (`requireUser()` exists and is ready). Decide before beta.
- [ ] **Open questions in architecture §11:** compliance sign-off (Student Affairs), Google or
  Microsoft SSO, stipend size, a second moderator.
- [ ] **Vercel cron plan before M4.** Hobby is believed to allow daily crons only, so the
  every-minute close cron (architecture §6) needs Pro or a GitHub Actions `schedule`. Confirm the
  limit in Vercel docs first, then decide. (`placeTrade` checks `close_at` itself, so this is not urgent.)

## Supabase `dev` and Vercel Preview (optional, for testing previews)
- [ ] Same as go-live steps 2–3 against `dev`, but in Vercel **Preview** only, with a different
  `mc_app` password and `CRON_SECRET`. `NEXT_PUBLIC_SUPABASE_URL` for Preview is
  `https://rikpavorxtcdptclhruh.supabase.co`.
- [ ] Local development: put the same Preview values in `apps/web/.env.local`, plus the `dev` owner
  string in `MIGRATION_DATABASE_URL` for `npm run db:migrate` and `npm run db:seed` (`mc_app` may not
  insert categories). Never commit `.env.local`.
- [ ] Custom SMTP on `dev` too if you want code emails there (the built-in sender reaches team members only).

## Vercel
- Deployment Protection does not block students: `https://mc-kalshi.vercel.app` answered HTTP 200 without
  login (curl, 2026-10-29); only preview URLs answer 302 to Vercel Authentication.
- [ ] Decide whether previews should stay protected.
- [ ] Look once at the production page in a browser after the redeploy (human preview check).

## GitHub
- `git push origin` updates both repositories (`M4-on-Github/MC-Kalshi` and the fork
  `CoefficientExpansion/MC-Kalshi`, which Vercel builds from).
- [ ] Delete the stale branches on `M4-on-Github/MC-Kalshi` (merged or superseded): `feat/m0-scaffold`,
  `feat/theme`, `fix/vercel-typescript`, `fix/vercel-vitest`, `feat/m1-engine`, `feat/m1-engine-r2`,
  `claude/practical-johnson-4z906w`, `feat/m3-trading`.

## Before beta
- [ ] Public product name and favicon (Decisions).
- [ ] Go-live steps 1–5 done; a human has run the full sign-in and trade loop on `prod`.
- [ ] College-only sign-in restored, or the open test explicitly accepted for beta (NOT DONE item).
- [ ] Market-page sign-in decision applied.
- [ ] Architecture §11 answered (compliance sign-off first), two moderators named.
- [ ] Supabase free tier pauses idle projects: keep the invariant cron hitting `prod`, or upgrade.
