# SOP-01: Starting a work session

**Purpose**: every Claude Code session starts with the same context so work continues where it left off.

## Steps
1. Open Claude Code **from the project root** (`C:\Users\moemy\Documents\MC-Kalshi`). Project skills and settings load only from the starting directory.
2. Confirm config: `/status` lists project settings; the "ARS update available" banner is gone. If `rea` tools are expected and missing, see SOP-03 §Setup.
3. Read `CLAUDE.md`, then the active spec in `docs/specs/` (the one whose status is `in-progress`), then `git log --oneline -10`.
4. State the goal for the session in one sentence and which SOP applies (02 feature, 03 research, 05 release, 06 incident).
5. Run `npm test` once the app exists, so the session starts from a known-green state.

## Ending a session
- Update the spec's task checklist and status.
- Leave the branch in a state that builds; note anything unfinished at the bottom of the spec under "Next".
- Do not commit unless asked; say what is uncommitted.
