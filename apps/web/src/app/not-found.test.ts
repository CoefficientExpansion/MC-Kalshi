import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import NotFound from "./not-found";

describe("not-found page", () => {
  it("has exactly one <h1> and a way back to the markets", () => {
    const html = renderToStaticMarkup(NotFound());
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(html).toContain('href="/"');
    expect(copyViolations(visibleText(html))).toEqual([]);
  });
});
