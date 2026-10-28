# SOP-09: Data handling and privacy

**Purpose**: decide what the app stores and shows about people, keep it minimal, and answer requests consistently. The app is a student project, not an institutional system: it must never hold education records.

## What we store
| Data | Where | Why | Visible to |
|---|---|---|---|
| College email | `profiles.email`, Supabase Auth | sign-in and the domain allowlist | the person, admins |
| Display name | `profiles.display_name` | leaderboard and market pages | everyone signed in |
| Role, suspension, created_at | `profiles` | permissions | admins |
| Trades, positions, ledger entries | `trades`, `positions`, `ledger_entries` | the product; integrity | the person (own rows); admins; aggregates (volume, price) to everyone |
| Market proposals, disputes, audit log | respective tables | moderation | moderators, admins; dispute decisions are public on the market page |
| Server logs | Vercel (IP, user agent, request path; default retention) | debugging | developer |

## What we never store
Passwords (OTP only), payment or bank data, government IDs, student ID numbers, grades, schedules, housing assignments, health or disability information, or anything from a college system. Markets about a named private individual's personal life are rejected at proposal (SOP-04 §1).

## What is public
- Signed-out visitors: nothing. Market pages require sign-in in MVP (revisit before beta).
- Signed-in members: market prices, volumes, charts, rules; the leaderboard (display names and points only); dispute decisions.
- Not shown to other members: who traded what, balances, emails. Positions are private.
- Leaderboard opt-out: a profile toggle hides the display name from the leaderboard (M5).

## Retention
- Ledger and trade rows: kept indefinitely for integrity; anonymized on account removal (SOP-08 §4).
- Auth logs: Supabase default. Vercel logs: default retention; never exported.
- Backups: Supabase daily backups on the prod project; before beta, confirm a restore to `dev` works once (SOP-06 drill).

## Access
- Only the developer and admins can see emails; the service-role key lives only in server env (SOP-07).
- No analytics or ad SDKs. No third-party scripts in the page besides Vercel's own.
- Claude Code sessions never receive production data; debugging uses `dev` with synthetic rows (SOP-06 §3).

## Requests
- **Export**: a member asks for their data → within 7 days send a JSON of `profiles` (own row), `trades`, `positions`, `ledger_entries` filtered to their id, from the project email.
- **Deletion**: follow SOP-08 §4; confirm within 7 days.
- **Correction**: display name changes are self-service; email changes require a new sign-in with the new college address (the old account is removed).

## Policy sign-off (before beta; open question in architecture §11)
1. Send Student Affairs and the IT office a one-page description: purpose, play money, what is stored (the table above), the domain restriction, how to remove an account, who the moderators are.
2. Record their answer (and any conditions, such as excluding athletics markets) in a new ADR.
3. Add the agreed wording to the sign-in page ("This is an unofficial student project; points have no value").

## Checks
- `.env.example` and the schema contain no field that could hold an ID number, grade, or address.
- The anon key reads nothing (SOP-07 check).
- A new table or column that stores personal data gets a row in the "What we store" table in the same PR.
