import { getDb } from "@/db";
import { getSessionMember } from "@/server/auth";
import { loadMarketState } from "@/server/market-state";

// Polled every 3 s by the market page (docs/specs/m3-trading.md, "Order ticket", Polling).
// Live data per request: never cached, never prerendered.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const db = getDb();
  if (!db) {
    return Response.json({ code: "unconfigured" }, { status: 503, headers: NO_STORE });
  }
  const { id } = await params;
  try {
    // getSessionMember, not getCurrentUser: a suspended member still sees their own balance and position.
    const session = await getSessionMember();
    const state = await loadMarketState(db, id, session?.userId ?? null);
    if (!state) {
      return Response.json({ code: "not_found" }, { status: 404, headers: NO_STORE });
    }
    return Response.json(state, { headers: NO_STORE });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "market_state_error",
        marketId: id,
        error: e instanceof Error ? e.name : "unknown",
      }),
    );
    return Response.json({ code: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
