import { noPrice, pointsLabel } from "@/lib/market-format";

/** Disabled stand-in for the M3 order ticket. Nothing here can submit. */
export function OrderTicketPlaceholder({
  yesPrice,
  tradable,
}: {
  yesPrice: number;
  /** True while the market is open and before its close time. */
  tradable: boolean;
}) {
  const note = tradable
    ? "Trading opens soon. Until then you can read the rules and watch the price."
    : "Trading is closed for this market.";
  return (
    <section
      aria-labelledby="ticket-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="ticket-title" className="font-display text-2xl font-semibold">
        Trade
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled
          aria-describedby="ticket-note"
          className="flex min-h-14 cursor-not-allowed flex-col items-center justify-center rounded-md border-2 border-yes px-3 py-2 font-semibold text-yes opacity-60"
        >
          <span>Buy YES</span>
          <span className="tabular-nums">{pointsLabel(yesPrice)}</span>
        </button>
        <button
          type="button"
          disabled
          aria-describedby="ticket-note"
          className="flex min-h-14 cursor-not-allowed flex-col items-center justify-center rounded-md border-2 border-no px-3 py-2 font-semibold text-no opacity-60"
        >
          <span>Buy NO</span>
          <span className="tabular-nums">{pointsLabel(noPrice(yesPrice))}</span>
        </button>
      </div>
      <p id="ticket-note" className="text-sm">
        {note}
      </p>
    </section>
  );
}
