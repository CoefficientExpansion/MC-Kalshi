# MC-Kalshi — Claude Code project instructions

A play-money prediction market, "Kalshi for Maryville College": students, faculty and staff
trade YES/NO contracts on campus events using points, never money. Solo developer; Claude
Code is the primary implementer.

## Read first
- `docs/architecture.md` — system design, domain model, market engine (LMSR), data model
- `docs/development-model.md` — spec → plan → build (TDD) → review → ship; milestones; Definition of Done
- `docs/skills-matrix.md` — which Claude Code skills/plugins are on for this project and when to use them
- `docs/adr/` — decisions already made; add an ADR before changing any of them
- `docs/sops/` — step-by-step procedures (index in `docs/sops/README.md`: session start, feature work, REA research, market ops, release, incidents, environment and secrets, admin operations, data and privacy)
- `docs/specs/` — one spec per feature slice; `docs/research/kalshi/` — REA evidence and design notes

## Hard constraints (do not relax without an ADR)
1. Play money only. No payments, prizes, cash-out, or purchase of points. UI copy never says "bet", "$", or "cash out".
2. Sign-in restricted to Maryville College addresses (`@maryvillecollege.edu`, `@my.maryvillecollege.edu`), enforced at the auth layer, not in the UI.
3. Every point movement is an append-only ledger entry; balances are derived caches, never edited directly.
4. A trade is one DB transaction with the market row locked (`FOR UPDATE`); all market math lives in `packages/engine` and is pure (no I/O).
5. Kalshi is studied for behavior and UX only. Never copy its code, assets, branding, or scrape at volume. See `docs/sops/SOP-03-reverse-engineering-with-rea.md`.

## Working rules
- Follow SOP-02 for any feature: the spec in `docs/specs/` comes before code.
- TDD is mandatory in `packages/engine` and in any server code that writes `ledger_entries`.
- Git: trunk-based; branches `feat/<slug>`, `fix/<slug>`, `chore/<slug>`; Conventional Commits; squash-merge to `main`.
- Commit messages and PR text carry NO Claude attribution (no `Co-Authored-By: Claude`, no "Generated with" line). A user hook blocks them.
- Do not commit or push unless asked.
- `rea/` is a tool checkout (REA reverse-engineering source), not product code. It is gitignored. Do not edit it.
- Secrets live in `.env.local` (gitignored); never print them.

## Commands (available after milestone M0 scaffolds the app)
`npm run dev` · `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run db:migrate` · `npm run db:studio`

## REA (reverse-engineering MCP) status
Project-scoped only. Skill: `.claude/skills/reverse-engineer-anything`. MCP server: registered at local scope by
`scripts/setup-rea.ps1` (requires Node ≥ 24.22.1). If `rea` tools are absent, run that script; do not run `rea setup`
(it would register REA for every project on this machine).
