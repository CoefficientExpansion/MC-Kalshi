import { EMPTY_POSITION } from "@mc-kalshi/engine";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { MarketDetailView } from "@/components/market/market-detail-view";
import { getDb } from "@/db";
import { parsePriceRange } from "@/lib/price-range";
import { getSessionMember } from "@/server/auth";
import { loadMarketDetail, loadMarketTrading } from "@/server/market-pages";
import { placeTradeAction } from "./actions";

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

export default async function MarketPage({ params, searchParams }: PageProps<"/markets/[slug]">) {
  const { slug } = await params;
  const result = await load(slug);
  if (result.kind === "not-found") notFound();
  const now = new Date();
  const db = getDb();
  if (result.kind !== "ok" || !db) return <MarketDetailView load={result} now={now} />;

  // getSessionMember, not getCurrentUser: a suspended member still sees their balance and
  // position, and the ticket says "Your account can't trade right now".
  const [session, query] = await Promise.all([getSessionMember(), searchParams]);
  const range = parsePriceRange(query.range);
  const { state, history } = await loadMarketTrading(
    db,
    result.market,
    session?.userId ?? null,
    range,
  );
  const account =
    session && state.balance !== undefined
      ? { balance: state.balance, position: state.position ?? EMPTY_POSITION }
      : null;
  return (
    <MarketDetailView
      load={result}
      now={now}
      trading={{
        state,
        history,
        account,
        suspended: session?.suspended ?? false,
        submit: placeTradeAction,
      }}
    />
  );
}
