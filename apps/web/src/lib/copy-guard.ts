// Test helper: hard constraint 1 (CLAUDE.md) bans "bet", "$" and "cash out" in UI copy.
// Lives in lib/ next to the code it guards; only tests import it.

/** Visible text of an HTML string: tags dropped, whitespace collapsed. */
export function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every banned pattern found in `text`; empty means clean. */
export function copyViolations(text: string): string[] {
  const banned: [string, RegExp][] = [
    ["bet", /\bbet(s|ting)?\b/i],
    ["$", /\$/],
    ["cash out", /cash[\s-]?out/i],
  ];
  return banned.filter(([, re]) => re.test(text)).map(([name]) => name);
}
