# ADR-0003: TypeScript monorepo — Next.js + Supabase (Postgres, Auth) + Drizzle on Vercel
Date: 2026-10-28 · Status: Accepted

## Context
Solo developer, no budget, Windows machine, Claude Code as the main implementer. The app is
UI-heavy (order ticket, charts, live prices) with a small but integrity-critical core
(engine, ledger). It must be free to host and simple to operate.

## Decision
- **One language**: TypeScript end-to-end. npm workspaces monorepo: `apps/web` and `packages/engine`.
- **Web**: Next.js (App Router, React Server Components, server actions), Tailwind, shadcn/ui.
- **Data**: Supabase Postgres accessed only from the server through Drizzle ORM; migrations in git.
- **Auth**: Supabase Auth email OTP with a server-side domain allowlist hook.
- **Hosting**: Vercel (previews per PR, prod from `main`); two Supabase projects (`dev`, `prod`).
- **Tooling**: Biome for lint/format, Vitest + fast-check, Playwright, GitHub Actions.

## Consequences
- Free tiers cover a campus beta. Vercel cron handles market close and stipends.
- Server actions keep all money logic server-side; the browser never computes a price that counts.
- Drizzle gives typed SQL and explicit transactions (`FOR UPDATE`) that the trade path needs.
- Supabase lock-in is limited to Auth; Postgres and Drizzle move anywhere.
- Node ≥ 24.22.1 is required locally (REA needs it too).

## Alternatives considered
- Python backend (FastAPI) + React SPA: two languages, two deploys, duplicated types for a one-person team. Rejected.
- Auth.js instead of Supabase Auth: more code to own for email OTP; revisit only if the college exposes SSO we want to use directly.
- Prisma instead of Drizzle: heavier, slower cold starts on serverless, less control over transactions. Rejected.
- Plain Postgres on Neon + separate auth: more pieces to wire; Supabase bundles both for free.
