# Architecture Decision Records

One file per decision, numbered, never edited after acceptance (supersede with a new ADR).
Use `documentation-and-adrs` (agent-skills) to draft; keep each under a page.

| # | Title | Status |
|---|---|---|
| [0001](0001-play-money-only.md) | Play money only; no real-money path, ever | Accepted |
| [0002](0002-lmsr-amm-over-order-book.md) | LMSR automated market maker instead of a Kalshi-style order book | Accepted |
| [0003](0003-stack-nextjs-supabase-typescript.md) | TypeScript monorepo: Next.js + Supabase (Postgres, Auth) + Drizzle on Vercel | Accepted |
| [0004](0004-development-model.md) | Spec-driven, test-first, incremental, trunk-based development | Accepted |
| [0005](0005-rea-project-scoped.md) | REA installed and registered for this project only | Accepted |
| [0006](0006-app-database-role.md) | The app connects as a restricted `mc_app` role; migrations run as the owner | Proposed |

## Template
```markdown
# ADR-NNNN: <title>
Date: YYYY-MM-DD · Status: Proposed | Accepted | Superseded by ADR-NNNN

## Context
What forces are at play; what we must decide and why now.

## Decision
One or two sentences, in the active voice.

## Consequences
Positive, negative, and what becomes harder. Follow-ups.

## Alternatives considered
Each with the reason it lost.
```
