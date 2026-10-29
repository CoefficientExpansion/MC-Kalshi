import type { StatusBadge as Badge, StatusTone } from "@/lib/market-format";

const TONE: Record<StatusTone, string> = {
  open: "border border-border bg-background text-foreground",
  soon: "bg-warning text-on-accent",
  closed: "border border-border bg-background text-foreground",
  "won-yes": "bg-success text-on-accent",
  "won-no": "bg-no text-on-no",
  void: "border border-border bg-background text-foreground",
};

/** Market state as a word on a pill; color is a second channel, never the only one. */
export function StatusBadge({ badge }: { badge: Badge }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-0.5 font-display text-sm font-semibold uppercase tracking-widest ${TONE[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}
