import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import type { PriceHistory } from "@/lib/price-range";
import { PriceChart } from "./price-chart";

const DAY = 86_400_000;
const TO = Date.parse("2026-10-29T16:00:00Z");
const history = (overrides: Partial<PriceHistory> = {}): PriceHistory => ({
  range: "1W",
  from: TO - 7 * DAY,
  to: TO,
  hasTrades: true,
  points: [
    { at: TO - 7 * DAY, probabilityYes: 0.5 },
    { at: TO - 3 * DAY, probabilityYes: 0.58 },
    { at: TO - DAY, probabilityYes: 0.62 },
    { at: TO, probabilityYes: 0.62 },
  ],
  ...overrides,
});

const render = (h: PriceHistory) =>
  renderToStaticMarkup(createElement(PriceChart, { history: h, basePath: "/markets/snow" }));

describe("PriceChart", () => {
  it("draws an SVG with an aria-label summary and the headline change", () => {
    const html = render(history());
    expect(html).toMatch(
      /<svg role="img" aria-label="YES chance rose from 50% to 62% over the last week"/,
    );
    const text = visibleText(html);
    expect(text).toContain("Price history");
    expect(text).toContain("up 12 last week");
    // Step-after: horizontal moves then vertical moves only.
    const d = html.match(/<path d="(M[^"]+)" fill="none"/)?.[1] ?? "";
    expect(d).toMatch(/^M[\d.]+,[\d.]+(H[\d.]+V[\d.]+)+$/);
    expect(copyViolations(text)).toEqual([]);
  });

  it("colors with theme tokens only, never raw colors", () => {
    const html = render(history());
    expect(html).toContain('class="text-yes"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain("stroke-border");
    expect(html).toContain("fill-muted");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it("offers 1D, 1W and ALL as links, marking the current one", () => {
    const html = render(history({ range: "1D" }));
    for (const r of ["1D", "1W", "ALL"]) {
      expect(html).toContain(`href="/markets/snow?range=${r}"`);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>1D</);
    expect(html).not.toMatch(/<button/);
  });

  it("says down 3 when the price fell", () => {
    const text = visibleText(
      render(
        history({
          range: "ALL",
          points: [
            { at: TO - 7 * DAY, probabilityYes: 0.5 },
            { at: TO, probabilityYes: 0.47 },
          ],
        }),
      ),
    );
    expect(text).toContain("down 3 since trading opened");
  });

  it('shows "No trades yet" instead of a line when there are no trades or under 2 points', () => {
    for (const h of [
      history({ hasTrades: false }),
      history({ points: [{ at: TO, probabilityYes: 0.5 }] }),
    ]) {
      const html = render(h);
      expect(visibleText(html)).toContain("No trades yet");
      expect(html).not.toMatch(/<svg/);
      expect(html).toContain("?range=ALL");
    }
  });
});
