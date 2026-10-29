export type Side = "YES" | "NO";
export type Outcome = "YES" | "NO";

export interface MarketState {
  /** Contracts the AMM has sold on YES (may be negative after sells). */
  readonly qYes: number;
  /** Contracts the AMM has sold on NO. */
  readonly qNo: number;
  /** Liquidity in contracts, B_MIN..B_MAX. */
  readonly b: number;
}

export interface Quote {
  readonly side: Side;
  /** Signed, six decimals: positive buys, negative sells. */
  readonly contracts: number;
  /** Signed whole points: positive means the user pays, negative means the user receives. */
  readonly costPoints: number;
  /** Whole points per contract, clamped to PRICE_MIN..PRICE_MAX. */
  readonly avgPrice: number;
  /** p_yes before the trade. */
  readonly probBefore: number;
  /** p_yes after the trade. */
  readonly probAfter: number;
  /** Whole points this fill pays if `side` wins; always 0 for a sell. */
  readonly payoutIfWin: number;
  readonly stateAfter: MarketState;
}

export interface PositionLike {
  readonly contractsYes: number;
  readonly contractsNo: number;
  /** Net points paid into this market; negative if the user has taken more out than in. */
  readonly costBasisPoints: number;
}
