# Feature specs

One file per vertical slice: `docs/specs/<slug>.md`. Written before code (SOP-02). Status in
the header: `draft` → `in-progress` → `done` (or `dropped`).

| Spec | Milestone | Status |
|---|---|---|
| [m0-scaffold.md](m0-scaffold.md) | M0 | done |
| [../design/theme.md](../design/theme.md) | cross-cutting | done |

## Template
```markdown
# <Feature title>
Status: draft · Milestone: M? · Research: docs/research/kalshi/<note>.md (if any) · ADRs: 000?

## Problem
One paragraph: who needs what and why now.

## Scope
In: bullet list of behaviors.
Out: what this slice deliberately does not do.

## Acceptance criteria
- [ ] Given … when … then … (each one testable)

## Data touched
Tables/columns read and written; new migrations; ledger reasons used.

## UX
Screens or components; link to a sketch or a Kalshi research note for the pattern we adopt.

## Risks / open questions

## Tasks (from /agent-skills:plan)
1. … — verify by: …

## Definition of Done
(copy from docs/development-model.md)

## Next
Anything unfinished at the end of a session.
```
