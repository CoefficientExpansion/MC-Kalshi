# Owner to-dos

Things only the owner can do: secrets, accounts, and decisions. Tick them off here and delete a line
once it is done. Last updated 2026-10-29 (M3 ship; both Supabase projects migrated and seeded).

Project refs (public, they appear in every Supabase URL): `dev` = `rikpavorxtcdptclhruh`,
`prod` = `opefsnkjgmbahwakcegw`.

## Go live: the steps left (about 15 minutes, in this order)
Sign-in on `https://mc-kalshi.vercel.app` works once 1–4 are done. Each step keeps secrets out of
chat; none needs a terminal except to generate random values.

Progress (2026-10-29):
- Done: steps 1–2 (`mc_app` can log in on `prod`: not superuser, no BYPASSRLS).
- Done in Vercel Production: `DATABASE_URL`, `CRON_SECRET`, `DATABASE_CA_CERT` (Supabase Root 2021
  CA, checked against the `prod` pooler's chain and host name), `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `/api/health` reports `db: "ok"` through the `mc_app` guard.
- Left: custom SMTP (step 4), then the code email templates and a sign-in check.
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
4. **Custom SMTP on `prod`** (Authentication -> Emails -> SMTP Settings). Supabase's built-in sender
   only delivers to members of your Supabase team, so without this no student receives a code. The
   simplest no-domain option is Gmail: turn on 2-Step Verification, create an App Password
   (Google Account -> Security -> App passwords), then host `smtp.gmail.com`, port `465`, username =
   your Gmail address, password = the app password, sender = the same address, sender name = the
   product name (not "Kalshi"). Gmail allows about 500 emails a day. Supabase then allows 30 sign-up
   emails an hour by default (Authentication -> Rate Limits).
   Once SMTP is saved the email templates become editable: Claude can set "Confirm sign up" and
   "Magic Link" to show the 6-digit code (`{{ .Token }}`); the app signs in with the code, and the
   default templates only contain a link.
5. **Redeploy** (Vercel -> Deployments -> latest Production -> Redeploy), then check
   `https://mc-kalshi.vercel.app/api/health` reports `db: "ok"`, sign in once with a college address
   (10,000 points appear) and once with a Gmail address (refused).

## Done (2026-10-29)
- [x] M1, M2 and M3 merged to `main`.
- [x] Both Supabase projects: migrations `0000`–`0007` applied (SQL editor, recorded in
  `drizzle.__drizzle_migrations`, so `npm run db:migrate` skips them), 4 categories and 6 sample
  markets seeded, RLS on all 11 tables, append-only triggers present, no Data API grants, `mc_app`
  created without login and without UPDATE on `role`/`suspended_at` or any ledger UPDATE/DELETE.
- [x] Before User Created hook enabled on `dev` and `prod` (`public.hook_before_user_created`): only
  `@maryvillecollege.edu` and `@my.maryvillecollege.edu` addresses can create accounts.
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
- [ ] Market-page sign-in decision applied.
- [ ] Architecture §11 answered (compliance sign-off first), two moderators named.
- [ ] Supabase free tier pauses idle projects: keep the invariant cron hitting `prod`, or upgrade.
