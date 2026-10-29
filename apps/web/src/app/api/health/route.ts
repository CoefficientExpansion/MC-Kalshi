import { getDb, getDbChecked, pingDatabase } from "@/db";
import { buildHealth } from "@/lib/health";

// Evaluated per request so the database status is live, not baked in at build time.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // getDb() only says whether a database is configured; the check goes through getDbChecked so a
  // connection the production role guard refuses (ADR-0006) reports as an error.
  const configured = getDb() !== undefined;
  const { status, body } = await buildHealth({
    dbCheck: configured
      ? async () => {
          const db = await getDbChecked();
          if (!db) throw new Error("database connection refused");
          await pingDatabase(db);
        }
      : undefined,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  return Response.json(body, { status });
}
