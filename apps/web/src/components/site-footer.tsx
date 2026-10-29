// Trademark boundary (docs/design/theme.md): plain text only, no college marks, and a clear
// statement that this is not an official college site.
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-6 text-sm text-foreground sm:px-8">
        <p>
          MC-Kalshi is an unofficial student project for the Maryville College community. It is not
          endorsed by or affiliated with the college.
        </p>
        <p>Points are play money with no cash value, now or ever.</p>
      </div>
    </footer>
  );
}
