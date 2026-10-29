import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { getDb } from "@/db";
import { loadMarketDetail } from "@/server/market-pages";

// Request-time rendering: no database access at build time, and relative dates stay fresh.
export const dynamic = "force-dynamic";

// generateMetadata and the page share one query per request.
const load = cache((slug: string) => loadMarketDetail(getDb(), slug));

export async function generateMetadata({
  params,
}: PageProps<"/markets/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const result = await load(slug);
  return result.kind === "ok" ? { title: result.market.title } : { title: "Market" };
}

export default async function MarketPage({ params }: PageProps<"/markets/[slug]">) {
  const { slug } = await params;
  const result = await load(slug);
  if (result.kind === "not-found") notFound();
  return <MarketDetailView load={result} now={new Date()} />;
}
