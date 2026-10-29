# M2b — Read-only market pages
Status: in-progress · Milestone: M2 (part b, UI) · Research: docs/research/kalshi/market-page.md, docs/research/kalshi/event-grouping.md · ADRs: 0001, 0003
Integrated onto the M1 engine (main c311323) on 2026-10-29; see docs/specs/m1-engine.md, Ship decision.

## Problem
M2a built the schema, ledger and market read queries, but the app still shows the M0 hello
page. Students need to see what is being traded: a list of open campus markets and a page per
market with the question, the rules in plain English, the current YES/NO price and the dates.
Trading (M3) and sign-in (M2b, separate slice) are not needed to read, so these pages work
logged out and must keep working, and keep the Vercel build green, when `DATABASE_URL` is not set.

## Scope
In:
- `/` market list (server component, dynamic rendering).
  - Open markets first, soonest-closing first, then a "Closed and settled" section (closed,
    resolved, finalized, voided). `proposed` and `rejected` markets are never listed.
  - Filter by category with `?category=<slug>`; category chips (links, `aria-current` on the
    active one) with an "All" chip. A malformed slug is ignored; a well-formed slug that matches
    no category shows an empty state for that category.
  - Card: category eyebrow, title (the single link), YES chance as "NN% chance" with a YES/NO
    split bar (labels in the bar, never color alone), status badge, close time as relative and
    absolute ("Closes in 3 days" and "Nov 12, 2026, 11:59 PM EST").
- `/markets/[slug]` detail (server component, dynamic rendering).
  - Category link, title as H1, status badge, headline "NN% chance", YES and NO prices
    ("62 pts" per contract, from `displayPrice`), rules in plain English, close and resolve-by
    dates, resolution source and outcome when set, and a disabled order-ticket placeholder that
    says trading opens in M3 (below the content on mobile, right column from 1024 px).
  - Unknown slug, or a `proposed`/`rejected` market: 404 page.
- Empty state (no markets) and "database not configured" state (`getDb()` undefined) on both
  routes; they render with HTTP 200 and no crash. A database error renders an "unavailable"
  state instead of a 500 (the error is logged by name only; driver errors can echo the URL).
- Root layout: header band with the wordmark text and an empty `account slot: M2b auth`
  placeholder for the sign-in slice, "Skip to content" link, `<main id="main">`, footer with the
  "unofficial student project" note the theme spec promises.
- Pure view-model code in `apps/web/src/lib/` (price label, relative and absolute dates, status
  badge, category parsing, list building) with Vitest unit tests.

Out: trading and the real order ticket (M3), price chart and "Also trading" block (need
`price_snapshots` data, M3), sign-in and account control (sibling M2b slice), search, series and
event grouping, comments, positions, balances, a live-updating price.

## Acceptance criteria
- [x] Given `DATABASE_URL` is unset, when `npm run build` runs, then it passes and no page touches the database at build time. (run by hand: `/` and `/markets/[slug]` build as dynamic `ƒ` routes; not a test)
- [x] Given no database is configured, when `/` or `/markets/<slug>` renders, then the page shows the "database not configured" state and does not throw. (`app/page.test.ts` > shows the database-not-configured state without throwing; `markets/[slug]/page.test.ts` > shows the not-configured state when there is no database; `server/market-pages.test.ts` > reports an unconfigured database for both loaders; also curl 200 against `next start` with `DATABASE_URL` unset)
- [x] Given a configured database with no public markets, when `/` renders, then it shows the empty state. (`app/page.test.ts` > shows the empty state when there are no markets)
- [x] Given the seeded database, when `/` renders, then every open market appears once as a card with title, category, "NN% chance", and relative and absolute close time, soonest-closing first. (`app/page.test.ts` > lists every seeded market once, soonest-closing first, with chance and close times; `lib/market-list.test.ts` > puts open markets first, soonest closing first)
- [x] Given `?category=weather`, when `/` renders, then only that category's markets appear and its chip is `aria-current="page"`; given a malformed slug it behaves as "All"; given an unknown well-formed slug it shows the empty state for the category. (`app/page.test.ts` > filters by ?category= and marks that chip current; ignores a malformed category and shows everything; explains an unknown category; `lib/market-format.test.ts` > parseCategoryParam)
- [x] Given a seeded slug, when `/markets/<slug>` renders, then it shows title, rules, category, YES and NO prices summing to 100, close date, resolve-by line, status badge, and a disabled order ticket that says trading opens in M3. (`markets/[slug]/page.test.ts` > renders title, rules, category, prices, dates, status and the disabled ticket; shows a settled market's outcome, source and resolution date, and closed ticket copy)
- [x] Given an unknown slug or a `proposed` market, when `/markets/<slug>` renders, then it returns Next's not-found (404). (`markets/[slug]/page.test.ts` > returns Next's not-found for an unknown slug and for a proposed market; `server/market-pages.test.ts` > treats an unknown slug and a proposed market as not found)
- [x] Given closed, resolved (YES and NO), finalized and voided markets, when status is labeled, then each has a distinct text label, and an `open` market past `close_at` reads "Closed". (`lib/market-format.test.ts` > statusBadge: labels an open market, reads Closed for an open market whose close time has passed, gives each settled state its own text)
- [x] Given any rendered page state, when its text is scanned, then it never contains "bet", "$" or "cash out" (page-level copy guard, as the hello page had). (`app/page.test.ts` > never says bet, $, or cash out in any state; `markets/[slug]/page.test.ts` > never says bet, $, or cash out; `lib/copy-guard.test.ts`)
- [x] Given the pages at 390 px and 1280 px, when screenshotted, then there is no horizontal scroll, headings and landmarks are present, and colors come from theme tokens only (screenshot check, light mode). (screenshots at 390 and 1280 px in light and dark, `hscroll=false` on all; seeded-data shots rendered from PGlite views into the built page shell)
- [x] `npm run typecheck && npm run lint && npm test && npm run build` green. (run locally with `DATABASE_URL` unset; CI green on the branch)

## Data touched
Reads only: `markets` joined to `categories` through `listMarkets` / `getMarketBySlug`
(M2a). No migrations, no ledger entries, no writes. One query per request on `/` (all
markets, filtered and grouped in memory; the campus has tens of markets, not thousands) and
one per detail page (`generateMetadata` and the page share it through React `cache`).

## UX
Follows `docs/design/theme.md` (tokens only, YES blue / NO magenta with words, Barlow
Condensed headings, copy rules) and the adopted behavior in
`docs/research/kalshi/market-page.md`: category label → question H1 → headline probability →
rules → dates, ticket as a right card on wide screens. Changes from that note: no chart yet,
no modal, fully readable logged out.

- Prices: "62% chance" for the headline, "62 pts" for per-contract prices. No currency sign.
- Times are shown in `America/New_York` (campus time) with the zone abbreviation, so server
  and viewer agree. Relative text uses `Intl.RelativeTimeFormat`.
- Status badges: Open, Closes soon (open and under 48 h left), Closed, Resolved YES (success
  fill), Resolved NO (NO fill), Final YES / Final NO, Voided. Always a text label.
- Cards are one link (the title, stretched over the card) so each card is one tab stop.

Deviations and decisions recorded while building (2026-10-29):
- Pages are thin: they load data and hand it to pure view components (`components/market/*`), so tests render the real page functions against PGlite by mocking `getDb` (`vi.mock("@/db")`) without a Next runtime.
- `/` loads every market with one `listMarkets(db)` call and filters in memory (`lib/market-list.ts`) instead of using `listMarkets({ categorySlug })`, because the category chips need counts for every category.
- An `open` row whose `close_at` has passed (the close cron lags) is listed under "Closed and settled" and badged "Closed", never as open.
- Relative times switch from days to weeks at 21 days and to months at 60 days.
- "Prices" shows points per contract and states that a contract pays 100 points (architecture §6, resolve).
- Not built: the Kalshi-style "Also trading" block and chart (no data yet), search, and the `/markets` index route (the list lives at `/`).
- `lib/copy-guard.ts` is a test-only helper kept in `lib/` beside the code it guards.
- Verified: build, unit and page tests, screenshots of the unconfigured states against `next start`, and seeded rendering through the same components with PGlite data. Not verified: a real Supabase database, a preview deploy, keyboard-only navigation by hand, screen readers.

## Risks / open questions
- Relative times are computed at request time; a cached/CDN copy would go stale. Pages are
  `force-dynamic`, so they are not cached. Revisit with `revalidate` when traffic warrants.
- Seed `close_at` values are relative to the seed run, so a long-lived preview shows past
  dates and "Closed" labels until reseeded.
- The "database error" state hides the failure from the user; the health route
  (`/api/health`) remains the place to see database status.

## Tasks
1. This spec and its index row — verify by: review.
2. Pure view-model functions in `src/lib`, TDD — verify by: unit tests.
3. Data loaders (`src/server/market-pages.ts`) against PGlite — verify by: loader tests.
4. Components, layout shell, `/`, `/markets/[slug]`, `not-found` — verify by: page tests with PGlite and the copy guard.
5. Build with `DATABASE_URL` unset and screenshot at 390 px and 1280 px — verify by: screenshots.

## Definition of Done
- [ ] Acceptance criteria met and demonstrated (test or screenshot)
- [ ] Unit tests for logic; Playwright for any user-visible flow that moves points (none here)
- [ ] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [ ] No secrets in code; new env vars documented in `.env.example` (none added)
- [ ] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human

## Next
- To reach done: seed `dev`, look at the pages on a Vercel preview at 390 and 1280 px, commit the screenshots, tick the Definition of Done.
- Whether market pages require sign-in (SOP-09) is an owner decision (`docs/owner-todos.md`); `requireUser()` is ready.
- The sign-in slice fills the header's account slot.
- M3: real order ticket, price chart from `price_snapshots`, "Also trading".
