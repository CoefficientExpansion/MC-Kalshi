import { noPrice } from "@/lib/market-format";

/** YES/NO split: a thin bar (decorative) and the same numbers as words. */
export function PriceSplit({ yesPrice }: { yesPrice: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-full">
        <div className="bg-yes" style={{ width: `${yesPrice}%` }} />
        <div className="flex-1 bg-no" />
      </div>
      <p className="flex justify-between text-sm font-semibold tabular-nums">
        <span className="text-yes">YES {yesPrice}%</span>
        <span className="text-no">NO {noPrice(yesPrice)}%</span>
      </p>
    </div>
  );
}
