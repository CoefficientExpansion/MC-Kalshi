import { describe, expect, it } from "vitest";
import { holdsAny, positionValue } from "./position-value";

describe("positionValue", () => {
  it("values each side at its price, rounds per side, and pays floor(contracts × 100)", () => {
    // YES 9.761859 at 52 = 507.6 -> 508; NO 1.2 at 48 = 57.6 -> 58.
    expect(
      positionValue({ contractsYes: 9.761859, contractsNo: 1.2, costBasisPoints: 560 }, 52),
    ).toEqual({ noPrice: 48, valueNow: 566, paysIfYes: 976, paysIfNo: 120, change: 6 });
  });

  it("can show a loss and a negative basis", () => {
    expect(positionValue({ contractsYes: 0, contractsNo: 2, costBasisPoints: 150 }, 70)).toEqual({
      noPrice: 30,
      valueNow: 60,
      paysIfYes: 0,
      paysIfNo: 200,
      change: -90,
    });
    expect(
      positionValue({ contractsYes: 1, contractsNo: 0, costBasisPoints: -20 }, 50).change,
    ).toBe(70);
  });

  it("knows whether anything is held", () => {
    expect(holdsAny({ contractsYes: 0, contractsNo: 0, costBasisPoints: -3 })).toBe(false);
    expect(holdsAny({ contractsYes: 0, contractsNo: 0.000001, costBasisPoints: 0 })).toBe(true);
  });
});
