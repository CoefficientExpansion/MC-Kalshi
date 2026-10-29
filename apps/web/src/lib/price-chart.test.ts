import { describe, expect, it } from "vitest";
import { chartGeometry, chartSummary, priceChange, priceChangeLabel } from "./price-chart";
import { parsePriceRange } from "./price-range";

const pts = (...ps: [number, number][]) =>
  ps.map(([at, probabilityYes]) => ({ at, probabilityYes }));

describe("parsePriceRange", () => {
  it("accepts 1D, 1W and ALL and defaults to 1W", () => {
    expect(parsePriceRange("1D")).toBe("1D");
    expect(parsePriceRange("ALL")).toBe("ALL");
    expect(parsePriceRange(["1D", "ALL"])).toBe("1D");
    for (const junk of [undefined, "", "1d", "1M", "ALL;drop", []]) {
      expect(parsePriceRange(junk)).toBe("1W");
    }
  });
});

describe("price change", () => {
  it("is last minus first in whole percent", () => {
    expect(priceChange(pts([0, 0.5], [1, 0.62]))).toBe(12);
    expect(priceChange(pts([0, 0.5], [1, 0.47]))).toBe(-3);
    expect(priceChange(pts([0, 0.5]))).toBe(0);
    expect(priceChange([])).toBe(0);
  });

  it("reads as up 4, down 3 or no change", () => {
    expect(priceChangeLabel(4)).toBe("up 4");
    expect(priceChangeLabel(-3)).toBe("down 3");
    expect(priceChangeLabel(0)).toBe("no change");
  });

  it("summarizes the range for screen readers", () => {
    expect(chartSummary(pts([0, 0.5], [1, 0.62]), "1W")).toBe(
      "YES chance rose from 50% to 62% over the last week",
    );
    expect(chartSummary(pts([0, 0.7], [1, 0.4]), "1D")).toBe(
      "YES chance fell from 70% to 40% over the last day",
    );
    expect(chartSummary(pts([0, 0.5], [1, 0.501]), "ALL")).toBe(
      "YES chance held at 50% since trading opened",
    );
  });
});

describe("chartGeometry", () => {
  const box = { width: 100, height: 50 };

  it("draws a step-after line: horizontal first, then vertical", () => {
    const g = chartGeometry(pts([0, 0.5], [50, 1], [100, 0]), 0, 100, box);
    expect(g.line).toBe("M0,25H50V0H100V50");
    expect(g.area).toBe("M0,25H50V0H100V50V50H0Z");
  });

  it("maps 100% to the top and 0% to the bottom, and survives an empty time range", () => {
    const g = chartGeometry(pts([5, 0.25], [5, 0.75]), 5, 5, box);
    expect(g.line).toBe("M0,37.5H0V12.5");
    expect(g.xOf(5)).toBe(0);
    expect(g.yOf(0.5)).toBe(25);
  });
});
