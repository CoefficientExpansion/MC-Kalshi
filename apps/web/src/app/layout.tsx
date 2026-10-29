import type { Metadata } from "next";
import { Archivo, Barlow_Condensed } from "next/font/google";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

// Body and UI type. Variable font, so no weight list is needed.
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-archivo",
});

// Headline type: free stand-in for the college's licensed condensed grotesque.
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-barlow-condensed",
});

export const metadata: Metadata = {
  title: { default: "MC-Kalshi", template: "%s | MC-Kalshi" },
  description: "A play-money prediction market for Maryville College campus events.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-on-accent"
        >
          Skip to content
        </a>
        <header className="bg-brand text-on-brand">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-3 sm:px-8">
            <Link
              href="/"
              className="rounded-md font-display text-3xl font-bold uppercase tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              MC-Kalshi
            </Link>
            <div className="flex items-center gap-4">
              <nav aria-label="Primary">
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center rounded-md px-2 font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Markets
                </Link>
              </nav>
              {/* account slot: M2b auth */}
            </div>
          </div>
          <div aria-hidden="true" className="h-1 bg-accent" />
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
