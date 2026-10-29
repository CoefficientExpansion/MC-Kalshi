import type { Market } from "@/db/schema";

// Pure view-model helpers for the market pages. No I/O and no clock reads: callers pass `now`.

export type MarketStatus = Market["status"];
export type Outcome = NonNullable<Market["outcome"]>;

/** Campus time. Fixed so the server render and every viewer see the same wall-clock text. */
const CAMPUS_TIME_ZONE = "America/New_York";
const SOON_MS = 48 * 60 * 60 * 1000;

/** "62% chance": the YES probability as a whole percent (`displayPrice` is already 1–99). */
export function chanceLabel(yesPrice: number): string {
  return `${yesPrice}% chance`;
}

/** NO price in points per contract; YES and NO always sum to 100. */
export function noPrice(yesPrice: number): number {
  return 100 - yesPrice;
}

/** Points, never a currency sign. */
export function pointsLabel(points: number): string {
  return `${points} pts`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "in 3 days", "tomorrow", "2 days ago", "this minute". Rounds to the nearest whole unit. */
export function formatRelative(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  const sign = diff < 0 ? -1 : 1;
  const abs = Math.abs(diff);
  const unit = (ms: number, name: Intl.RelativeTimeFormatUnit) =>
    relativeFormat.format(sign * Math.round(abs / ms) || 0, name);
  if (abs < HOUR) return unit(MINUTE, "minute");
  if (abs < DAY) return unit(HOUR, "hour");
  if (abs < 21 * DAY) return unit(DAY, "day");
  if (abs < 60 * DAY) return unit(7 * DAY, "week");
  return unit(30 * DAY, "month");
}

/** "Closes in 3 days" or "Closed 2 days ago". */
export function closeSummary(closeAt: Date, now: Date): string {
  const verb = closeAt.getTime() > now.getTime() ? "Closes" : "Closed";
  return `${verb} ${formatRelative(closeAt, now)}`;
}

const absoluteFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** "Nov 12, 2026, 11:59 PM EST" in campus time. */
export function formatAbsolute(date: Date): string {
  return absoluteFormat.format(date);
}

export type StatusTone = "open" | "soon" | "closed" | "won-yes" | "won-no" | "void";

export interface StatusBadge {
  readonly label: string;
  readonly tone: StatusTone;
}

/** Text label and color family for a market's state. Always a word, never color alone. */
export function statusBadge(
  m: { status: MarketStatus; outcome: Outcome | null; closeAt: Date },
  now: Date,
): StatusBadge {
  switch (m.status) {
    case "open": {
      const left = m.closeAt.getTime() - now.getTime();
      if (left <= 0) return { label: "Closed", tone: "closed" };
      if (left < SOON_MS) return { label: "Closes soon", tone: "soon" };
      return { label: "Open", tone: "open" };
    }
    case "closed":
      return { label: "Closed", tone: "closed" };
    case "resolved":
      return m.outcome
        ? { label: `Resolved ${m.outcome}`, tone: m.outcome === "YES" ? "won-yes" : "won-no" }
        : { label: "Resolved", tone: "closed" };
    case "finalized":
      return m.outcome
        ? { label: `Final ${m.outcome}`, tone: m.outcome === "YES" ? "won-yes" : "won-no" }
        : { label: "Final", tone: "closed" };
    case "voided":
      return { label: "Voided", tone: "void" };
    case "proposed":
      return { label: "Proposed", tone: "closed" };
    case "rejected":
      return { label: "Rejected", tone: "closed" };
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The `?category=` value as a slug, or `undefined` for anything that is not one (missing,
 * repeated-and-empty, spaces, path or SQL junk). Repeated params use the first value.
 */
export function parseCategoryParam(raw: string | string[] | undefined): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const slug = first?.trim().toLowerCase();
  return slug && slug.length <= 64 && SLUG.test(slug) ? slug : undefined;
}
