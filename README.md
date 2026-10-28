# MC-Kalshi (working name)

A play-money prediction market for Maryville College. Trade YES/NO contracts on campus
events (Scots games, Homecoming, housing lottery, weather, dining, student government) with
points. Kalshi-style UX; LMSR automated market maker under the hood; no real money anywhere.

Status: **planning complete, no application code yet.** Start with the docs below.

## Layout
```
CLAUDE.md                 Claude Code instructions for this repo
docs/architecture.md      system design, domain model, engine math, data model
docs/development-model.md how work flows, milestones, Definition of Done
docs/skills-matrix.md     Claude Code skills/plugins on/off for this project
docs/adr/                 architecture decision records (0001–0005)
docs/sops/                standard operating procedures
docs/specs/               feature specs (one per slice)
docs/research/kalshi/     REA evidence + design notes from studying Kalshi
scripts/setup-rea.ps1     installs REA for this project only and registers the MCP server
.claude/settings.json     project-scoped plugin/skill overrides
.claude/skills/           project-scoped skills (reverse-engineer-anything)
rea/                      git clone of morluto/rea (tooling, gitignored, reference only)
tools/rea-agents/         pinned npm install of rea-agents (created by the setup script)
```

## Getting started
1. Node.js ≥ 24.22.1 (LTS). Check with `node --version`; upgrade with `winget upgrade OpenJS.NodeJS.LTS` or from nodejs.org.
2. `powershell -ExecutionPolicy Bypass -File scripts\setup-rea.ps1` — installs REA into `tools/` and registers it at local scope.
3. Restart Claude Code from this folder. `/status` should list project settings; `claude mcp list` should show `rea`.
4. Follow `docs/sops/SOP-01-session-start.md`.

## Next milestone
Phase R (research with REA, time-boxed to 2 sessions), then M0 scaffold. See `docs/development-model.md`.
