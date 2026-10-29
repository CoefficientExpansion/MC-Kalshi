import { displayPrice } from "@mc-kalshi/engine";
import { describe, expect, it } from "vitest";
import {
  chanceLabel,
  closeSummary,
  formatAbsolute,
  formatRelative,
  noPrice,
  parseCategoryParam,
  pointsLabel,
  statusBadge,
} from "./market-format";

const NOW = new Date("2026-10-29T16:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("prices", () => {
  it("labels the YES chance as a percentage", () => {
    expect(chanceLabel(62)).toBe("62% chance");
    expect(chanceLabel(1)).toBe("1% chance");
    expect(chanceLabel(99)).toBe("99% chance");
  });

  it("derives the NO price so the two sum to 100", () => {
    for (const yes of [1, 17, 50, 62, 99]) {
      expect(yes + noPrice(yes)).toBe(100);
    }
  });

  it("derives NO from the rounded YES price, never from 1 − p (review: 0.505 would total 101)", () => {
    // displayPrice(0.505) = 51 and displayPrice(0.495) = 50, so rounding NO separately breaks
    // the pair; the pages show NO as noPrice(displayPrice(p)).
    expect(displayPrice(0.505)).toBe(51);
    expect(noPrice(displayPrice(0.505))).toBe(49);
    for (const p of [0.005, 0.015, 0.495, 0.505, 0.625, 0.985, 0.995]) {
      expect(displayPrice(p) + noPrice(displayPrice(p))).toBe(100);
    }
  });

  it("labels points per contract without a currency sign", () => {
    expect(pointsLabel(62)).toBe("62 pts");
  });
});

describe("formatRelative", () => {
  it("speaks in the unit that fits the distance", () => {
    expect(formatRelative(at(5 * MIN), NOW)).toBe("in 5 minutes");
    expect(formatRelative(at(3 * HOUR), NOW)).toBe("in 3 hours");
    expect(formatRelative(at(3 * DAY), NOW)).toBe("in 3 days");
    expect(formatRelative(at(14 * DAY), NOW)).toBe("in 14 days");
    expect(formatRelative(at(21 * DAY), NOW)).toBe("in 3 weeks");
    expect(formatRelative(at(90 * DAY), NOW)).toBe("in 3 months");
  });

  it("handles the past and the near-now cases", () => {
    expect(formatRelative(at(-2 * DAY), NOW)).toBe("2 days ago");
    expect(formatRelative(at(-1 * DAY), NOW)).toBe("yesterday");
    expect(formatRelative(at(DAY), NOW)).toBe("tomorrow");
    expect(formatRelative(at(10_000), NOW)).toBe("this minute");
    expect(formatRelative(at(-10_000), NOW)).toBe("this minute");
  });
});

describe("closeSummary", () => {
  it("says closes for the future and closed for the past", () => {
    expect(closeSummary(at(3 * DAY), NOW)).toBe("Closes in 3 days");
    expect(closeSummary(at(DAY), NOW)).toBe("Closes tomorrow");
    expect(closeSummary(at(-2 * DAY), NOW)).toBe("Closed 2 days ago");
    expect(closeSummary(at(-DAY), NOW)).toBe("Closed yesterday");
  });
});

describe("formatAbsolute", () => {
  it("renders campus time (America/New_York) with the zone", () => {
    expect(formatAbsolute(new Date("2026-11-13T04:59:00Z"))).toBe("Nov 12, 2026, 11:59 PM EST");
    expect(formatAbsolute(new Date("2026-07-04T16:00:00Z"))).toBe("Jul 4, 2026, 12:00 PM EDT");
  });
});

describe("statusBadge", () => {
  const base = { closeAt: at(10 * DAY), outcome: null } as const;

  it("labels an open market, and flags one closing within 48 hours", () => {
    expect(statusBadge({ ...base, status: "open" }, NOW)).toEqual({ label: "Open", tone: "open" });
    expect(statusBadge({ ...base, status: "open", closeAt: at(47 * HOUR) }, NOW)).toEqual({
      label: "Closes soon",
      tone: "soon",
    });
  });

  it("reads Closed for an open market whose close time has passed", () => {
    expect(statusBadge({ ...base, status: "open", closeAt: at(-MIN) }, NOW)).toEqual({
      label: "Closed",
      tone: "closed",
    });
    expect(statusBadge({ ...base, status: "closed" }, NOW)).toEqual({
      label: "Closed",
      tone: "closed",
    });
  });

  it("gives each settled state its own text", () => {
    expect(statusBadge({ ...base, status: "resolved", outcome: "YES" }, NOW)).toEqual({
      label: "Resolved YES",
      tone: "won-yes",
    });
    expect(statusBadge({ ...base, status: "resolved", outcome: "NO" }, NOW)).toEqual({
      label: "Resolved NO",
      tone: "won-no",
    });
    expect(statusBadge({ ...base, status: "finalized", outcome: "YES" }, NOW).label).toBe(
      "Final YES",
    );
    expect(statusBadge({ ...base, status: "finalized", outcome: "NO" }, NOW).label).toBe(
      "Final NO",
    );
    expect(statusBadge({ ...base, status: "voided" }, NOW)).toEqual({
      label: "Voided",
      tone: "void",
    });
  });
});

describe("parseCategoryParam", () => {
  it("accepts a well-formed slug, first value of a repeated param", () => {
    expect(parseCategoryParam("weather")).toBe("weather");
    expect(parseCategoryParam("clubs-events")).toBe("clubs-events");
    expect(parseCategoryParam(["campus-life", "weather"])).toBe("campus-life");
    expect(parseCategoryParam(" Weather ")).toBe("weather");
  });

  it("ignores anything that is not a slug", () => {
    expect(parseCategoryParam(undefined)).toBeUndefined();
    expect(parseCategoryParam("")).toBeUndefined();
    expect(parseCategoryParam([])).toBeUndefined();
    expect(parseCategoryParam("a b")).toBeUndefined();
    expect(parseCategoryParam("../etc")).toBeUndefined();
    expect(parseCategoryParam("x'; drop table markets;--")).toBeUndefined();
    expect(parseCategoryParam("-weather")).toBeUndefined();
    expect(parseCategoryParam("a".repeat(65))).toBeUndefined();
  });
});
