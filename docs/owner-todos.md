# Owner to-dos

Things only the owner can do: dashboard logins, secrets, and decisions. Tick them off here
and delete a line once it is done. Last updated 2026-10-29.

## Decisions
- [ ] **Pick the M1 engine.** Two finished implementations exist, neither merged:
  - `feat/m1-engine-r2`: earlier session; 169 tests, a bug hunt plus three adversarial cycles,
    architecture §5 updated to match. Paused before the ship review (its spec's "Next" has
    the resume steps).
  - `claude/practical-johnson-4z906w`: this session; 152 tests, one adversarial review
    (`docs/specs/m1-engine.md`), plus the M2a data layer (`docs/specs/m2a-data-layer.md`).
    M2a uses only `probYes`, `displayPrice` and `LIQUIDITY_MIN/MAX` from the engine, so it
    can be moved onto either engine.
  - Then tell Claude which one to keep. It merges that one and moves M2a over if needed.
- [ ] **Public product name.** The working name carries Kalshi's trademark (hard constraint
  5). Choose a name before any user sees the site, and replace the default favicon at the
  same time.
- [ ] **Open questions in architecture §11:** compliance sign-off, Google or Microsoft SSO,
  stipend size, a second moderator.

## Supabase and Vercel (needs your logins; SOP-07)
- [ ] Copy the Supabase `dev` connection string and append `?sslmode=require`:
  - [ ] Add it to Vercel → Project → Settings → Environment Variables as `DATABASE_URL`, for
    both Preview and Production. Use the pooled "Transaction" string (port 6543).
  - [ ] Add it to `apps/web/.env.local` on your machine.
- [ ] After the engine merge (which brings M2a to `main`), run the migrations and the seed
  against `dev` from your machine:
  ```bash
  npm run db:migrate
  ```
  ```bash
  npm run db:seed
  ```
- [ ] Check `https://mc-kalshi.vercel.app/api/health` reports `db: "ok"`.
- [ ] In Supabase `dev`, confirm Table Editor shows RLS enabled on all 11 tables.
- [ ] Before M2b sign-in, from Supabase → Project Settings → API, put
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
  in Vercel and `.env.local`. Keep them out of chat.

## GitHub
- [ ] After each merge to `main`, sync the fork `CoefficientExpansion/MC-Kalshi` with GitHub's
  "Sync fork" button. Vercel builds from the fork.
- [ ] Delete the stale branches on `M4-on-Github/MC-Kalshi`: `feat/m0-scaffold`, `feat/theme`,
  `fix/vercel-typescript`, `fix/vercel-vitest`, and, once the engine is chosen, the losing
  engine branch and `feat/m1-engine`.
- [ ] Look once at the production page in a browser after the next deploy.

## Doing these with Claude
A cloud session has no access to your browser logins. Claude can do the Vercel and Supabase
steps if you either:
- run Claude Code in the desktop app with the Claude in Chrome extension connected, or
- attach your computer to a cloud session through Remote Control.
