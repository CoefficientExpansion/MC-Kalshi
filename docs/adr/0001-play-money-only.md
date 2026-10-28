# ADR-0001: Play money only; no real-money path, ever
Date: 2026-10-28 · Status: Accepted

## Context
Kalshi is a CFTC-regulated designated contract market. A campus clone taking real money
would be (a) an unregistered event-contract exchange under federal law, (b) unlicensed
wagering under Tennessee law, and (c) a conduct-code problem for a college. The product
goal is engagement and forecasting fun on campus, not money.

## Decision
The platform uses an internal unit, **points**, with no cash value. Points cannot be bought,
sold, transferred between users, or redeemed for anything. There is no payment integration,
no KYC, and no withdrawal concept in the codebase or the UI.

## Consequences
- No payments stack, no money-transmission compliance, no fraud surface around deposits.
- The market maker can be subsidized freely (ADR-0002); the house can absorb losses.
- Leaderboards and bragging rights are the incentive; engagement design matters more.
- UI copy must avoid "bet", "$", "cash out", "wager". Markets on athletics still get a
  policy review because of NCAA wagering rules for student-athletes (architecture §11).
- Prizes or sponsorships for leaderboard winners are a separate decision; if ever proposed,
  write a new ADR and get a legal opinion first.

## Alternatives considered
- Real money with a licensed partner: out of scope, cost, and legal reach for a student project.
- Points purchasable for cash (freemium): creates cash value and reopens every legal issue. Rejected.
