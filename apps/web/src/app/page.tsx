import { MarketListView } from "@/components/market/market-list-view";
import { getDb } from "@/db";
import { parseCategoryParam } from "@/lib/market-format";
import { buildMarketList } from "@/lib/market-list";
import { loadMarketList } from "@/server/market-pages";

// Request-time rendering: no database access at build time, and relative dates stay fresh.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const category = parseCategoryParam((await searchParams).category);
  const load = await loadMarketList(getDb());
  const now = new Date();
  const list = load.kind === "ok" ? buildMarketList(load.markets, category, now) : null;
  return <MarketListView load={load} list={list} now={now} />;
}
