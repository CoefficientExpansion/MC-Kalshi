# ADR-0004: Spec-driven, test-first, incremental, trunk-based development
Date: 2026-10-28 · Status: Accepted

## Context
Work is done by a human directing Claude Code. The expensive failure modes are (1) building
the wrong thing from an ambiguous ask, (2) subtle money-math or ledger bugs, and (3) large
unreviewable changes. The `agent-skills` plugin already provides a spec → plan → build →
test → review → ship loop.

## Decision
Adopt the loop in `docs/development-model.md`: a short spec with acceptance criteria before
any code; a task plan with verification per task; TDD for engine and ledger code; two review
passes before merge; trunk-based git with short-lived branches, Conventional Commits, squash
merges; ADRs for decisions; milestones R, M0–M6.

## Consequences
- Slower first hour of each feature, faster everything after; every change is small and reviewable.
- Specs and ADRs become the project's memory across Claude Code sessions.
- Engine coverage threshold (95 %) and a ledger invariant job are CI gates, not aspirations.
- Autonomous loops (`ralph-loop`) are allowed only against a planned task list.

## Alternatives considered
- Ad-hoc "just build it" prompting: fast to start, expensive to debug money bugs. Rejected.
- Full Scrum ceremonies: pointless for one person. Rejected.
- Feature branches with a long-lived `develop`: adds merge overhead with no benefit here. Rejected.
