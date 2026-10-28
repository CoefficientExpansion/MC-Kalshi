# SOP-02: Feature workflow (spec → plan → build → review → ship)

**Purpose**: land one vertical slice with tests, review, and a preview deploy.
**Applies to**: any change touching more than one file or any behavior users see.

## Steps
1. **Spec** — `/agent-skills:spec`. Save as `docs/specs/<slug>.md` using the template in `docs/specs/README.md`. If the ask is vague, run `interview-me` first. Acceptance criteria must be testable sentences.
2. **Plan** — `/agent-skills:plan`. Append the ordered task list to the spec; each task names its verification (test file, command, or screenshot).
3. **Branch** — `git switch -c feat/<slug>` from an up-to-date `main`.
4. **Build, task by task** — `/agent-skills:build`. For engine/ledger code: `/agent-skills:test` first (failing test), then implement, then refactor. One Conventional Commit per task when the human asks to commit.
5. **Local gate** — `npm run typecheck && npm run lint && npm test`. Fix before continuing.
6. **Review** — `/code-review` for bugs; `/agent-skills:review` for the five axes. Engine, resolution, or void changes also get a `doubt-driven-development` pass. Record accepted findings and fixes in the spec.
7. **Ship** — `/agent-skills:ship`. Confirm the Vercel preview by hand (trade loop or the changed screen). Update docs/ADR if behavior or a decision changed.
8. **Merge** — squash-merge to `main`; delete the branch; mark the spec `done`.

## Checks
- Definition of Done in `docs/development-model.md` is fully ticked in the spec.
- No new env var without an `.env.example` line.
- No commit message with Claude attribution lines.
