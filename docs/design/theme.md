# Theme: Maryville College visual identity

Status: done (2026-10-29) · Milestone: cross-cutting · Research: none · ADRs: none

This file is both the spec for the theme slice and the design reference every later screen
follows (M2 market list and detail, M3 order ticket, and on). The tokens live in
`apps/web/src/app/globals.css`; this document lists every one of them. Change both together.

## Problem

The M0 hello page used Tailwind's default neutrals. Before real screens arrive in M2, the app
needs one shared visual language that reads as "Maryville College" to students, faculty and
staff, so that M2 and M3 pick colors and type from a fixed set instead of inventing them per
screen. The theme must also settle two product rules early: how YES and NO look (they appear on
every market) and what the copy may and may not say.

## Scope

In:
- Palette as Tailwind v4 `@theme` tokens with light and dark values.
- Fonts: Archivo (body, UI) and Barlow Condensed (headlines) via `next/font/google`.
- YES/NO semantic colors, price chart palette, typography scale, spacing and radius conventions.
- Copy rules and the trademark boundary.
- The hello page restyled with the tokens, copy unchanged.

Out:
- Components (buttons, cards, order ticket). They arrive with shadcn/ui in M2 and must use these tokens.
- A manual light/dark toggle. The theme follows `prefers-color-scheme` only.
- Any college logo, wordmark, seal, bell-tower mark, tartan or athletic mark (see Boundaries).

## Acceptance criteria

- [x] Given the repo, when `npm run build` runs, then it passes (fonts are fetched at build time).
- [x] Given the hello page, when it renders, then it uses the brand tokens: a garnet (`bg-brand`) header band, an orange (`bg-accent`) pill with dark text (`text-on-accent`), a Barlow Condensed (`font-display`) heading and Archivo (`font-sans`) body.
- [x] Given `apps/web/src/app/page.test.ts`, when `npm test` runs, then it passes unchanged (the copy is the same as M0).
- [x] Given `globals.css`, when its `@theme` block is compared with the token tables below, then every token in the file appears here with its light and dark value.

## Data touched

None. No tables, migrations or ledger reasons.

## UX

### Palette

Source: the college's public website stylesheet and the 2021 logo announcement. Values marked
*derived* are not college colors; they were picked for this app so that text stays readable in
dark mode, and are built from the same hues or the same gray family.

Tailwind utility = `bg-<name>`, `text-<name>`, `border-<name>`, and so on (for example `bg-brand`, `text-no`).

#### Brand

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-brand` | `#640A28` garnet | `#640A28` | Dominant brand color. Header bands, brand fills, primary navigation background. |
| `--color-brand-dark` | `#46071C` | `#46071C` | Hover and pressed state of `brand` fills. |
| `--color-brand-ink` | `#640A28` | `#F2A7BC` *derived* | Garnet used as text or thin rules on the page background (headings, links). In dark mode garnet on near-black is unreadable, so it lightens to a garnet tint. |
| `--color-on-brand` | `#FFFFFF` | `#FFFFFF` | Text and icons on `brand` / `brand-dark` fills. |
| `--color-accent` | `#FF6500` orange | `#FF6500` | Accent and primary action fill (main call-to-action button, highlight rules, active tab underline). |
| `--color-accent-dark` | `#BF3C00` | `#BF3C00` | Hover and pressed state of `accent` fills; orange text on light backgrounds. |
| `--color-on-accent` | `#212529` | `#212529` | Text on `accent`, `success` and `warning` fills. Always dark, in both modes. |

#### Status and supporting

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-success` | `#65AA2F` green | `#65AA2F` | Success: market resolved in your favor, saved, confirmed. Fill with `on-accent` text, or icon. |
| `--color-warning` | `#FBC01D` yellow | `#FBC01D` | Warning: market closing soon, low balance. Fill with `on-accent` text, never as text on white. |
| `--color-danger` | `#600015` deep red | `#F28B8B` *derived* | Errors, destructive actions (cancel market, remove). Text or fill; on a dark-mode fill use `on-accent` text. |
| `--color-teal` | `#154440` | `#154440` | Supporting color: secondary fills (info banners with white text), extra chart series. |

#### Surfaces and text

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-background` | `#FFFFFF` | `#14090D` *derived* | Page background. Dark mode is a near-black with a garnet cast. |
| `--color-surface` | `#F8F9FA` | `#21131A` *derived* | Cards, panels, table stripes, the order ticket body. |
| `--color-border` | `#DEE2E6` | `#3A2A31` *derived* | Dividers, card and input borders, chart grid lines. |
| `--color-foreground` | `#212529` | `#F8F9FA` | Body text and headings. |
| `--color-muted` | `#6C757D` | `#ADB5BD` *derived* | Secondary text: timestamps, helper text, axis labels. |

`#343A40` (gray-800 in the college palette) is not a token yet; use it for a secondary dark
surface if a screen needs one, and add a token here first.

#### Market outcomes

| Token | Light | Dark | Role |
|---|---|---|---|
| `--color-yes` | `#1D5FA8` blue | `#5BA3E6` | YES side: buy YES button fill, YES price, YES chart line. |
| `--color-on-yes` | `#FFFFFF` | `#14090D` | Text on a `yes` fill. |
| `--color-no` | `#B0306A` magenta | `#E07AB0` | NO side: buy NO button fill, NO price, NO chart line. |
| `--color-on-no` | `#FFFFFF` | `#14090D` | Text on a `no` fill. |

Why blue and magenta:
- **Not the brand pair.** Garnet and orange already mean "Maryville" and "do this". If YES or NO
  were garnet or orange, every brand surface would look like a trade side and the primary button
  would look like a vote for one outcome. So both are hues the brand does not use.
- **Not green and red.** Green/red is the most common color-vision deficiency failure (about 1 in
  12 men have red-green deficiency), red already means `danger`, and green already means
  `success`; a NO trade is not an error and a YES trade is not a success.
- **Color-blind check.** Simulated with the Machado et al. (2009) matrices at full severity, the
  CIELAB distance between YES and NO (light values) is 64 with normal vision, 28 for
  protanopia, 52 for deuteranopia and 90 for tritanopia; all clearly distinguishable (a distance
  above about 10 reads as a different color). Gold was rejected: it collapses into `accent-dark`
  for protan and deutan viewers (distance about 6). Purple was rejected: it collapses into blue
  for the same viewers (distance about 3).
- **Contrast.** White on `yes` is 6.45:1 and white on `no` is 6.04:1 (both pass WCAG AA for body
  text). As text on white they are 6.45:1 and 6.04:1; on `surface` 6.12:1 and 5.73:1. The dark
  values on `background` are 7.28:1 and 7.05:1.
- **Never color alone.** Every YES or NO element carries the word "YES" or "NO" (button label,
  price chip, chart legend, position row). Color is a second channel, never the only one.

### Contrast notes (WCAG 2.2, computed)

| Pair | Ratio | Verdict |
|---|---|---|
| garnet `#640A28` on white (and white on garnet) | 13.00 | Passes AAA. Garnet text is fine at any size. |
| orange `#FF6500` on white | 2.95 | **Fails**, even for large text (needs 3.0). Never put orange text, or thin orange icons that carry meaning, on a light background. |
| dark text `#212529` on orange | 5.23 | Passes AA. This is how orange buttons work: orange fill, dark label. |
| white on orange | 2.95 | Fails. Never white text on orange. |
| `accent-dark` `#BF3C00` on white (and white on it) | 5.44 | Passes AA. Use it when orange must appear as text on light backgrounds. |
| orange on dark `background` `#14090D` | 6.62 | Passes AA. Orange text is acceptable in dark mode. |
| orange on garnet | 4.40 | Passes only for large text (18.66 px bold / 24 px) and decorative rules. |
| `muted` `#6C757D` on white | 4.69 | Passes AA. |
| `muted` `#6C757D` on `surface` `#F8F9FA` | 4.45 | **Fails** AA for body text. On light `surface`, use `foreground` for anything that must be read; `muted` only for large text there. |
| dark text on `success` / `warning` | 5.39 / 9.30 | Passes AA. |
| white on `teal` | 10.87 | Passes AAA. |
| white on `danger` `#600015` | 13.92 | Passes AAA. |
| `foreground` on `background`, dark mode | 18.54 | Passes AAA. |
| `muted` on `background` / `surface`, dark mode | 9.42 / 8.63 | Passes AAA. |

So orange is for fills with dark text, decorative accents (rules, underlines, focus rings next to
a dark edge) and text on dark backgrounds only. Garnet is safe everywhere on light backgrounds.

### Typography

| Use | Font | Tailwind | Notes |
|---|---|---|---|
| Display (hero, page title) | Barlow Condensed 700 | `font-display text-6xl font-bold uppercase tracking-tight` | Uppercase, tight. One per page. |
| H1 | Barlow Condensed 700 | `font-display text-4xl font-bold` | Market title on detail page. |
| H2 | Barlow Condensed 600 | `font-display text-2xl font-semibold` | Section titles, market card titles. |
| Eyebrow / label | Barlow Condensed 600 | `font-display text-sm font-semibold uppercase tracking-widest` | Category tags, small caps labels. |
| Body | Archivo 400 | `font-sans text-base` | Default for all running text and UI. |
| Lead | Archivo 400 | `text-lg` | Intro paragraph. |
| Small / meta | Archivo 400 | `text-sm text-muted` | Timestamps, helper text. |
| Prices, points, percentages | Archivo 600 | `font-semibold tabular-nums` | Always tabular numerals so columns and live updates do not jitter. Prices show as `62%` or `62 pts`, never with a currency sign. |

Barlow Condensed weights loaded: 500, 600, 700. Archivo is a variable font (all weights). Both
come from Google Fonts through `next/font/google`, which self-hosts them at build time; the
college's own headline face (Knockout) is licensed and is not used. Barlow Condensed is the free
stand-in the college's own site also loads.

### Price chart palette

| Element | Token |
|---|---|
| YES probability line and area | `yes` (area at 10–15% opacity) |
| NO probability line (when shown) | `no` |
| Grid lines, axes | `border` |
| Axis labels, tick text | `muted` |
| Volume bars | `muted` at 40% opacity |
| Your entry price marker, crosshair | `foreground` |
| Market resolved marker | `success` (YES won) or `no` (NO won), always with a text label |
| Extra series (multi-outcome, later) | `yes`, `no`, `teal`, then `accent-dark` |

Never chart with `brand` or `accent` as a data series: they read as chrome, not data.

### Spacing and radius

- Spacing: the default Tailwind 4 px scale. Page gutters `px-6` (mobile) and `px-8` (wide);
  stacks `gap-4`; card padding `p-4`; section padding `py-16`.
- Radius: `rounded-md` for inputs and buttons, `rounded-lg` for cards and the order ticket,
  `rounded-full` for pills, chips and the accent rule.
- Borders: 1 px `border-border`. Garnet header bands are full bleed with no radius.
- Focus: visible 2 px ring; `ring-accent` on dark or garnet backgrounds, `ring-brand-ink` on light ones.

### Copy rules (CLAUDE.md hard constraint 1)

- Never "bet", "$" or "cash out" (the hard rule), and by extension no "wager", "prize" or dollar
  amounts. "Cash" appears only as a denial, as in the M0 line "Play money, no cash, ever."
- Say: points, trade, buy YES, buy NO, sell, position, balance, market, resolves.
- Prices are probabilities or points: "62%", "62 pts per contract". No currency sign anywhere.
- Tone: plain, campus-friendly, short. Sentence case for UI text; uppercase only for eyebrow
  labels and the display heading.
- `page.test.ts` enforces the banned words on the hello page; later pages add the same check.

## Boundaries

- **Trademarks.** The Maryville College name, logo, wordmark, seal, bell-tower mark, tartan and
  athletic marks are trademarks of the college. This app reproduces none of them: the theme uses
  colors, type and tone only. No images, icons or patterns derived from them. The text "Maryville
  College" appears as plain text only, to say whose community the app serves.
- **Unofficial.** MC-Kalshi is an unofficial student project. It must not claim to be endorsed by,
  operated by, or affiliated with the college. A footer note saying so arrives with the first
  real layout (M2).
- **Kalshi.** Only behavior and UX are studied (SOP-03). No Kalshi colors, logos or assets.

### How to apply

- Use the token utilities, never raw hex or Tailwind palette colors (`zinc-500`, `red-600`) in
  components: `bg-brand text-on-brand`, `bg-accent text-on-accent hover:bg-accent-dark`,
  `bg-yes text-on-yes`, `bg-no text-on-no`, `bg-surface border border-border`, `text-muted`,
  `text-brand-ink`, `font-display`, `font-sans`, `tabular-nums`.
- Dark mode is automatic: the raw variables (`--brand`, `--yes`, …) change under
  `prefers-color-scheme: dark` and the `@theme inline` tokens follow, so no `dark:` variants
  are needed for these colors.
- New color? Add the raw variable (light and dark), the `@theme` token, and a row in the tables
  above in the same commit, with its contrast ratio.
- shadcn/ui (M2): map its CSS variables (`--primary`, `--destructive`, …) onto these tokens
  (`--primary` → `accent`, `--destructive` → `danger`) instead of adding a second palette.

## Risks / open questions

- The fonts are fetched from Google Fonts at build time. A build without network access fails;
  acceptable for Vercel and CI.
- The college may object to the color use even without marks. If so, swap the hex values here and
  in `globals.css`; token names stay.
- Dark-mode values marked *derived* have not been reviewed by a human designer.

## Tasks

1. Tokens in `globals.css` — verify by: `npm run build` and the hello page render.
2. Fonts in `layout.tsx` — verify by: headings render in Barlow Condensed in the browser.
3. Restyle `page.tsx`, copy unchanged — verify by: `npm test` (`page.test.ts` unchanged).
4. This document, the spec index row and the README layout line — verify by: token tables match `globals.css`.

## Definition of Done

- [x] Acceptance criteria met and demonstrated (test or screenshot)
- [x] Unit tests for logic; Playwright for any user-visible flow that moves points (none here)
- [x] `npm run typecheck && npm run lint && npm test` green locally and in CI
- [x] No secrets in code; new env vars documented in `.env.example` (none added)
- [x] Docs or ADR updated when behavior or a decision changed
- [ ] Preview deploy checked by a human

## Next

- A human checks the preview deploy in light and dark mode.
- M2: wire shadcn/ui to these tokens and add the "unofficial student project" footer.
