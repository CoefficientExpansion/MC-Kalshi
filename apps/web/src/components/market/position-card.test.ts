import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyViolations, visibleText } from "@/lib/copy-guard";
import { PositionCard } from "./position-card";

const render = (position: Parameters<typeof PositionCard>[0]["position"], yesPrice = 52) =>
  renderToStaticMarkup(createElement(PositionCard, { position, yesPrice }));

describe("PositionCard", () => {
  it("shows contracts, cost basis, value now and what each held side pays", () => {
    const html = render({ contractsYes: 9.761859, contractsNo: 1.2, costBasisPoints: 560 });
    const text = visibleText(html);
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(text).toContain("Your position");
    expect(text).toContain("YES 9.76 contracts");
    expect(text).toContain("NO 1.2 contracts");
    expect(text).toContain("Pays 976 pts if YES");
    expect(text).toContain("Pays 120 pts if NO");
    expect(text).toContain("Cost basis 560 pts");
    // 9.761859 × 52 = 507.6 -> 508, plus 1.2 × 48 = 57.6 -> 58.
    expect(text).toContain("Value now about 566 pts");
    expect(copyViolations(text)).toEqual([]);
  });

  it("shows only the side that is held", () => {
    const text = visibleText(render({ contractsYes: 0, contractsNo: 1, costBasisPoints: 48 }));
    expect(text).toContain("NO 1 contract ");
    expect(text).toContain("Pays 100 pts if NO");
    expect(text).not.toContain("if YES");
  });

  it("renders nothing without a holding", () => {
    expect(render({ contractsYes: 0, contractsNo: 0, costBasisPoints: 0 })).toBe("");
  });
});
