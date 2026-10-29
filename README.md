# MC-Kalshi (working name)

A play-money prediction market for Maryville College. Trade YES/NO contracts on campus
events (Scots games, Homecoming, housing lottery, weather, dining, student government) with
points. Kalshi-style UX; LMSR automated market maker under the hood; no real money anywhere.

Status: **M0 scaffold** (monorepo, engine package, hello page, health route, CI). No markets yet. Start with the docs below.

## Layout
```
apps/web/                 Next.js app (App Router); apps/web/.env.example lists every env var
packages/engine/          pure market math (LMSR arrives in M1), Vitest + fast-check
.github/workflows/ci.yml  lint, typecheck, test, build on every push
CLAUDE.md                 Claude Code instructions for this repo
docs/architecture.md      system design, domain model, engine math, data model
docs/development-model.md how work flows, milestones, Definition of Done
docs/skills-matrix.md     Claude Code skills/plugins on/off for this project
docs/adr/                 architecture decision records (0001–0005)
docs/sops/                standard operating procedures
docs/specs/               feature specs (one per slice)
docs/design/              design reference: theme tokens, type, YES/NO colors, copy rules
docs/research/kalshi/     REA evidence + design notes from studying Kalshi
scripts/setup-rea.ps1     installs REA for this project only and registers the MCP server
.claude/settings.json     project-scoped plugin/skill overrides
.claude/skills/           project-scoped skills (reverse-engineer-anything)
rea/                      git clone of morluto/rea (tooling, gitignored, reference only)
tools/rea-agents/         pinned npm install of rea-agents (created by the setup script)
```

## Getting started
1. Node.js 24.22.1 (`.nvmrc`; `engine-strict` is on). Check with `node --version`; upgrade with `winget upgrade OpenJS.NodeJS.LTS` or from nodejs.org.
2. `npm ci`
3. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in `DATABASE_URL` from the Supabase `dev` project (SOP-07). The app runs without it; `/api/health` then reports `db: "unconfigured"`.
4. `npm run dev`, then open http://localhost:3000 and http://localhost:3000/api/health
5. The local gate before any commit: `npm run typecheck && npm run lint && npm test`

Commands (root): `npm run dev` · `npm run build` · `npm test` · `npm run test:watch` · `npm run typecheck` · `npm run lint` · `npm run format` · `npm run db:generate` · `npm run db:migrate` · `npm run db:studio`

REA (optional, research only): `powershell -ExecutionPolicy Bypass -File scripts/setup-rea.ps1`, then restart Claude Code from this folder and follow `docs/sops/SOP-01-session-start.md`.

## Next milestone
M1: the LMSR engine with property tests (`docs/development-model.md`). The M0 spec is `docs/specs/m0-scaffold.md`.
