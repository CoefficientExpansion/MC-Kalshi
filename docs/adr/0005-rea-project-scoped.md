# ADR-0005: REA installed and registered for this project only
Date: 2026-10-28 · Status: Accepted

## Context
REA ("Reverse Engineer Anything", morluto/rea) provides an MCP server and a skill for
studying shipped software, including live web apps. We want it for Phase R (studying Kalshi's
public app) and nowhere else. `npx rea-agents setup` registers REA user-wide (`~/.claude.json`
and `~/.claude/skills`), which would expose it to every project. The `rea/` folder is a git
clone of the repository at `main` (6.8.0 + 633 commits), unbuilt; building it needs `npm ci`
plus a turbo build. The installed Node (24.11.1) does not satisfy REA's engines range
(`^22.23.4 || ^24.22.1 || >=26.12.1`) and the repo sets `engine-strict=true`.

## Decision
1. The skill lives at `.claude/skills/reverse-engineer-anything/` (project scope), copied from
   `rea/.agents/skills/reverse-engineer-anything/` now and re-synced from the installed package
   by the setup script so skill and server versions match.
2. The MCP server comes from the **published npm package** `rea-agents`, pinned (6.8.0),
   installed into `tools/rea-agents/` by `scripts/setup-rea.ps1`, and registered with
   `claude mcp add --scope local rea` from this folder. No `.mcp.json`, no user-level entry.
3. `rea/` stays as a reference checkout only; it is gitignored and never edited or built here.
4. Node must be upgraded to ≥ 24.22.1 before running the script. Until then, REA is unavailable.

## Consequences
- Other projects on this machine never see REA tools or the skill.
- `rea doctor`, `rea update`, and `rea uninstall` do not manage a local-scope registration;
  upgrades mean editing the version in the script and re-running it.
- The skill text from `main` may mention tools the 6.8.0 server lacks; the skill itself says to
  trust the connected server's tool list. The script's re-sync removes this gap after install.

## Alternatives considered
- `npx rea-agents setup --client claude_code`: user-wide. Rejected.
- Separate `CLAUDE_CONFIG_DIR` profile: isolates REA, but splits settings, history and plugins
  from the main profile for this project. Rejected.
- Build from the `rea/` clone: heavier install, unreleased code, same Node requirement. Kept as
  a fallback documented in SOP-03.
