export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-5 bg-brand px-6 pt-24 pb-16 text-center text-on-brand">
        <p className="rounded-full bg-accent px-4 py-1 font-display text-sm font-semibold uppercase tracking-widest text-on-accent">
          Maryville College
        </p>
        <h1 className="font-display text-6xl font-bold uppercase tracking-tight sm:text-7xl">
          MC-Kalshi
        </h1>
        <div aria-hidden="true" className="h-1 w-16 rounded-full bg-accent" />
      </section>
      <section className="flex flex-1 flex-col items-center gap-4 px-6 py-16 text-center">
        <p className="max-w-md text-lg text-foreground">
          Trade campus events with points. Play money, no cash, ever.
        </p>
        <p className="text-sm text-muted">
          Sign-in with your college email arrives in the next milestone.
        </p>
      </section>
    </main>
  );
}
