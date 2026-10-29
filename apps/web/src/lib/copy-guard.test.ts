import { describe, expect, it } from "vitest";
import { copyViolations, visibleText } from "./copy-guard";

describe("copy guard", () => {
  it("strips tags and collapses whitespace", () => {
    expect(visibleText("<p>Hello\n <b>world</b></p>")).toBe("Hello world");
  });

  it("flags the banned words and passes ordinary copy", () => {
    expect(copyViolations("Place a bet")).toEqual(["bet"]);
    expect(copyViolations("Win $5")).toEqual(["$"]);
    expect(copyViolations("Cash-out now")).toEqual(["cash out"]);
    expect(copyViolations("Play money, no cash, ever. Better odds.")).toEqual([]);
  });
});
