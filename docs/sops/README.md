# Standard operating procedures

One file per procedure. Each has Purpose, Steps, and Checks. Use `documentation-and-adrs`
(agent-skills) to draft a new one; number it next in sequence and add a row here.

| SOP | Use it when | Owner |
|---|---|---|
| [SOP-01 Session start](SOP-01-session-start.md) | Opening any Claude Code session on this repo | developer |
| [SOP-02 Feature workflow](SOP-02-feature-workflow.md) | Any change touching more than one file or user-visible behavior | developer |
| [SOP-03 Studying Kalshi with REA](SOP-03-reverse-engineering-with-rea.md) | A design question that observation of Kalshi's public app can answer | developer |
| [SOP-04 Market lifecycle operations](SOP-04-market-lifecycle.md) | Reviewing proposals, opening, closing, resolving, voiding, disputes | moderators, admins |
| [SOP-05 Release](SOP-05-release.md) | Shipping `main` to production | developer |
| [SOP-06 Incidents and rollback](SOP-06-incident-and-rollback.md) | Wrong balances, auth bypass, data exposure, trading down | developer, admins |
| [SOP-07 Environment and secrets setup](SOP-07-environment-and-secrets.md) | Creating or rotating the Vercel and Supabase environments; onboarding a new machine | developer |
| [SOP-08 Admin operations](SOP-08-admin-operations.md) | Granting roles, point adjustments, suspensions, account removal | admins |
| [SOP-09 Data handling and privacy](SOP-09-data-and-privacy.md) | Deciding what to store or show; answering a data request; policy sign-off | developer, project lead |

Conventions:
- Steps are imperative and numbered; checks are verifiable statements.
- A step that changes production state names its rollback.
- When an SOP references a feature that does not exist yet (for example the `TRADING_PAUSED` flag), the spec that builds it must satisfy the SOP.
