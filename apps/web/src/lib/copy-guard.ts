import ts from "typescript";

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

/**
 * The order ticket's banned set (docs/specs/m3-trading.md, "Copy lives in lib/trade-copy.ts"):
 * bet, wager, prize and cash out as whole words (with their usual endings), and the `$` and `¢`
 * symbols anywhere. "between", "Better" or a `justify-between` class are not what a reader sees
 * as "bet", so they pass.
 */
export const TICKET_BANNED =
  /\b(?:bet(?:s|ting|tor|tors)?|wager(?:s|ed|ing)?|prizes?|cash[\s-]?outs?)\b|\$|¢/i;

const CLASS_ATTRIBUTES = new Set(["className", "class"]);

/**
 * The user-visible text of a TypeScript/TSX source: string literals, the text parts of template
 * literals and JSX text. Skips what a reader never sees: comments, import and export paths,
 * template placeholders, string literal types, and className/class attribute values (with any
 * expression inside them). One entry per piece, in source order.
 */
export function sourceCopy(source: string, fileName = "source.tsx"): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isLiteralTypeNode(node)
    ) {
      return;
    }
    if (ts.isExternalModuleReference(node) || ts.isImportTypeNode(node)) return;
    if (ts.isJsxAttribute(node) && CLASS_ATTRIBUTES.has(node.name.getText(file))) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    if (ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression)) {
      // A directive such as "use client".
      if (node.parent === file) return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) {
        visit(span.expression);
        out.push(span.literal.text);
      }
      return;
    } else if (ts.isJsxText(node)) {
      if (!node.containsOnlyTriviaWhiteSpaces) out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.filter((text) => text.length > 0);
}
