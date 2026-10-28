# SOP-03: Studying Kalshi with REA

**Purpose**: turn observations of Kalshi's public web app into design notes that feed our specs,
with evidence, within clear ethical and legal boundaries.
**Status**: Phase R ran on 2026-10-28 (four notes in `docs/research/kalshi/`). Use this SOP for
follow-up questions; each follow-up is time-boxed to one session.

## Boundaries (non-negotiable)
- Observe **public pages and the behavior visible to a normal user**. Never bypass authentication, rate limits, or bot protection; never automate account creation or sign-in. If a challenge page appears ("Just a moment", "verify you are human"), stop and use route B or public docs.
- No bulk scraping: a handful of pages per question. Prefer Kalshi's public API docs for data vocabulary and Manifold Markets' open-source code for AMM and lifecycle ideas.
- Never copy Kalshi code, CSS, images, logos, or copy text into this repo. Notes quote short UI labels and rule sentences only as needed to describe behavior.
- Allowed interactions in a scenario: waiting, `fill` into a logged-out form field, `click` on a disclosure or tab that only changes what is displayed. Not allowed: anything that submits, posts, signs in, or changes state on Kalshi's side.
- Every note separates **observed** (with REA evidence IDs), **inferred**, and **unknown**.

## Prerequisites (done once)
`scripts/setup-rea.ps1` has run; `claude mcp list` from the repo root shows `rea`; Claude Code was started from the repo root so the project skill loads. Do not run `rea setup`.

## Route A: launch mode (proven 2026-10-28)
REA opens its own temporary Chrome (visible window, throwaway profile, cleaned up afterwards). Plain fetchers get HTTP 429 from kalshi.com; a real Chrome does not.

1. **Write the question** at the top of a new note `docs/research/kalshi/<topic>.md` (template in that folder's README).
2. **Find the page**: query the public API, then use the short link which redirects to the canonical URL.
   ```text
   GET https://api.elections.kalshi.com/trade-api/v2/events?status=open&limit=3&with_nested_markets=true&series_ticker=KXHIGHNY
   https://kalshi.com/events/<event-ticker>   →   /markets/<series>/<slug>/<event-ticker>
   ```
3. **Capture** with `capture_browser_scenario`. Desktop baseline:
   ```json
   {
     "browser": { "mode": "launch", "executable_path": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "headless": false },
     "start_url": { "url": "https://kalshi.com/events/kxwarming-50" },
     "actions": [ { "step_id": "settle", "action": "wait_for_timeout", "duration_ms": 8000 } ],
     "capture": { "at_end": ["accessibility", "screenshot", "url"] },
     "command_timeout_ms": 60000
   }
   ```
   - Mobile: add `"environment": { "viewport": { "width": 390, "height": 844, "device_scale_factor": 2 }, "locale": "en-US", "timezone": "America/New_York", "color_scheme": "light", "reduced_motion": "reduce", "service_workers": "block" }`.
   - Endpoints: add `"events": ["network"]` to `capture` (metadata only; never `response_body` or `header_values` on Kalshi).
   - A read-only interaction, for example typing an amount: insert `{ "step_id": "type-amount", "action": "fill", "timeout_ms": 15000, "locator": { "kind": "css", "selector": "input[placeholder=\"0\"]" }, "value": { "source": "literal", "value": "10" } }` followed by a 2500 ms `wait_for_timeout`. Give every step a `timeout_ms` or duration.
4. **Read the result.** It exceeds the inline limit and is saved as JSON under the session's `tool-results` folder (the tool reply names the path). Run:
   ```text
   python -I -X utf8 scripts/rea-probe-capture.py <saved.json> <label> --out <scratchpad>
   ```
   It prints the evidence ID, step statuses, final URL, bot-check markers, and request templates, and writes `<label>-accessibility.txt` and `<label>.png`. Read the text file and the PNG with the Read tool. Use `-X utf8`; `-I` ignores `PYTHONUTF8`.
5. **Write the note**: observed facts with evidence IDs, inferences, unknowns, and "Implications for our spec" (adopt / change / skip). Add a row to the research README index and link the note from the spec that uses it.
6. **Clean up**: launch mode deletes its profile (check `normalized_result.browser.cleanup`). Do not commit capture JSON, screenshots, or HAR files.

## Route B: a page the human has open (signed-in pages such as a portfolio)
REA's passive tools attach to a Chrome that exposes a DevTools port. Use a separate profile so the port never touches the daily browser:
```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\mc-kalshi-research-chrome"
```
The human signs in and opens the page themselves. Then `list_browser_targets` with `cdp_endpoint: "http://127.0.0.1:9222"`, pick the target, and `inspect_web_page` (structure and text) or `capture_web_screenshot` (layout). Never type credentials through REA or in chat. Close that Chrome when done.

## Checks
- Every observation in the note cites an evidence ID; interactions REA performed are stated as such.
- No Kalshi assets or code in the repo; `git status` shows only `.md` files under `docs/research/`.
- The note names the spec it feeds.
