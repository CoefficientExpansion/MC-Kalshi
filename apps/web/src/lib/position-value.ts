import { payout } from "@mc-kalshi/engine";

// What a position is worth (docs/specs/m3-trading.md, "Positions and portfolio", Definitions).
// Pure; shared by the portfolio loader and the "Your position" card.

export interface HeldPosition {
  readonly contractsYes: number;
  readonly contractsNo: number;
  /** Net points paid in for this market (signed). */
  readonly costBasisPoints: number;
}

export interface PositionValue {
  readonly noPrice: number;
  /** round(contracts × price) per side, summed. "About": it ignores price impact. */
  readonly valueNow: number;
  /** The engine's payout: floor(contracts × 100). */
  readonly paysIfYes: number;
  readonly paysIfNo: number;
  /** valueNow − costBasisPoints. */
  readonly change: number;
}

/** `yesPrice` is the whole-percent YES price (engine `displayPrice`, 1–99). */
export function positionValue(held: HeldPosition, yesPrice: number): PositionValue {
  const noPrice = 100 - yesPrice;
  const valueNow =
    Math.round(held.contractsYes * yesPrice) + Math.round(held.contractsNo * noPrice);
  return {
    noPrice,
    valueNow,
    paysIfYes: payout(held, "YES"),
    paysIfNo: payout(held, "NO"),
    change: valueNow - held.costBasisPoints,
  };
}

/** True when the member holds any contracts on either side. */
export function holdsAny(held: HeldPosition): boolean {
  return held.contractsYes > 0 || held.contractsNo > 0;
}
