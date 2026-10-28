# Kalshi research notes (Phase R)

Design notes from studying Kalshi's public web app with REA, under the boundaries in
`docs/sops/SOP-03-reverse-engineering-with-rea.md`. We record behavior and vocabulary, never code or assets.

| Note | Question | Status |
|---|---|---|
| _(none yet)_ | | |

Suggested first questions (one note each):
1. `market-page.md` — What does a market page show (prices, chart, rules, dates, volume) and how is it laid out on desktop and mobile?
2. `order-ticket.md` — What inputs does the order ticket take, what does it compute (cost, contracts, average price, payout, fees), and when does it recompute?
3. `portfolio-positions.md` — How are open positions, P&L, and settled markets presented?
4. `market-lifecycle.md` — What statuses does a market show over its life, and what does the UI say at close, settlement, and dispute?
5. `event-grouping.md` — How are series, events, and markets grouped and navigated (categories, tags, search)?

Reference sources that need no reverse engineering:
- Kalshi public API documentation (series / events / markets / orderbook vocabulary).
- Manifold Markets, open source play-money market (AMM, limit-orders-against-AMM, resolution flow).

## Note template
```markdown
# <Topic>
Date: YYYY-MM-DD · Question: …
Pages observed: (public URLs, logged-out unless stated)

## Observed (with REA evidence IDs)
- …

## Inferred
- …

## Unknown / not observed
- …

## Implications for our spec
Adopt: … · Change: … (why; for example "AMM, not order book") · Skip: …
Linked spec: docs/specs/<slug>.md
```
