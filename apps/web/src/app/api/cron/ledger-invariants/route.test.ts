import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { categories, markets } from "@/db/schema";
import { openTestDb, type TestDbHandle } from "@/db/test-db";
import { GET } from "./route";

// `getDbChecked()` is swapped per test: undefined = no DATABASE_URL, otherwise a PGlite database.
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
// An Error stands for a failed connection check (getDbChecked throws).
vi.mock("@/db", () => ({
  getDbChecked: async () => {
    if (holder.db instanceof Error) throw holder.db;
    return holder.db;
  },
}));

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const MARKET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const call = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/cron/ledger-invariants", {
      headers: authorization === undefined ? {} : { authorization },
    }),
  );

describe("GET /api/cron/ledger-invariants", () => {
  let handle: TestDbHandle;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    handle = await openTestDb();
    const [cat] = await handle.db
      .insert(categories)
      .values({ slug: "campus", name: "Campus" })
      .returning({ id: categories.id });
    await handle.db.insert(markets).values({
      id: MARKET,
      slug: "m",
      title: "m",
      rules: "r",
      categoryId: cat?.id ?? "",
      status: "open",
      closeAt: new Date(Date.now() + 86_400_000),
    });
  });
  afterAll(async () => {
    await handle.close();
  });
  beforeEach(() => {
    holder.db = handle.db;
    vi.stubEnv("CRON_SECRET", SECRET);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
    await handle.db.update(markets).set({ qYes: "0" }).where(eq(markets.id, MARKET));
  });

  it("is 401 when CRON_SECRET is unset, even with a bearer header (fail closed)", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
  });

  it("is 401 when CRON_SECRET is blank", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("is 401 without an Authorization header", async () => {
    expect((await call()).status).toBe(401);
  });

  it("is 401 with a wrong secret, a different length, or another scheme", async () => {
    expect((await call(`Bearer ${SECRET.slice(0, -1)}x`)).status).toBe(401);
    expect((await call(`Bearer ${SECRET}0`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`Basic ${SECRET}`)).status).toBe(401);
  });

  it("does not touch the database before authenticating", async () => {
    holder.db = undefined;
    expect((await call("Bearer nope")).status).toBe(401);
  });

  it("is 503 unconfigured when there is no database", async () => {
    holder.db = undefined;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "unconfigured" });
  });

  it("is 500 check_failed when the connection check fails", async () => {
    holder.db = new Error("connect timeout postgres://secret@host");
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, code: "check_failed" });
    expect(String(errorSpy.mock.calls[0]?.[0])).not.toContain("secret");
  });

  it("is 200 with ok and checkedAt when every invariant holds", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, checkedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("is 500 on a violation and logs one JSON line with ids only", async () => {
    await handle.db.update(markets).set({ qYes: "5" }).where(eq(markets.id, MARKET));
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, checkedAt: expect.any(String) });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [line, ...rest] = errorSpy.mock.calls[0] ?? [];
    expect(rest).toEqual([]);
    expect(typeof line).toBe("string");
    expect(line).not.toContain("\n");
    expect(JSON.parse(line as string)).toEqual({
      event: "ledger_invariant_violation",
      checkedAt: body.checkedAt,
      issues: [
        { kind: "positions_q_mismatch", marketId: MARKET, side: "YES" },
        { kind: "trades_q_mismatch", marketId: MARKET, side: "YES" },
      ],
    });
  });

  it("is 500 and logs the error name only when the check itself fails", async () => {
    holder.db = {
      select: () => {
        throw new TypeError("row data u1@my.maryvillecollege.edu");
      },
    };
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      ok: false,
      checkedAt: expect.any(String),
      code: "check_failed",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "ledger_invariant_check_failed",
      checkedAt: expect.any(String),
      error: "TypeError",
    });
    expect(line).not.toContain("@");
  });
});
