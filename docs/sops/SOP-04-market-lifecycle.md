# SOP-04: Market lifecycle operations (moderators)

**Purpose**: consistent, auditable handling of every market from proposal to finalization.
**Roles**: member (propose, trade), moderator (open, close, resolve, void), admin (roles, disputes, ledger adjustments).

## 1. Proposal review
- Reject if: real-money implication, targets a named private individual, concerns a student-athlete's individual performance, is unresolvable, or duplicates an open market.
- Edit the rules until a stranger could resolve the market from the stated source. Rules name: the exact source (URL or office), the exact condition, the time zone, and what happens if the event is postponed or cancelled (default: void).
- Set `close_at` before the event starts (for games: tip-off; for announcements: the stated time). Set `b` (default 100; 50 for niche, 200–500 for campus-wide).
- Open it. The audit log records who and when.

## 2. While open
- Do not edit rules after the first trade except to fix a typo that does not change meaning; otherwise void and recreate.
- Watch for abuse: many new accounts trading one market, or a trader with privileged information (an organizer of the event). Flag to admin; trading can be paused by setting `close_at = now()`.

## 3. Close
- Automatic at `close_at`. If the event is delayed, extend `close_at` **before** it passes; if it already passed, leave it closed.

## 4. Resolve
- Resolve only from the source named in the rules. Paste the link or quote as `resolution_source`.
- Choose YES / NO. If the source is ambiguous and the rules do not cover it, **void** instead.
- Payouts post automatically; a 24-hour dispute window starts.

## 5. Dispute
- Any trader may dispute once with a reason. An admin (not the resolving moderator) decides within 48 hours: uphold, flip (reverses and re-pays), or void.
- The decision note is public on the market page.

## 6. Finalize
- Automatic after the window with no open dispute. Finalized markets are immutable.

## Checks
- Every action appears in `audit_log` with the actor.
- The ledger invariant job is green the morning after any resolution or void.
