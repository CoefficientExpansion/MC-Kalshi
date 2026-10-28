# SOP-03: Studying Kalshi with REA (Phase R)

**Purpose**: turn observations of Kalshi's public web app into design notes that feed our specs,
with evidence, within clear ethical and legal boundaries.
**Time-box**: two sessions total for Phase R. Research is a means; the product is the goal.

## Boundaries (non-negotiable)
- Observe **public pages and the behavior visible to a normal user**. Never bypass authentication, rate limits, or bot protection; never automate account creation or log-in.
- No bulk scraping. A handful of pages per question, by hand or via a single recorded scenario.
- Never copy Kalshi code, CSS, images, logos, or copy text into this repo. We copy *ideas*: layout, flow, terminology, data shapes.
- Prefer public documentation first: Kalshi's public API docs describe series, events, markets, and order books and are the cleanest source for data-model vocabulary. Manifold Markets is open source and play-money; read its source for AMM and lifecycle ideas instead of inferring them from a closed app.
- Every note separates **observed** (with evidence IDs), **inferred**, and **unknown**, as the REA skill requires.

## Setup (once)
1. Node ≥ 24.22.1 (`node --version`). Upgrade: `winget upgrade OpenJS.NodeJS.LTS`, then open a new terminal.
2. `powershell -ExecutionPolicy Bypass -File scripts\setup-rea.ps1` from the repo root.
3. Restart Claude Code from the root; confirm `rea` tools are listed. Do **not** run `rea setup`.
4. Fallback if the npm package is unavailable: in `rea/`, `npm ci && npm run build:cached`, then register `rea\scripts\rea.mjs` with the same `claude mcp add --scope local` command the script uses.

## Steps per research question
1. Write the question at the top of a new note `docs/research/kalshi/<topic>.md` (template in that folder's README). Good questions: "What does the order ticket show and when does it recompute?", "What states does a market pass through and what does the UI show in each?", "How are positions and P&L presented?"
2. The human opens the relevant public Kalshi page in Chrome. In Claude Code, use the REA skill: `list_browser_targets` → `inspect_web_page` (structure, text) → `capture_web_screenshot` (layout). For network shapes, the human exports a HAR from DevTools for that page only; analyze with `inspect_web_network_capture`. Use `capture_browser_scenario` only for read-only clicks the human asks for.
3. Record observations with REA evidence IDs; add inferences and unknowns separately.
4. Write "Implications for our spec": what we adopt, what we change (for example "AMM instead of order book, so the ticket shows average price, not a limit price"), what we skip.
5. Link the note from the spec that uses it.

## Outputs
- `docs/research/kalshi/<topic>.md` per question; an index line in that folder's README.
- No raw captures committed. Keep HAR files out of git (they can contain cookies); store them outside the repo.
