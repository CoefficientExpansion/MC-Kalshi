import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MC-Kalshi",
  description: "A play-money prediction market for Maryville College campus events.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
