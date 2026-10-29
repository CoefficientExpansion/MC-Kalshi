import { describe, expect, it } from "vitest";
import { copyViolations, sourceCopy, TICKET_BANNED, visibleText } from "./copy-guard";

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

describe("TICKET_BANNED (whole words and exact symbols)", () => {
  it.each([
    "Place a bet",
    "Bets are off",
    "betting",
    "wager",
    "Wagering",
    "Win a prize",
    "prizes",
    "cash out",
    "Cash-out",
    "cashout",
    "$5",
    "5¢",
  ])("flags %j", (text) => {
    expect(text).toMatch(TICKET_BANNED);
  });

  it.each(["between", "Better odds", "alphabet", "justify-between", "surprized", "cashier"])(
    "passes %j",
    (text) => {
      expect(text).not.toMatch(TICKET_BANNED);
    },
  );
});

describe("sourceCopy (the user-visible text of a source file)", () => {
  const scan = (src: string) => sourceCopy(src).join("\n");

  it("passes a className containing 'between'", () => {
    const src = `export const A = () => <div className="flex justify-between">Total</div>;`;
    expect(scan(src)).not.toMatch(TICKET_BANNED);
    expect(sourceCopy(src)).toEqual(["Total"]);
  });

  it("fails JSX text 'bet now'", () => {
    expect(scan(`export const A = () => <p>bet now</p>;`)).toMatch(TICKET_BANNED);
  });

  it("collects string literals, template text and JSX text", () => {
    const src = [
      `const a = "Buy YES";`,
      "const b = `You pay ${cost} pts`;",
      `const C = () => <span title="Max amount">Sell {side}</span>;`,
    ].join("\n");
    expect(sourceCopy(src)).toEqual(["Buy YES", "You pay ", " pts", "Max amount", "Sell "]);
  });

  it("finds banned copy in a string literal, a template and an attribute other than className", () => {
    expect(scan(`const a = "Place a wager";`)).toMatch(TICKET_BANNED);
    expect(scan("const b = `Win ${n} prizes`;")).toMatch(TICKET_BANNED);
    expect(scan(`const C = () => <b aria-label="Cash out">x</b>;`)).toMatch(TICKET_BANNED);
    expect(scan(`const d = "$5";`)).toMatch(TICKET_BANNED);
  });

  it("skips className and class values (including templates and expressions), imports, placeholders and comments", () => {
    const src = [
      `import { x } from "@/lib/bet-helpers";`,
      `export { y } from "./prize";`,
      `// a bet in a comment`,
      `/* wager */`,
      'const C = () => <div className={`justify-between ${on ? "bet-a" : "bet-b"}`} class="bet">ok</div>;',
      "const t = `${cash} out`;",
      `const D = () => <i className={cn("prize", x)} />;`,
    ].join("\n");
    expect(scan(src)).not.toMatch(TICKET_BANNED);
  });

  it("skips string literal types", () => {
    expect(scan(`type Lock = "bet" | "closed";`)).not.toMatch(TICKET_BANNED);
  });
});
