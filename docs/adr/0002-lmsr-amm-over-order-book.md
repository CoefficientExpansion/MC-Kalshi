# ADR-0002: LMSR automated market maker instead of a Kalshi-style order book
Date: 2026-10-28 · Status: Accepted

## Context
Kalshi prices contracts with a central limit order book: traders post bids and asks and
the market crosses them. That works with thousands of participants per market. Maryville
College has about 1,100 students; a typical campus market might see a few dozen traders.
A thin order book shows no price or a 20-point spread, which kills the product on day one.
Points are free (ADR-0001), so subsidizing liquidity costs nothing real.

## Decision
Use Hanson's **Logarithmic Market Scoring Rule (LMSR)** with two outcomes as the only
trading mechanism. Each market has a liquidity parameter `b` (default 100 contracts). The
engine is a pure TypeScript package exposing `quote`, `fill`, `contractsForBudget`,
`probability`, and `voidRefunds`. The UI still looks like Kalshi (YES/NO prices 1–99,
contracts, average price, payout), but every fill is against the AMM.

## Consequences
- Every market has a price from the first second; any trade size fills.
- Bounded pool loss of `100·b·ln 2` points per market; the house account absorbs it.
- Large trades move the price a lot at low `b`; moderators tune `b` per market.
- Fractional contracts exist; cost rounding always favors the pool.
- Limit orders are not supported in MVP. If demanded, add "limit orders filled against the
  AMM when the price crosses" (as Manifold does) in a later ADR; it does not require an order book.

## Alternatives considered
- Central limit order book (Kalshi/Polymarket): no counterparties at campus scale. Rejected for MVP.
- Constant-product AMM (Uniswap-style, used by Manifold's early versions): works, but prices can
  pin near 0/100 with uneven pools and liquidity math is less intuitive to explain. LMSR's bounded
  loss and closed-form budget inversion are cleaner.
- Parimutuel pools: no live price until close; less engaging. Rejected.
