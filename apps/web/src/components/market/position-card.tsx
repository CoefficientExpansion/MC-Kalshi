import { type HeldPosition, holdsAny, positionValue } from "@/lib/position-value";
import { formatContracts, formatPoints } from "@/lib/trade-copy";

// "Your position" on the market page (docs/specs/m3-trading.md, "Positions and portfolio"):
// contracts per side, net cost basis, value now ("about": it ignores price impact) and what each
// held side pays if it wins. Renders nothing when nothing is held.

function contractsNoun(n: number): string {
  return n === 1 ? "contract" : "contracts";
}

export function PositionCard({ position, yesPrice }: { position: HeldPosition; yesPrice: number }) {
  if (!holdsAny(position)) return null;
  const value = positionValue(position, yesPrice);
  const sides = [
    { side: "YES", held: position.contractsYes, pays: value.paysIfYes, tone: "text-yes" },
    { side: "NO", held: position.contractsNo, pays: value.paysIfNo, tone: "text-no" },
  ].filter((s) => s.held > 0);
  return (
    <section
      aria-labelledby="position-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="position-heading" className="font-display text-2xl font-semibold">
        Your position
      </h2>
      <ul className="flex flex-col gap-2">
        {sides.map((s) => (
          <li key={s.side} className="flex flex-col">
            <span className="font-semibold tabular-nums">
              <span className={s.tone}>{s.side}</span> {formatContracts(s.held)}{" "}
              {contractsNoun(s.held)}
            </span>
            <span className="tabular-nums">
              Pays {formatPoints(s.pays)} if {s.side}
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt>Cost basis</dt>
          <dd className="font-semibold tabular-nums">{formatPoints(position.costBasisPoints)}</dd>
        </div>
        <div>
          <dt>Value now</dt>
          <dd className="font-semibold tabular-nums">about {formatPoints(value.valueNow)}</dd>
        </div>
      </dl>
    </section>
  );
}
