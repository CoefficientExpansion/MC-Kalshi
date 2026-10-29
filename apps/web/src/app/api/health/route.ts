import { getDb, pingDatabase } from "@/db";
import { buildHealth } from "@/lib/health";

// Evaluated per request so the database status is live, not baked in at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const { status, body } = await buildHealth({
    dbCheck: db ? () => pingDatabase(db) : undefined,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  return Response.json(body, { status });
}
