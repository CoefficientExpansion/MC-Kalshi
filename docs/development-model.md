# Development model

**Spec-driven, test-first, incremental vertical slices, trunk-based.** Claude Code is the
primary implementer; the human owns decisions, reviews, merges, and anything touching policy.
Rationale: ADR-0004.

## The loop for every feature slice

| Step | Tool | Output |
|---|---|---|
| 1. Spec | `/agent-skills:spec` (use `interview-me` first when the ask is vague) | `docs/specs/<slug>.md`: problem, scope, acceptance criteria, non-goals, data touched |
| 2. Plan | `/agent-skills:plan` | ordered task list with a verification step per task, appended to the spec |
| 3. Build | `/agent-skills:build` per task; `/agent-skills:test` for red → green → refactor | code + tests, one commit per task |
| 4. Review | `/code-review` (bugs), then `/agent-skills:review` (five axes) | findings fixed or recorded in the spec |
| 5. Ship | `/agent-skills:ship` on the branch, then squash-merge to `main` | preview verified, CHANGELOG line, deployed |

Rules:
- No code before a spec exists for the slice. A tiny fix may use a one-paragraph spec in the PR body.
- TDD is mandatory in `packages/engine` and in any server action that writes `ledger_entries`.
- Engine math, resolution and void logic get an adversarial pass (`doubt-driven-development`) before merge.
- `source-driven-development` applies when touching Next.js, Supabase, or Drizzle APIs: cite the doc page in the PR.
- `ralph-loop` may run long autonomous build sessions **only** against a task list from step 2 with explicit stop criteria.

## Git
- Trunk-based: `main` always deployable. Branches `feat/<slug>`, `fix/<slug>`, `chore/<slug>`; squash-merge.
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `ci:`.
- No Claude attribution trailers or "Generated with" lines (a user hook blocks them).
- Commit and push only when the human asks.

## Milestones

| # | Slice | Exit criteria |
|---|---|---|
| R | Research: study Kalshi's public app with REA; write design notes (SOP-03). Time-box: 2 sessions. | `docs/research/kalshi/` has notes on market page, order ticket, portfolio, market lifecycle |
| M0 | Scaffold: monorepo, Next.js app, engine package, Biome, Vitest, CI, Vercel + Supabase `dev` | `main` deploys a hello page; CI green |
| M1 | Engine: LMSR quote / fill / budget inversion / void + property tests | the 6 invariants in architecture §5 pass; ≥ 95 % line coverage in `packages/engine` |
| M2 | Auth + profiles + balances + market list and detail (read-only, seeded markets) | sign-in works only with MC email; markets render with a live price |
| M3 | Trading: order ticket, `placeTrade`, positions, ledger, price chart | Playwright runs a full trade loop; ledger invariant job passes |
| M4 | Lifecycle: propose, open, close (cron), resolve, dispute, void, payouts, leaderboard | a moderator can run a full market lifecycle end-to-end |
| M5 | Admin + polish: roles, audit log, rate limits, stipend cron, empty states, mobile layout | `/agent-skills:ship` checklist passes; `/security-review` clean |
| M6 | Closed beta: 20–50 users, 10 seeded markets, feedback loop | two moderators, policy sign-off, SOP-06 drill done |

## Definition of Done (copy into each spec)
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example`
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human
