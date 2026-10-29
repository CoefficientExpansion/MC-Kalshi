import { createHash, timingSafeEqual } from "node:crypto";
import { getDbChecked } from "@/db";
import { checkTradingInvariants } from "@/server/invariants";

// Daily integrity check (docs/specs/m3-trading.md "Ledger invariant job"), scheduled in
// apps/web/vercel.json. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when that env var
// is set. A violation returns 500 and logs one JSON line, so both the Vercel log and the cron
// status show it (SOP-06 "Ledger invariant alert").
export const dynamic = "force-dynamic";

/** Constant-time: both sides are hashed first, so the buffers always have equal length. */
function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || header === null) {
    return false;
  }
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request.headers.get("authorization"))) {
    return Response.json({ code: "unauthorized" }, { status: 401 });
  }
  const checkedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof checkTradingInvariants>>;
  try {
    const db = await getDbChecked();
    if (!db) {
      return Response.json({ code: "unconfigured" }, { status: 503 });
    }
    result = await checkTradingInvariants(db);
  } catch (error) {
    // The check itself failed (database down, query error): still a red cron run. No message,
    // which could carry row data; the error name is enough to start from.
    console.error(
      JSON.stringify({
        event: "ledger_invariant_check_failed",
        checkedAt,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
    return Response.json({ ok: false, checkedAt, code: "check_failed" }, { status: 500 });
  }
  if (!result.ok) {
    // Issues carry a kind and ids only (no emails, names, or amounts).
    console.error(
      JSON.stringify({ event: "ledger_invariant_violation", checkedAt, issues: result.issues }),
    );
    return Response.json({ ok: false, checkedAt }, { status: 500 });
  }
  return Response.json({ ok: true, checkedAt });
}
