import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Home from "./page";

// Hard constraint 1 (CLAUDE.md): UI copy never says "bet", "$", or "cash out".
describe("home page copy", () => {
  it("never says bet, $, or cash out", () => {
    const html = renderToStaticMarkup(createElement(Home));
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).toMatch(/MC-Kalshi/);
    expect(text).toMatch(/Play money, no cash, ever\./);
    expect(text).not.toMatch(/\bbets?\b/i);
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/cash[\s-]?out/i);
  });
});
