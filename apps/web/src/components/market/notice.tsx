import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A full-width panel for the empty / not-configured / unavailable states. Its title is an <h2>
 * under a page heading; pass `headingLevel={1}` when the notice is the whole page, so the page
 * still has exactly one <h1>.
 */
export function Notice({
  title,
  children,
  action,
  headingLevel = 2,
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6">
      <Heading className="font-display text-2xl font-semibold">{title}</Heading>
      <p className="max-w-prose text-foreground">{children}</p>
      {action ? (
        <Link
          href={action.href}
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:bg-accent-dark hover:text-on-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink focus-visible:ring-offset-2"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
