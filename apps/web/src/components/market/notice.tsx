import Link from "next/link";
import type { ReactNode } from "react";

/** A full-width panel for the empty / not-configured / unavailable states. */
export function Notice({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
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
