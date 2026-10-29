import { MarketListView } from "@/components/market/market-list-view";
import { getDbChecked } from "@/db";
import { parseCategoryParam } from "@/lib/market-format";
import { buildMarketList } from "@/lib/market-list";
import { loadMarketList } from "@/server/market-pages";
import { PUBLIC_MARKET_STATUSES } from "@/server/markets";

// Request-time rendering: no database access at build time, and relative dates stay fresh.
export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: PageProps<"/">) {
  const category = parseCategoryParam((await searchParams).category);
  const load = await loadMarketList(getDbChecked(), { status: PUBLIC_MARKET_STATUSES });
  const now = new Date();
  const list = load.kind === "ok" ? buildMarketList(load.markets, category, now) : null;
  return <MarketListView load={load} list={list} now={now} />;
}
