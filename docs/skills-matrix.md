# Skills and plugins for this project

How Claude Code is configured for MC-Kalshi and why. Project-scope config lives in
`.claude/settings.json` (committed) and `.claude/skills/` (committed). Nothing here changes
other projects on this machine.

## Scope mechanics (Claude Code 2.1.312)
- **Plugins**: `enabledPlugins` merges key by key and project `.claude/settings.json` outranks `~/.claude/settings.json`, so `false` here disables a user-enabled plugin in this project only.
- **Standalone skills**: `skillOverrides: { "<name>": "off" }` hides them. It does **not** affect plugin skills; those are controlled by `enabledPlugins`.
- **Project skills**: `.claude/skills/<name>/SKILL.md`. A personal skill with the same name in `~/.claude/skills/` would win; none exists for `reverse-engineer-anything`, so the project copy loads.
- **MCP servers**: REA is registered at **local** scope (`claude mcp add --scope local`), stored under this folder's path in `~/.claude.json`. Nothing is written to `.mcp.json`, and no other project sees it.

## ON for this project

| Skill / plugin | Source | Use it for |
|---|---|---|
| `reverse-engineer-anything` | project `.claude/skills/` (copied from `rea/.agents/skills/`, re-synced from the installed package by `scripts/setup-rea.ps1`) | Phase R only: studying Kalshi's public web app (SOP-03). Not for analysis of our own source. |
| `agent-skills@addy-agent-skills` plugin | user-level plugin | The whole dev loop: `spec`, `plan`, `build`, `test`, `review`, `ship`, `code-simplify`; plus `spec-driven-development`, `test-driven-development`, `incremental-implementation`, `api-and-interface-design`, `frontend-ui-engineering`, `security-and-hardening`, `documentation-and-adrs`, `git-workflow-and-versioning`, `ci-cd-and-automation`, `debugging-and-error-recovery`, `shipping-and-launch`, `doubt-driven-development`, `source-driven-development`, `interview-me`, `idea-refine`, `code-simplification`, `performance-optimization`, `browser-testing-with-devtools`, `context-engineering`, `deprecation-and-migration`, `code-review-and-quality`, `planning-and-task-breakdown`, `using-agent-skills`. Agents: `code-reviewer`, `security-auditor`, `test-engineer`. |
| Built-ins: `/code-review`, `/simplify`, `/security-review`, `/run`, `/init`, `update-config`, `dataviz`, `claude-api`, `artifact-*` | Claude Code | Review before merge; `/security-review` before M3 and M6; `dataviz` for the price chart; `claude-api` only if an LLM feature is added (for example drafting market rules). |
| Browser tools: `claude-in-chrome`, `browser-use` | MCP | Manual QA of our app; letting REA inspect Kalshi pages the human has open. |
| `ralph-loop@claude-plugins-official` | user-level plugin | Optional long autonomous build runs against a planned task list. |
| `gitkraken-hooks@gitkraken` | user-level plugin | Session tracking only; harmless. |

## OFF for this project (set in `.claude/settings.json`)

| Item | Mechanism | Why |
|---|---|---|
| `academic-research-skills@academic-research-skills` (16 `/ars-*` commands, 3 agents, 4 skills, a session-start hook) | `enabledPlugins: false` | Academic-paper pipeline; no use here and a large context cost every session. |
| `experimental-design`, `research-lookup`, `scientific-critical-thinking`, `scientific-slides`, `scientific-writing`, `statistical-analysis`, `statistical-power` | `skillOverrides: "off"` | The seven science skills still on at user level; irrelevant to a web app. |
| Synced claude.ai skills: `anthropic-skills:academic-paper`, `academic-paper-reviewer`, `academic-pipeline`, `deep-research`, `docx`, `pptx`, `xlsx`, `pdf`, `google-workspace`, `computer-use`, `learn`, `morning`, `import-memory`, `docs` | `skillOverrides: "off"` — **best effort, verify** | Office and academic tooling. The docs do not state whether the `anthropic-skills:` prefix is matched by `skillOverrides`. If they still appear after a restart, open `/skills`, press Space on each to cycle to off, Esc to save; or set `syncClaudeAiSkills: false` in **user** settings (machine-wide, moves synced skills to trash). |
| REA's other skills (`rea-tool-design`, `rea-ci-tests-audit`, `rea-analysis-optimization`, `rea-changelog-update`) | not installed | They exist for developing REA itself. |

Kept on but rarely needed: `anthropic-skills:skill-creator`, `chrome-browser`, `built-in-browser`, `keybindings-help`, `plugin-authoring`, `schedule`, `loop`, `fewer-permission-prompts`.

## When to invoke what, by phase
- **Phase R**: `reverse-engineer-anything` + browser tools → notes in `docs/research/kalshi/`.
- **Spec**: `interview-me` if the ask is fuzzy → `/agent-skills:spec`.
- **Build**: `/agent-skills:plan` → `/agent-skills:build` → `/agent-skills:test`; `source-driven-development` when touching framework APIs.
- **Review**: `/code-review` → `/agent-skills:review`; `/security-review` before M3 and M6.
- **Ship**: `/agent-skills:ship`.
- **Something broke**: `debugging-and-error-recovery`; `/run` to reproduce in the real app.

## Verify after restarting Claude Code in this folder
1. `/status` → "Setting sources" includes project settings.
2. `/plugin` → `academic-research-skills` shows disabled for this project; no "ARS update available" banner at start.
3. `/skills` → `reverse-engineer-anything` listed; science skills hidden.
4. `claude mcp list` (run from this folder) → `rea` present, after `scripts/setup-rea.ps1` has run.
