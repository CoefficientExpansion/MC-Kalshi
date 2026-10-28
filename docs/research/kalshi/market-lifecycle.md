# Market lifecycle: open, close, settle, pay out
Date: 2026-10-28 · Question: What states does a market pass through and what does the UI say about open, close, settlement and payout?
Pages observed (public, logged out, REA launch-mode Chrome, no clicks):
- `https://kalshi.com/markets/kxwarming/global-warming/kxwarming-50` — Evidence `ev_4953fe841a968bafb3bfee24756c6cb02326aae77c76b9421e7efa32891f5556`
- `https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26oct29` — Evidence `ev_5392c808bfb7638261ec3ac55d8000546b627fd890398adb097a9cca7aa2ca74`
- Public API field list from `GET /trade-api/v2/markets?limit=3` (2026-10-28)

## Observed
- **"Timeline and payout" block** (collapsible button, then text), long-dated market: `Market open Jun 5, 2025 · 12:45pm EDT · Market closes After the outcome occurs · Projected payout 30 minutes after closing · This market will close and expire early if the event occurs. Otherwise, it closes by Dec 31, 2049 at 11:59pm EST.` followed by the three tickers.
- Same block, daily weather market: `Market open Oct 28, 2026 · 10:00am EDT · Market closes After the outcome occurs · Projected payout 5 minutes after closing · The Last Trading Time will be 11:59 PM local time on October 29, 2026 regardless of any data releases or events occurring. Expiration will occur on the sooner of the first 7:00 or 8:00 AM ET following the release of the data for October 29, 2026, or one week after October 29, 2026. Otherwise, it closes by Oct 30, 2026 at 1:00am EDT.`
- **Event start countdown** on the weather event: `Begins in 6h 27m 19s · Oct 29, 12:00am EDT`.
- **Rules block** ("Market Rules" + the market's label): `Resolves Yes if the annual global mean surface temperature anomaly has reached or exceeded +2.0°C … in any calendar year before Jan 1, 2050. Outcome verified from` NASA GISS, NCEI, Berkeley Earth, "1 other" (links) + `At least two of the Source Agencies must report that we have hit the 2.0°C threshold.` Weather: `Resolves Yes if the maximum temperature recorded at New York City (CLINYC) for Oct 29, 2026, is less than 67° fahrenheit according to The Weather Company. Outcome verified from The Weather Company.` plus a "Not all weather data is the same" explainer and a "Reading weather data" list. Buttons: `View full rules`, `Help center`, `Report Insider Trading`.
- **Fallback clause** ("Important information"): if the source publication has a material error, expiration may be held for a revision or until the Expiration Date; if no data is available, `all markets will resolve to the last fair price determined by Kalshi`.
- **Insider-trading block**: a collapsible "Insider trading is prohibited" with two list items (source-agency employees; holders of material non-public information).
- **Header state**: a large animated probability ("chance", with a change arrow), chart with `6H / 1D / 1W / 1M / ALL` ranges, `$21,274 vol`, a collapsed "Order book" section.
- **API fields that encode lifecycle**: `status` (observed value `active`), `open_time`, `close_time`, `expiration_time`, `expected_expiration_time`, `latest_expiration_time`, `can_close_early`, `settlement_timer_seconds`, `result`, `expiration_value`, `is_provisional`.

## Inferred
- Lifecycle on Kalshi: open for trading → close (last trading time, or early when the outcome occurs) → expiration/settlement when source data is published → payout minutes later. Status names beyond `active` (for example settled) come from Kalshi's public API docs, not from these captures.
- There is no user-facing dispute flow; the exchange keeps discretion over errors and announces it in the rules text.

## Unknown / not observed
- How a closed or settled market page looks (result banner, disabled ticket, "Settled YES" label).
- Whether users get a notification at settlement.

## Implications for our spec
- **Adopt** the "Timeline and payout" block as a standard market-page section: opened, closes (with the early-close rule when the event can occur early), projected payout timing, and the market identifier. Ours shows `Opens · Closes · Resolves by · Payout: within 1 hour of resolution, after a 24 h dispute window`.
- **Adopt** the rules pattern as a form, not free text: `Resolves YES if <condition> according to <source link>. If <edge case>, <fallback>.` SOP-04 already requires source, condition, time zone, and postponement handling; the form enforces it.
- **Adopt** the event-start countdown for markets tied to a scheduled event (game time, ceremony).
- **Change**: replace "Insider trading is prohibited" with a plain "Who may not trade this market" list (event organizers, officials, anyone who decides the outcome), enforced by moderators per SOP-04.
- **Change**: our `voided` status replaces Kalshi's "resolve to last fair price" fallback; play money makes a refund the fair outcome.
- **Add** (not on Kalshi): a visible dispute window and decision note on resolved markets.
Linked spec: docs/specs/m4-market-lifecycle.md (to be written)
