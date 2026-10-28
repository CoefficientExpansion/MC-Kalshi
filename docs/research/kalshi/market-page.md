# Market page
Date: 2026-10-28 · Question: What does a market page show (prices, chart, rules, dates, volume) and how is it laid out on desktop and mobile?
Pages observed (public, logged out, REA launch-mode Chrome):
- `https://kalshi.com/markets/kxwarming/global-warming/kxwarming-50` — desktop 1280×720 accessibility `ev_4953fe841a968bafb3bfee24756c6cb02326aae77c76b9421e7efa32891f5556`, desktop screenshot `ev_06b8779e2588e47819ec9a76ef901beda4632a239bc778061ef29d625e373477`, mobile 390×844 (DPR 2) accessibility + screenshot `ev_b286b5137d3d200f0294a2da8a7dccb814558f0b12b9ce5e09100e86166ee768`
- `https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26oct29` — desktop accessibility `ev_5392c808bfb7638261ec3ac55d8000546b627fd890398adb097a9cca7aa2ca74`

## Observed: desktop (1280 px)
- **Frame**: top bar with logo, `MARKETS · INVEST · LIVE 151 · PRO · MORE ▾`, a search box "Trade on anything", `Log in` / `Sign up`; a second row of category chips. Below, **two columns**: a main column (about two thirds) and a right card (about one third) holding the order ticket (see `order-ticket.md`).
- **Main column, top to bottom**:
  1. Series thumbnail, small-caps category label `CLIMATE CHANGE` (a breadcrumb link to `/category/climate/climate-change`), the question as H1.
  2. Headline probability `65.9% chance` with a change indicator `▼ 19.8` (red) and an `ⓘ` icon; the digits are animated (odometer) in the accessibility text.
  3. A line chart (red line, dotted gridlines) with month labels on the x-axis (`Jun 2025 … Oct 2026`) and percentages on the right y-axis (`37.5% … 87.5%`); `$21,274 vol` under the chart; range buttons `6H · 1D · 1W · 1M · ALL` (ALL pressed).
  4. `Order book ⓘ` — a collapsed disclosure.
  5. `Market Rules` with the market label (`Before 2050`), the rules sentence with source links, a one-line condition (`At least two of the Source Agencies …`), and buttons `View full rules · Help center · Report Insider Trading`.
  6. `Timeline and payout` — collapsed disclosure (contents in `market-lifecycle.md`).
  7. `Insider trading is prohibited` — collapsed disclosure with a two-item list.
  8. `People are also trading` — three related-market cards with series images + `Show more`.
  9. `Event discussion` tabs `Social` (selected) / `Activity`; a composer (`What's on your mind?`, `GIF`, `Add a position`, `Post` disabled); posts show the author, date, and the author's position (`Yes · Before 2050`) with Like / Reply / Bookmark / Share.
  10. `More Climate and Weather Markets` region: a "Trending" list and an "All … markets" hub link.
  11. Footer: `New markets`, `Related markets`, `Related topics` (sub-categories), `Sports` links, then the legal footer and risk disclosure.
- **Logged-out overlay**: a `Create your account` modal (`Continue with Google · Continue with Apple · Sign up with Email`, `Log in`) opens on load over the page and can be closed.
- **Multi-market event page** differs in the main column only: instead of one headline probability and chart, a `Chance` column header and one row per bucket (`66° or below · 26% ▼ 4 · Yes 26¢ · No 75¢` …), a `Switch event` button, a `Begins in 6h 27m 19s · Oct 29, 12:00am EDT` line, a `Show live chat` button, an `Important information` paragraph, rules for the selected bucket, and a social-feed scope toggle `This event · All`.

## Observed: mobile (390 px)
- Nav collapses to logo, a menu button, `Log in`, `Sign up`; the category chips become a horizontally scrolling row.
- Category label, H1, `65.9% chance ▼ 19.8` and the chart stack full-width in the same order as desktop.
- **The ticket card is gone.** Right after the chart's range buttons the tree has `button "Yes 68¢"` and `button "No 34¢"` (lines 64–65 of the mobile tree); no `Buy/Sell` tabs, amount box or `Sign up to trade` button exist anywhere on the page.
- The sign-up modal is a bottom sheet with a drag handle covering the lower half of the screen.

## Inferred
- On mobile, tapping `Yes`/`No` opens the ticket as a bottom sheet, the same presentation the sign-up modal uses. Not exercised.
- The red chart line and `▼` indicate the change over the selected range (`ALL`); the colour likely flips to green when positive.
- The headline `65.9%` is a last-trade or mid probability; the ticket's `68¢` is the ask (see `order-ticket.md`).

## Unknown / not observed
- Chart hover tooltip, the expanded `Order book`, the `Activity` tab, a signed-in page (does a position summary appear under the chart?), dark mode, tablet widths between 390 and 1280 px.

## Implications for our spec
- **Adopt the skeleton and section order**: category label → question H1 → headline probability with change → chart with range buttons and volume → rules (with source links) → timeline and payout → related markets. Ticket as a right card at ≥ 1024 px; on narrower screens, `Yes`/`No` buttons under the chart open a bottom-sheet ticket.
- **Adopt** the rules presentation: one sentence `Resolves YES if … according to <source>` with the source as a link, then `View full rules`.
- **Adopt** the social-proof block `People are also trading` as "Also trading" (same category, open, by volume).
- **Change**: default chart range `1W` (campus markets are short-lived), ranges `1D · 1W · ALL`; chart from `price_snapshots`; "volume" shown as points traded.
- **Change**: no modal on load; the page is fully readable logged out and sign-in is requested only on Buy.
- **Add**: a status chip next to the title (`Open · closes Sat 2:00 PM`, `Closed`, `Resolved YES · dispute window until …`, `Voided`), and a "Who may not trade" line in the rules.
- **Skip**: order book, insider-trading section, social feed, live chat, calendar/LIVE, INVEST/PRO.
Linked spec: docs/specs/m2-markets-browse.md and docs/specs/m3-trading.md (to be written)
