import Link from "next/link";
import type { CategoryChip } from "@/lib/market-list";

const CHIP =
  "inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink";

/** Category filter as links (`?category=<slug>`), so it works without JavaScript. */
export function CategoryChips({
  categories,
  activeSlug,
}: {
  categories: readonly CategoryChip[];
  activeSlug: string | null;
}) {
  if (categories.length === 0) return null;
  const chip = (active: boolean) =>
    `${CHIP} ${
      active
        ? "border-brand bg-brand text-on-brand"
        : "border-border bg-background text-foreground hover:border-brand-ink"
    }`;
  return (
    <nav aria-label="Categories">
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1">
        <li>
          <Link
            href="/"
            className={chip(activeSlug === null)}
            aria-current={activeSlug === null ? "page" : undefined}
          >
            All
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/?category=${encodeURIComponent(c.slug)}`}
              className={chip(activeSlug === c.slug)}
              aria-current={activeSlug === c.slug ? "page" : undefined}
            >
              {c.name}
              <span className="tabular-nums font-normal">{c.openCount}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
