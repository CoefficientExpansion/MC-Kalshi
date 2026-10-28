# Event grouping: series → event → market
Date: 2026-10-28 · Question: How are series, events, and markets grouped, named, and navigated?
Pages observed (public, logged out, REA launch-mode Chrome, no clicks):
- `https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26oct29` (multi-market event) — Evidence `ev_5392c808bfb7638261ec3ac55d8000546b627fd890398adb097a9cca7aa2ca74`
- `https://kalshi.com/markets/kxwarming/global-warming/kxwarming-50` (single-market event) — Evidence `ev_4953fe841a968bafb3bfee24756c6cb02326aae77c76b9421e7efa32891f5556`
- Public API `GET /trade-api/v2/events?with_nested_markets=true&series_ticker=KXHIGHNY` and `GET /trade-api/v2/markets?limit=3` (one request each, 2026-10-28)

## Observed
- **Three-level hierarchy, shown verbatim in the "Timeline and payout" block**: `Series KXHIGHNY · Event KXHIGHNY-26OCT29 · Market KXHIGHNY-26OCT29-T67`. For a one-outcome question the event and market share a ticker: `Series KXWARMING · Event KXWARMING-50 · Market KXWARMING-50`.
- **URL shape**: canonical `/markets/{series}/{series-slug}/{event-ticker}` (lowercase). Short forms redirect to it: the scenario started at `/events/kxhighny-26oct29` and ended at the canonical URL (step 0 `after_url`, both captures). A `/markets/{TICKER}` form is indexed by search engines (not observed here).
- **Event page lists one row per market**: heading with the bucket label (`66° or below`, `67° to 68°`, …), a probability with a change indicator (`26% ▼ 4`, `22% ▲ 10`), and two buttons `Yes 26¢` / `No 75¢`. Buckets under 1 % show `<1%`, `Yes 1¢`, and a `No` button with no price.
- **Event metadata on the page**: breadcrumb `Daily temperature` (under Climate), a `Switch event` button (sibling dates in the series), a `Begins in 6h 27m 19s · Oct 29, 12:00am EDT` countdown, `Note: this event is mutually exclusive.`, and `Show live chat`.
- **Navigation**: top chips `Trending, Midterms, Elections, Politics, Sports, Culture, Crypto, Commodities, Climate, Economics, Mentions, Finance, Tech & Science` linking to `/category/<slug>`; a search box labelled "Trade on anything"; a `LIVE 151` link to `/calendar`.
- **Related-content blocks**: "People are also trading" (3 links + Show more), "More Highest temperature in NYC markets" (same series, other date), "Trending Climate and Weather markets", "Related topics" (sub-categories), "New markets" footer list.
- **API vocabulary** (field names from the public API responses): event `event_ticker, series_ticker, title, sub_title, category, mutually_exclusive, strike_date, strike_period, settlement_sources, markets[]`; market `ticker, event_ticker, title, yes_sub_title, no_sub_title, status, market_type ("binary"), open_time, close_time, expiration_time, rules_primary, rules_secondary, yes_bid_dollars, yes_ask_dollars, no_bid_dollars, no_ask_dollars, last_price_dollars, volume_fp, open_interest_fp, result, can_close_early, settlement_timer_seconds`.
- **Calls the web app makes** (network metadata only, 8 s window): `GET api.elections.kalshi.com/trade-api/v2/events/` (12–13×), `/series/` (4–8×), `/search/series` (4×), `/cached/markets_by_ticker/{ticker}` (4×), `/cached/events/` (2–3×), `/markets/order_books` (3×), `/social/timeline`, `/incentive_programs/`, `/keywords/`. The site itself is a Next.js app (`/_next/static/immutable/chunks/*.js`) served with Vercel insights.

## Inferred
- A **series** is a recurring question template (daily NYC high, "hottest month"); an **event** is one instance (a date, a game); a **market** is one binary YES/NO outcome inside the event. Rules text is templated at series level with event-specific values filled in.
- "Mutually exclusive" means exactly one market in the event resolves YES, which is why the row probabilities roughly sum to 100 %.
- The order book is polled roughly every 3 s while a page is open (3 calls in an 8 s window; initiators not observed).

## Unknown / not observed
- The `/browse` and `/category/*` page layouts; how "Trending" is ranked; the mobile navigation.
- Whether the three-level hierarchy is exposed anywhere besides the Timeline block and the API.

## Implications for our spec
- **Adopt** the vocabulary: `category → (optional) series → event → market`. MVP keeps the data model as `Category → Market` (architecture §4) but names slugs and tickers so an event/series layer can be added without renaming: `market.slug` like `scots-vs-berry-2026-11-07` and a nullable `series_key` ("scots-football-home-game").
- **Adopt** the row pattern for a future multi-outcome event: label, probability with change arrow, YES/NO buttons; `<1%` display floor; a "Switch event" control for recurring series.
- **Adopt** category chips as the top-level nav (Athletics, Campus Life, Academics, Weather, Dining, Student Gov) and a "People are also trading" block (same category, open, highest volume).
- **Change**: no series images or live chat in MVP; no search until there are more than ~50 markets.
- **Skip**: incentive programs, social timeline, calendar/LIVE.
Linked spec: docs/specs/m2-markets-browse.md (to be written)
