# Kalshi research notes (Phase R)

Design notes from studying Kalshi's public web app with REA, under the boundaries in
`docs/sops/SOP-03-reverse-engineering-with-rea.md`. We record behavior and vocabulary, never code or assets.

| Note | Question | Status |
|---|---|---|
| [market-page.md](market-page.md) | What a market page shows and how it is laid out on desktop and mobile | done 2026-10-28 |
| [order-ticket.md](order-ticket.md) | Ticket inputs, what it computes (fees, payout, odds), when it recomputes | done 2026-10-28 |
| portfolio-positions.md | Open positions, P&L, settled markets | not started: needs a signed-in page the human opens (REA connect mode); logged-out observation cannot reach it |
| [market-lifecycle.md](market-lifecycle.md) | Statuses over a market's life; open/close/settlement/payout copy | done 2026-10-28 (closed/settled page not observed) |
| [event-grouping.md](event-grouping.md) | Series → event → market hierarchy, URLs, navigation, API vocabulary | done 2026-10-28 |

Evidence files: REA captures are retained in the MCP session and were saved locally under the session's `tool-results` folder (not committed). Screenshots used for the notes are in the session scratchpad; nothing from Kalshi is copied into this repo.

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
