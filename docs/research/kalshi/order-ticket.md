# Order ticket
Date: 2026-10-28 · Question: What inputs does the order ticket take, what does it compute (cost, contracts, average price, payout, fees), and when does it recompute?
Pages observed (public, logged out, REA launch-mode Chrome, 1280×720):
- `https://kalshi.com/markets/kxwarming/global-warming/kxwarming-50` — accessibility: `ev_4953fe841a968bafb3bfee24756c6cb02326aae77c76b9421e7efa32891f5556`; screenshot: `ev_06b8779e2588e47819ec9a76ef901beda4632a239bc778061ef29d625e373477`
- Same page after REA performed one declared action, `fill` of the amount box with `10` (no submit, no account): `ev_4c88f96216767740856541d74cfb72f1956cb07eb0a34437bb5c0fbf9243de50`
- `https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26oct29` — `ev_5392c808bfb7638261ec3ac55d8000546b627fd890398adb097a9cca7aa2ca74`

## Observed
- **Placement**: a card in the right column on desktop, beside the main column (title, chart, rules). It is the last interactive region in the accessibility tree before the footer.
- **Structure, top to bottom**:
  1. Tabs `BUY` (selected) | `SELL`.
  2. A unit dropdown button labelled `DOLLARS ▾`.
  3. Series thumbnail + market title (on the multi-market event: the selected bucket's label, `66° or below`).
  4. A two-segment pill: `YES 68¢` (pressed, green) | `NO 34¢`. On the weather bucket: `YES 26¢` | `NO 75¢`.
  5. A small link-style button `3.5% Interest`.
  6. One input labelled `Dollars`, `$` prefix, placeholder `0`.
  7. Row `Odds ⓘ` … `70% chance` (weather bucket: `27% chance`).
  8. Row `Max payout` with the date beneath (`Dec 31, 2049`; weather: `Oct 30, 2026`) … `$0`.
  9. Full-width green button `Sign up to trade` (logged out).
- **After typing 10** (fill action, step completed): the input shows `$10`; `Max payout` changed to `$14.38`; `Odds` stayed `70% chance`; YES/NO prices unchanged; no contract count appeared.
- **Prices do not sum to 100**: `YES 68¢ + NO 34¢ = 102¢`; `26¢ + 75¢ = 101¢`. The page header shows a different number again: `65.9% chance ▼ 19.8` (the change is for the selected chart range, `ALL`).
- Sign-up modal (`Continue with Google / Apple / Sign up with Email`) overlays the page for logged-out visitors; the ticket is still interactive underneath.

## Inferred
- **Fees explain the payout**: Kalshi's published trading fee is about `0.07 × contracts × P × (1 − P)` per side, rounded up (fee schedule page linked in the footer, not fetched). At `P = 0.68` that is `$0.0152` per contract; `$10 ÷ (0.68 + 0.0152) = 14.38` contracts, each paying `$1` → `Max payout $14.38`. The match is exact, so in Dollars mode **Max payout = contracts affordable after fees × $1**.
- **`Odds` is the break-even probability including fees**: `$10 ÷ 14.38 = 69.5¢` per contract → `70% chance`. That is why it differs from the `68¢` button.
- The `YES`/`NO` buttons show the best ask on each side (the price you pay to buy that side); the header's `65.9%` is a last-trade or mid price. Which one is not established.
- `DOLLARS ▾` toggles to a contracts-denominated input; `SELL` needs a position; both are unexercised.
- Signed in, the green button presumably becomes `Buy Yes` / `Buy No` with a confirmation step (not observed).

## Unknown / not observed
- Contracts mode, the Sell tab, limit-order entry (possibly under the collapsed "Order book"), the confirmation and receipt, and what happens to `Odds` when the price moves while an amount is entered.
- Mobile placement of the ticket (see `market-page.md`).

## Implications for our spec
- **Adopt** the card: Buy/Sell tabs, YES/NO pill with the price in each segment, one amount input with a unit toggle (`Points` | `Contracts`), result rows, one full-width CTA. Keep the `ⓘ` explainer on the odds row.
- **Adopt** "Max payout" semantics (contracts × 100 points) and show the resolve-by date beneath it, but label it `Payout if YES` / `Payout if NO` to match the selected side.
- **Change for the AMM**: our price moves with order size, so the rows are `Avg price 51¢ · Contracts 9.75 · Payout if YES 976 pts · New price 52¢`. Kalshi does not need "new price" because an order book quote is fixed; we do, and it doubles as the slippage warning (highlight when the move exceeds 5 points).
- **Change**: no fees and no interest row; our YES and NO prices always sum to 100 (`p` and `1 − p`), so "Odds" is just the average price; show it once as `Avg price 51¢ (51% to break even)`.
- **Change**: no sign-up modal on first visit; prompt for sign-in only when the CTA is pressed.
- **Behavior**: recompute on every keystroke with the pure engine on the client (debounced ~150 ms) for display; the server recomputes at submit and rejects if the price moved beyond the slippage tolerance (architecture §5).
- **Sell tab (M3)**: shows contracts held on each side; the amount box takes contracts to sell; rows become `Avg price · Proceeds · New price`.
Linked spec: docs/specs/m3-trading.md (to be written)
